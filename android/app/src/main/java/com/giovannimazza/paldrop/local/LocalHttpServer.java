package com.giovannimazza.paldrop.local;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Self-contained HTTP backend used when the phone has no internet access.
 *
 * It mirrors the Convex API surface the web app relies on (sessions, photo
 * upload/list, accept/reject/delete, extend/close, signed-free file bytes)
 * and additionally serves the web app itself, so the sending phone only
 * needs a browser pointed at the QR URL.
 *
 * Deliberately pure Java (no Android imports) so it can be compiled and
 * smoke-tested on a desktop JVM. The Android plugin wires it to an
 * assets-backed static root; tests use a plain directory.
 */
public class LocalHttpServer {

    /** Reads static assets (extracted APK assets on Android, files on desktop). */
    public interface StaticSource {
        /** Returns null when the path does not exist. */
        byte[] read(String path) throws IOException;
    }

    public static final int MAX_FILE_BYTES = 25 * 1024 * 1024;
    public static final long MAX_TOTAL_BYTES = 100L * 1024 * 1024;
    public static final int MAX_PHOTOS_PER_SESSION = 20;
    public static final long SESSION_TTL_MS = 15L * 60 * 1000;
    public static final long EXTEND_MS = 15L * 60 * 1000;
    private static final long PURGE_GRACE_MS = 10L * 60 * 1000;
    private static final String TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final int MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;

    private static final SecureRandom RANDOM = new SecureRandom();

    // --- state -------------------------------------------------------------

    static final class Photo {
        final String id;
        final String fileName;
        final String mimeType;
        final long fileSize;
        final int width;
        final int height;
        final long uploadedAt;
        final File file;
        String status; // pending | accepted | rejected
        long expiresAt;

        Photo(String id, String fileName, String mimeType, long fileSize,
              int width, int height, long uploadedAt, File file, long expiresAt, String status) {
            this.id = id;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.fileSize = fileSize;
            this.width = width;
            this.height = height;
            this.uploadedAt = uploadedAt;
            this.file = file;
            this.expiresAt = expiresAt;
            this.status = status;
        }
    }

    static final class Session {
        final String token;
        final long createdAt;
        final boolean autoAccept;
        final Map<String, Photo> photos = new LinkedHashMap<>();
        String status = "active"; // active | expired | closed
        long expiresAt;
        long totalBytes;
        int fileCount;

        Session(String token, long createdAt, long expiresAt, boolean autoAccept) {
            this.token = token;
            this.createdAt = createdAt;
            this.expiresAt = expiresAt;
            this.autoAccept = autoAccept;
        }
    }

    private final File dataDir;
    private final File photoDir;
    private final StaticSource staticSource;
    private final Map<String, Session> sessions = new LinkedHashMap<>();
    private final ExecutorService workers = Executors.newFixedThreadPool(6);
    private final ScheduledExecutorService sweeper = Executors.newSingleThreadScheduledExecutor();
    private ServerSocket serverSocket;
    private volatile boolean running;
    private int port;

    public LocalHttpServer(int preferredPort, File dataDir, StaticSource staticSource) {
        this.dataDir = dataDir;
        this.photoDir = new File(dataDir, "photos");
        this.staticSource = staticSource;
    }

    /** Binds the socket (trying a few nearby ports) and starts serving. */
    public synchronized int start(int preferredPort) throws IOException {
        if (running) {
            return port;
        }
        photoDir.mkdirs();
        IOException last = null;
        for (int candidate = preferredPort; candidate < preferredPort + 10; candidate++) {
            try {
                serverSocket = new ServerSocket();
                serverSocket.setReuseAddress(true);
                serverSocket.bind(new InetSocketAddress(candidate));
                port = candidate;
                break;
            } catch (IOException e) {
                last = e;
                serverSocket = null;
            }
        }
        if (serverSocket == null) {
            throw last != null ? last : new IOException("no port available");
        }
        running = true;
        workers.execute(this::acceptLoop);
        sweeper.scheduleWithFixedDelay(this::sweep, 60, 60, TimeUnit.SECONDS);
        return port;
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // ignore
            }
            serverSocket = null;
        }
        sweeper.shutdownNow();
        workers.shutdownNow();
    }

    public int getPort() {
        return port;
    }

    public boolean isRunning() {
        return running;
    }

    private void acceptLoop() {
        while (running) {
            Socket socket;
            try {
                socket = serverSocket.accept();
            } catch (IOException e) {
                return; // closed
            }
            try {
                workers.execute(() -> handle(socket));
            } catch (RuntimeException rejected) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // ignore
                }
            }
        }
    }

    // --- request handling --------------------------------------------------

    private void handle(Socket socket) {
        try (Socket sock = socket) {
            sock.setSoTimeout(30_000);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) {
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                return;
            }
            String method = parts[0].toUpperCase(Locale.ROOT);
            String rawTarget = parts[1];
            int q = rawTarget.indexOf('?');
            String path = q >= 0 ? rawTarget.substring(0, q) : rawTarget;
            String query = q >= 0 ? rawTarget.substring(q + 1) : "";

            Map<String, String> headers = new LinkedHashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT),
                            line.substring(colon + 1).trim());
                }
            }

            if ("OPTIONS".equals(method)) {
                respond(out, 204, "text/plain", new byte[0], null);
                return;
            }

            byte[] body = null;
            String lengthHeader = headers.get("content-length");
            if (lengthHeader != null) {
                long length = Long.parseLong(lengthHeader.trim());
                if (length < 0 || length > MAX_BODY_BYTES) {
                    respondJson(out, 413, "{\"code\":\"LIMIT_FILE_SIZE\"}");
                    return;
                }
                body = readFully(in, (int) length);
            }

            route(out, method, path, query, body);
        } catch (IOException | RuntimeException e) {
            // Connection already gone or malformed input: nothing else to do.
        }
    }

    private void route(OutputStream out, String method, String path, String query, byte[] body)
            throws IOException {
        String[] segments = path.split("/");
        List<String> seg = new ArrayList<>();
        for (String s : segments) {
            if (!s.isEmpty()) {
                seg.add(s);
            }
        }

        try {
            if (seg.isEmpty()) {
                serveStatic(out, "index.html");
                return;
            }
            if (!seg.get(0).equals("api")) {
                serveStatic(out, path); // SPA: falls back to index.html
                return;
            }

            if (seg.size() == 2 && seg.get(1).equals("health")) {
                respondJson(out, 200, "{\"app\":\"paldrop-local\",\"version\":1}");
                return;
            }

            if (seg.size() == 2 && seg.get(1).equals("sessions") && "POST".equals(method)) {
                handleCreateSession(out, body);
                return;
            }

            if (seg.size() == 3 && seg.get(1).equals("sessions")) {
                handleGetSession(out, seg.get(2));
                return;
            }

            if (seg.size() == 4 && seg.get(1).equals("sessions")) {
                String token = seg.get(2);
                switch (seg.get(3)) {
                    case "extend":
                        handleExtend(out, token);
                        return;
                    case "close":
                        handleClose(out, token);
                        return;
                    case "photos":
                        handleListPhotos(out, token);
                        return;
                    case "upload":
                        handleUpload(out, token, query, body);
                        return;
                    default:
                        break;
                }
            }

            if (seg.size() == 4 && seg.get(1).equals("photos") && "POST".equals(method)) {
                handlePhotoAction(out, seg.get(2), seg.get(3), body);
                return;
            }

            if (seg.size() == 3 && seg.get(1).equals("files") && "GET".equals(method)) {
                handleFile(out, seg.get(2));
                return;
            }

            respondJson(out, 404, "{\"code\":\"PHOTO_NOT_FOUND\"}");
        } catch (ClientError e) {
            respondJson(out, e.status, "{\"code\":\"" + e.code + "\"}");
        } catch (IOException | RuntimeException e) {
            respondJson(out, 500, "{\"code\":\"UNKNOWN\"}");
        }
    }

    // --- API handlers ------------------------------------------------------

    private void handleCreateSession(OutputStream out, byte[] body) throws IOException {
        String text = body == null ? "" : new String(body, StandardCharsets.UTF_8);
        boolean autoAccept = text.contains("\"autoAccept\":true");
        long now = System.currentTimeMillis();
        Session session = new Session(randomToken(), now, now + SESSION_TTL_MS, autoAccept);
        synchronized (sessions) {
            sessions.put(session.token, session);
        }
        String json = "{"
                + "\"token\":\"" + session.token + "\","
                + "\"url\":\"/r/" + session.token + "\","
                + "\"path\":\"/r/" + session.token + "\","
                + "\"expiresAt\":" + session.expiresAt + ","
                + "\"createdAt\":" + session.createdAt + ","
                + "\"autoAccept\":" + autoAccept + ","
                + "\"maxPhotos\":" + MAX_PHOTOS_PER_SESSION + ","
                + "\"maxTotalBytes\":" + MAX_TOTAL_BYTES
                + "}";
        respondJson(out, 200, json);
    }

    private void handleGetSession(OutputStream out, String token) throws IOException {
        // Mirrors Convex: an unknown token is 404, but closed/expired sessions
        // are still reported with their status (the UI shows a banner).
        Session session;
        synchronized (sessions) {
            session = token == null ? null : sessions.get(token);
            if (session != null) {
                refreshExpiry(session);
            }
        }
        if (token == null || token.length() != 32 || session == null) {
            throw new ClientError(404, "SESSION_NOT_FOUND");
        }
        respondJson(out, 200, sessionJson(session));
    }

    private void handleExtend(OutputStream out, String token) throws IOException {
        Session session = requireSession(token);
        synchronized (sessions) {
            if (!"active".equals(session.status)) {
                throw new ClientError(session.status.equals("closed") ? 409 : 410,
                        session.status.equals("closed") ? "SESSION_CLOSED" : "SESSION_EXPIRED");
            }
            long next = Math.max(System.currentTimeMillis(), session.expiresAt) + EXTEND_MS;
            session.expiresAt = next;
            for (Photo photo : session.photos.values()) {
                photo.expiresAt = next;
            }
            respondJson(out, 200, "{\"expiresAt\":" + next + ",\"extendedByMs\":" + EXTEND_MS + "}");
        }
    }

    private void handleClose(OutputStream out, String token) throws IOException {
        Session session = requireSession(token);
        synchronized (sessions) {
            for (Photo photo : session.photos.values()) {
                deleteQuietly(photo.file);
            }
            session.photos.clear();
            session.status = "closed";
            session.fileCount = 0;
            session.totalBytes = 0;
        }
        respondJson(out, 200, "{\"ok\":true}");
    }

    private void handleListPhotos(OutputStream out, String token) throws IOException {
        Session session;
        synchronized (sessions) {
            session = token == null ? null : sessions.get(token);
            if (session == null) {
                throw new ClientError(404, "SESSION_NOT_FOUND");
            }
            refreshExpiry(session);
            if (!"active".equals(session.status)) {
                // Files are gone; report the status like Convex does.
                respondJson(out, 200, "{\"status\":\"" + session.status + "\","
                        + "\"autoAccept\":" + session.autoAccept + ",\"photos\":[]}");
                return;
            }
            StringBuilder sb = new StringBuilder();
            sb.append("{\"status\":\"").append(session.status).append("\",")
                    .append("\"autoAccept\":").append(session.autoAccept).append(",")
                    .append("\"photos\":[");
            boolean first = true;
            for (Photo photo : session.photos.values()) {
                if ("rejected".equals(photo.status)) {
                    continue;
                }
                if (!first) {
                    sb.append(',');
                }
                first = false;
                sb.append("{\"id\":\"").append(photo.id).append("\",")
                        .append("\"fileName\":\"").append(escape(photo.fileName)).append("\",")
                        .append("\"mimeType\":\"").append(escape(photo.mimeType)).append("\",")
                        .append("\"fileSize\":").append(photo.fileSize).append(',');
                if (photo.width > 0) {
                    sb.append("\"width\":").append(photo.width).append(',');
                }
                if (photo.height > 0) {
                    sb.append("\"height\":").append(photo.height).append(',');
                }
                sb.append("\"status\":\"").append(photo.status).append("\",")
                        .append("\"uploadedAt\":").append(photo.uploadedAt).append(',')
                        .append("\"expiresAt\":").append(photo.expiresAt).append(',')
                        .append("\"url\":\"/api/files/").append(photo.id).append("\"}");
            }
            sb.append("]}");
            respondJson(out, 200, sb.toString());
        }
    }

    private void handleUpload(OutputStream out, String token, String query, byte[] body)
            throws IOException {
        if (body == null || body.length == 0) {
            throw new ClientError(400, "UPLOAD_INVALID");
        }
        Session session = requireSession(token);
        synchronized (sessions) {
            refreshExpiry(session);
            if (!"active".equals(session.status)) {
                throw new ClientError(session.status.equals("closed") ? 409 : 410,
                        session.status.equals("closed") ? "SESSION_CLOSED" : "SESSION_EXPIRED");
            }
            if (body.length > MAX_FILE_BYTES) {
                throw new ClientError(413, "LIMIT_FILE_SIZE");
            }
            if (session.fileCount >= MAX_PHOTOS_PER_SESSION) {
                throw new ClientError(400, "LIMIT_PHOTO_COUNT");
            }
            if (session.totalBytes + body.length > MAX_TOTAL_BYTES) {
                throw new ClientError(400, "LIMIT_TOTAL_BYTES");
            }

            Map<String, String> params = parseQuery(query);
            String declared = params.getOrDefault("mimeType", "image/jpeg");
            String sniffed = sniffImageType(body);
            if (sniffed == null) {
                throw new ClientError(400, "INVALID_FILE_TYPE");
            }
            if (declared.equals("image/heic")) {
                if (!sniffed.equals("image/heic")) {
                    throw new ClientError(400, "INVALID_FILE_TYPE");
                }
            } else if (!declared.equals(sniffed)) {
                throw new ClientError(400, "INVALID_FILE_TYPE");
            }

            String fileName = sanitizeFileName(params.getOrDefault("fileName", "photo.jpg"));
            String id = randomId();
            File file = new File(photoDir, id);
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(body);
            }

            Photo photo = new Photo(id, fileName, declared, body.length, 0, 0,
                    System.currentTimeMillis(), file, session.expiresAt,
                    session.autoAccept ? "accepted" : "pending");
            session.photos.put(id, photo);
            session.fileCount++;
            session.totalBytes += body.length;

            respondJson(out, 200, "{"
                    + "\"id\":\"" + id + "\","
                    + "\"status\":\"" + photo.status + "\","
                    + "\"fileCount\":" + session.fileCount + ","
                    + "\"totalBytesUploaded\":" + session.totalBytes
                    + "}");
        }
    }

    private void handlePhotoAction(OutputStream out, String photoId, String action, byte[] body)
            throws IOException {
        String token = "";
        if (body != null && body.length > 0) {
            String text = new String(body, StandardCharsets.UTF_8);
            int idx = text.indexOf("\"token\":\"");
            if (idx >= 0) {
                int start = idx + 9;
                int end = text.indexOf('"', start);
                if (end > start) {
                    token = text.substring(start, end);
                }
            }
        }
        Session session = requireSession(token);
        synchronized (sessions) {
            Photo photo = session.photos.get(photoId);
            if (photo == null) {
                throw new ClientError(404, "PHOTO_NOT_FOUND");
            }
            switch (action) {
                case "accept":
                    if ("rejected".equals(photo.status)) {
                        throw new ClientError(404, "PHOTO_NOT_FOUND");
                    }
                    photo.status = "accepted";
                    break;
                case "reject":
                    photo.status = "rejected";
                    break;
                case "delete":
                    deleteQuietly(photo.file);
                    session.photos.remove(photoId);
                    session.fileCount = Math.max(0, session.fileCount - 1);
                    session.totalBytes = Math.max(0, session.totalBytes - photo.fileSize);
                    break;
                default:
                    throw new ClientError(404, "PHOTO_NOT_FOUND");
            }
        }
        respondJson(out, 200, "{\"ok\":true}");
    }

    private void handleFile(OutputStream out, String photoId) throws IOException {
        Photo found = null;
        synchronized (sessions) {
            outer:
            for (Session session : sessions.values()) {
                Photo photo = session.photos.get(photoId);
                if (photo != null) {
                    refreshExpiry(session);
                    if (session.photos.containsKey(photoId)) {
                        found = photo;
                    }
                    break outer;
                }
            }
        }
        if (found == null || !found.file.isFile()) {
            respondJson(out, 404, "{\"code\":\"PHOTO_NOT_FOUND\"}");
            return;
        }
        byte[] bytes = readAll(found.file);
        Map<String, String> extra = new LinkedHashMap<>();
        extra.put("Content-Disposition", "inline; filename=\"" + escape(found.fileName) + "\"");
        respond(out, 200, found.mimeType, bytes, extra);
    }

    // --- static files ------------------------------------------------------

    private void serveStatic(OutputStream out, String path) throws IOException {
        String normalized = normalizePath(path);
        String served = normalized;
        byte[] bytes = staticSource.read(served);
        if (bytes == null && !served.equals("index.html")) {
            // SPA fallback: unknown paths must render the app shell, so the
            // content type must come from index.html, not from the request.
            served = "index.html";
            bytes = staticSource.read(served);
        }
        if (bytes == null) {
            respond(out, 404, "text/plain; charset=utf-8", "not found".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        respond(out, 200, contentType(served), bytes, null);
    }

    private static String normalizePath(String path) {
        String p = path.replace('\\', '/');
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        if (p.isEmpty() || p.contains("..")) {
            return "index.html";
        }
        return p;
    }

    private static String contentType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        int dot = lower.lastIndexOf('.');
        String ext = dot >= 0 ? lower.substring(dot) : "";
        switch (ext) {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".ico": return "image/x-icon";
            case ".woff2": return "font/woff2";
            case ".webmanifest": return "application/manifest+json";
            case ".txt": return "text/plain; charset=utf-8";
            // Extensionless SPA routes (/receive, /r/<token>) render the shell.
            case "": return "text/html; charset=utf-8";
            default: return "application/octet-stream";
        }
    }

    // --- helpers -----------------------------------------------------------

    static final class ClientError extends RuntimeException {
        final int status;
        final String code;

        ClientError(int status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }
    }

    private Session requireSession(String token) {
        Session session;
        synchronized (sessions) {
            session = token == null ? null : sessions.get(token);
        }
        if (token == null || token.length() != 32 || session == null) {
            throw new ClientError(404, "SESSION_NOT_FOUND");
        }
        synchronized (sessions) {
            refreshExpiry(session);
        }
        if ("closed".equals(session.status)) {
            throw new ClientError(409, "SESSION_CLOSED");
        }
        if ("expired".equals(session.status)) {
            throw new ClientError(410, "SESSION_EXPIRED");
        }
        return session;
    }

    /** Marks the session expired and deletes its files when past the deadline. */
    private void refreshExpiry(Session session) {
        if ("active".equals(session.status) && session.expiresAt < System.currentTimeMillis()) {
            for (Photo photo : session.photos.values()) {
                deleteQuietly(photo.file);
            }
            session.photos.clear();
            session.fileCount = 0;
            session.totalBytes = 0;
            session.status = "expired";
        }
    }

    private void sweep() {
        long now = System.currentTimeMillis();
        List<Session> drop = new ArrayList<>();
        synchronized (sessions) {
            for (Session session : sessions.values()) {
                refreshExpiry(session);
                if (!"active".equals(session.status) && session.expiresAt < now - PURGE_GRACE_MS) {
                    for (Photo photo : session.photos.values()) {
                        deleteQuietly(photo.file);
                    }
                    drop.add(session);
                }
            }
            for (Session session : drop) {
                sessions.remove(session.token);
            }
        }
    }

    private String sessionJson(Session session) {
        return "{"
                + "\"status\":\"" + session.status + "\","
                + "\"autoAccept\":" + session.autoAccept + ","
                + "\"createdAt\":" + session.createdAt + ","
                + "\"expiresAt\":" + session.expiresAt + ","
                + "\"fileCount\":" + session.fileCount + ","
                + "\"totalBytesUploaded\":" + session.totalBytes + ","
                + "\"path\":\"/r/" + session.token + "\","
                + "\"maxPhotos\":" + MAX_PHOTOS_PER_SESSION + ","
                + "\"maxTotalBytes\":" + MAX_TOTAL_BYTES
                + "}";
    }

    private static String randomToken() {
        StringBuilder sb = new StringBuilder(32);
        for (int i = 0; i < 32; i++) {
            sb.append(TOKEN_ALPHABET.charAt(RANDOM.nextInt(TOKEN_ALPHABET.length())));
        }
        return sb.toString();
    }

    private static String randomId() {
        StringBuilder sb = new StringBuilder(20);
        String hex = "0123456789abcdef";
        for (int i = 0; i < 20; i++) {
            sb.append(hex.charAt(RANDOM.nextInt(16)));
        }
        return sb.toString();
    }

    private static String sanitizeFileName(String name) {
        String cleaned = name.replaceAll("[\\u0000-\\u001f\\u007f]", "").trim();
        cleaned = cleaned.replace('/', '_').replace('\\', '_');
        if (cleaned.length() > 180) {
            cleaned = cleaned.substring(0, 180);
        }
        return cleaned.isEmpty() ? "photo.jpg" : cleaned;
    }

    /** Trusts the bytes, not the client, mirroring the Convex validation. */
    private static String sniffImageType(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && (b[4] & 0xFF) == 0x0D && (b[5] & 0xFF) == 0x0A && (b[6] & 0xFF) == 0x1A && (b[7] & 0xFF) == 0x0A) {
            return "image/png";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        if (b.length >= 12 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
            String brand = new String(b, 8, 4, StandardCharsets.US_ASCII);
            if (brand.matches("heic|heix|hevc|hevx|heif|mif1|msf1")) {
                return "image/heic";
            }
        }
        return null;
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                out.put(urlDecode(pair.substring(0, eq)), urlDecode(pair.substring(eq + 1)));
            }
        }
        return out;
    }

    private static String urlDecode(String value) {
        try {
            return java.net.URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return value;
        }
    }

    private static String escape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private static byte[] readAll(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file)) {
            return readFully(in, (int) file.length());
        }
    }

    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] data = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(data, read, length - read);
            if (n < 0) {
                throw new IOException("unexpected end of stream");
            }
            read += n;
        }
        return data;
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') {
                break;
            }
            if (c != '\r') {
                buffer.write(c);
            }
        }
        if (c == -1 && buffer.size() == 0) {
            return null;
        }
        return buffer.toString("UTF-8");
    }

    private void respondJson(OutputStream out, int status, String json) throws IOException {
        respond(out, status, "application/json; charset=utf-8",
                json.getBytes(StandardCharsets.UTF_8), null);
    }

    private void respond(OutputStream out, int status, String contentType, byte[] body,
                         Map<String, String> extraHeaders) throws IOException {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : "Error";
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Connection: close\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type\r\n");
        if (extraHeaders != null) {
            for (Map.Entry<String, String> e : extraHeaders.entrySet()) {
                head.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        head.append("\r\n");
        out.write(head.toString().getBytes(StandardCharsets.US_ASCII));
        if (body.length > 0) {
            out.write(body);
        }
        out.flush();
    }

    /** Serves files from a plain directory (desktop tests and extracted assets). */
    public static class FileStaticSource implements StaticSource {
        private final File root;

        public FileStaticSource(File root) {
            this.root = root;
        }

        @Override
        public byte[] read(String path) {
            File file = new File(root, path);
            if (!file.isFile()) {
                return null;
            }
            try {
                return readAll(file);
            } catch (IOException e) {
                return null;
            }
        }
    }
}
