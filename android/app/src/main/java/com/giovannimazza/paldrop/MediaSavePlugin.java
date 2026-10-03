package com.giovannimazza.paldrop;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Saves a remote photo into a user-visible public folder.
 *
 * The WebView has no download manager and ignores the HTML `download`
 * attribute for cross-origin URLs, so downloads must happen natively.
 * Images land in Pictures/Paldrop (visible in the gallery), everything
 * else in Download/Paldrop. On Android 10+ this uses MediaStore, which
 * needs no storage permission.
 */
@CapacitorPlugin(name = "MediaSave")
public class MediaSavePlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final String SUBFOLDER = "Paldrop";

    @PluginMethod
    public void save(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/jpeg");
        if (url == null || fileName == null) {
            call.reject("MISSING_ARGS");
            return;
        }

        // Networking + disk I/O off the bridge thread.
        new Thread(() -> {
            try {
                byte[] bytes = download(url);
                Uri uri = store(bytes, fileName, mimeType);
                JSObject result = new JSObject();
                result.put("uri", uri.toString());
                result.put("bytes", bytes.length);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("SAVE_FAILED: " + error.getMessage(), "SAVE_FAILED", error);
            }
        }, "paldrop-save").start();
    }

    private byte[] download(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.connect();
        int status = connection.getResponseCode();
        // HttpURLConnection does not follow cross-protocol redirects itself.
        if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
            String location = connection.getHeaderField("Location");
            if (location != null) {
                connection.disconnect();
                connection = (HttpURLConnection) new URL(location).openConnection();
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.connect();
                status = connection.getResponseCode();
            }
        }
        if (status / 100 != 2) {
            connection.disconnect();
            throw new IllegalStateException("HTTP " + status);
        }
        try (InputStream in = connection.getInputStream()) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            connection.disconnect();
            byte[] bytes = buffer.toByteArray();
            if (bytes.length == 0) {
                throw new IllegalStateException("empty response");
            }
            return bytes;
        }
    }

    private Uri store(byte[] bytes, String fileName, String mimeType) throws Exception {
        boolean isImage = mimeType.startsWith("image/");
        Context context = getContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            String relativePath = isImage
                    ? Environment.DIRECTORY_PICTURES + File.separator + SUBFOLDER
                    : Environment.DIRECTORY_DOWNLOADS + File.separator + SUBFOLDER;
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);

            Uri collection = isImage
                    ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            ContentResolver resolver = context.getContentResolver();
            Uri item = resolver.insert(collection, values);
            if (item == null) {
                throw new IllegalStateException("MediaStore insert failed");
            }
            try (OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) {
                    throw new IllegalStateException("openOutputStream failed");
                }
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(item, values, null, null);
            return item;
        }

        // Android 9 and lower: direct write to the public folder.
        File baseDir = new File(
                Environment.getExternalStoragePublicDirectory(
                        isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS),
                SUBFOLDER);
        if (!baseDir.exists() && !baseDir.mkdirs()) {
            throw new IllegalStateException("cannot create " + baseDir);
        }
        File file = new File(baseDir, fileName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return Uri.fromFile(file);
    }
}
