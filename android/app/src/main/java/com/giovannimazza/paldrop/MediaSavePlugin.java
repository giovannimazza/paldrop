package com.giovannimazza.paldrop;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.util.PermissionHelper;

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
 * needs no storage permission; on Android 9 and lower the WRITE permission
 * is requested through the system prompt before the first save.
 */
@CapacitorPlugin(
    name = "MediaSave",
    permissions =
        @Permission(
            strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE },
            alias = MediaSavePlugin.STORAGE_ALIAS
        )
)
public class MediaSavePlugin extends Plugin {

    static final String STORAGE_ALIAS = "storage";
    private static final String[] STORAGE_PERMISSIONS = { Manifest.permission.WRITE_EXTERNAL_STORAGE };
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final String SUBFOLDER = "Paldrop";

    @PluginMethod
    public void save(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/jpeg");
        if (url == null || fileName == null) {
            call.reject("MISSING_ARGS", "MISSING_ARGS");
            return;
        }

        // Android 10+ writes through MediaStore: no permission to prompt for.
        // Older versions need WRITE_EXTERNAL_STORAGE, so show the system
        // permission dialog the first time the user taps "Scarica".
        if (needsLegacyStoragePermission()
                && !PermissionHelper.hasPermissions(getContext(), STORAGE_PERMISSIONS)) {
            requestPermissionForAlias(STORAGE_ALIAS, call, "onStoragePermissionResult");
            return;
        }
        runSave(call, url, fileName, mimeType);
    }

    /** Called by Capacitor after the user answered the permission dialog. */
    @PluginMethod
    @PermissionCallback
    public void onStoragePermissionResult(PluginCall call) {
        if (!PermissionHelper.hasPermissions(getContext(), STORAGE_PERMISSIONS)) {
            call.reject("PERMISSION_DENIED", "PERMISSION_DENIED");
            return;
        }
        runSave(call, call.getString("url"), call.getString("fileName"),
                call.getString("mimeType", "image/jpeg"));
    }

    private boolean needsLegacyStoragePermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q;
    }

    private void runSave(PluginCall call, String url, String fileName, String mimeType) {
        if (url == null || fileName == null) {
            call.reject("MISSING_ARGS", "MISSING_ARGS");
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
                Logger.error("MediaSave failed", error);
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
