package com.giovannimazza.paldrop;

import android.content.res.AssetManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.giovannimazza.paldrop.local.LocalHttpServer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;

/**
 * Exposes the offline backend (LocalHttpServer) to JavaScript so the app can
 * offer a dedicated "start offline server" button: the phone then serves both
 * the web app and its API on the LAN, and the transfer works without internet.
 */
@CapacitorPlugin(name = "PaldropLocal")
public class LocalServerPlugin extends Plugin {

    private static final int PREFERRED_PORT = 8787;
    private static LocalHttpServer server; // survives WebView reloads

    @PluginMethod
    public void start(PluginCall call) {
        new Thread(() -> {
            try {
                if (server == null || !server.isRunning()) {
                    File webRoot = extractWebRoot();
                    File dataDir = new File(getContext().getFilesDir(), "localserver");
                    LocalHttpServer instance = new LocalHttpServer(
                            PREFERRED_PORT, dataDir, new LocalHttpServer.FileStaticSource(webRoot));
                    instance.start(PREFERRED_PORT);
                    server = instance;
                }
                call.resolve(infoJson());
            } catch (Exception e) {
                call.reject("SERVER_START_FAILED: " + e.getMessage(), "SERVER_START_FAILED", e);
            }
        }, "paldrop-local-start").start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (server != null) {
            server.stop();
            server = null;
        }
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(infoJson());
    }

    private JSObject infoJson() {
        JSObject info = new JSObject();
        boolean running = server != null && server.isRunning();
        info.put("running", running);
        if (running) {
            String ip = findLanIp();
            int port = server.getPort();
            info.put("ip", ip);
            info.put("port", port);
            info.put("url", "http://" + ip + ":" + port);
        }
        return info;
    }

    /** First non-loopback site-local IPv4 (Wi-Fi, hotspot, ethernet). */
    private String findLanIp() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface nif = interfaces.nextElement();
                if (!nif.isUp() || nif.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> addresses = nif.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (IOException ignored) {
            // fall through
        }
        return "127.0.0.1";
    }

    /** Copies assets/public into filesDir/webroot so the server can serve files. */
    private File extractWebRoot() throws IOException {
        File webRoot = new File(getContext().getFilesDir(), "webroot");
        deleteRecursive(webRoot);
        copyAssetDir(getContext().getAssets(), "public", webRoot);
        if (!new File(webRoot, "index.html").isFile()) {
            throw new IOException("web assets missing (assets/public/index.html)");
        }
        return webRoot;
    }

    private void copyAssetDir(AssetManager assets, String assetPath, File targetDir) throws IOException {
        String[] children = assets.list(assetPath);
        if (children == null) {
            return;
        }
        if (!targetDir.exists() && !targetDir.mkdirs()) {
            throw new IOException("cannot create " + targetDir);
        }
        for (String child : children) {
            String childAsset = assetPath + "/" + child;
            File childTarget = new File(targetDir, child);
            String[] grandchildren = assets.list(childAsset);
            if (grandchildren != null && grandchildren.length > 0) {
                copyAssetDir(assets, childAsset, childTarget);
            } else {
                try (InputStream in = assets.open(childAsset);
                     FileOutputStream out = new FileOutputStream(childTarget)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                    }
                }
            }
        }
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
