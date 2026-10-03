package com.giovannimazza.paldrop;

import android.Manifest;
import android.content.Context;
import android.content.res.AssetManager;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.util.PermissionHelper;
import com.giovannimazza.paldrop.local.LocalHttpServer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

/**
 * Exposes the offline backend (LocalHttpServer) to JavaScript so the app can
 * offer a dedicated "start offline server" button: the phone then serves both
 * the web app and its API on the LAN, and the transfer works without internet.
 */
@CapacitorPlugin(
    name = "PaldropLocal",
    permissions = {
        @Permission(
            strings = { Manifest.permission.NEARBY_WIFI_DEVICES },
            alias = LocalServerPlugin.NEARBY_ALIAS
        ),
        @Permission(
            strings = { Manifest.permission.ACCESS_FINE_LOCATION },
            alias = LocalServerPlugin.LOCATION_ALIAS
        )
    }
)
public class LocalServerPlugin extends Plugin {

    static final String NEARBY_ALIAS = "nearby";
    static final String LOCATION_ALIAS = "location";
    private static final int PREFERRED_PORT = 8787;
    private static LocalHttpServer server; // survives WebView reloads

    // Local-only hotspot state (kept alive: the reservation releases the AP).
    private volatile WifiManager.LocalOnlyHotspotReservation hotspotReservation;
    private volatile String hotspotSsid;
    private volatile String hotspotPassphrase;
    private volatile PluginCall hotspotPendingCall;

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

    // --- local-only hotspot (network between the two phones, no router) ----

    @PluginMethod
    public void startHotspot(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("HOTSPOT_UNSUPPORTED", "HOTSPOT_UNSUPPORTED");
            return;
        }
        if (hotspotReservation != null && hotspotSsid != null) {
            resolveHotspot(call);
            return;
        }
        // Android 13+ needs NEARBY_WIFI_DEVICES, older versions
        // ACCESS_FINE_LOCATION (see the local-only hotspot docs).
        if (!PermissionHelper.hasPermissions(getContext(), neededHotspotPermission())) {
            requestPermissionForAlias(neededHotspotAlias(), call, "onHotspotPermissionResult");
            return;
        }
        startHotspotInternal(call);
    }

    @PluginMethod
    @PermissionCallback
    public void onHotspotPermissionResult(PluginCall call) {
        if (!PermissionHelper.hasPermissions(getContext(), neededHotspotPermission())) {
            call.reject("PERMISSION_DENIED", "PERMISSION_DENIED");
            return;
        }
        startHotspotInternal(call);
    }

    @PluginMethod
    public void stopHotspot(PluginCall call) {
        releaseHotspot();
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }

    @PluginMethod
    public void hotspotStatus(PluginCall call) {
        call.resolve(hotspotJson());
    }

    private String neededHotspotAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? NEARBY_ALIAS : LOCATION_ALIAS;
    }

    private String[] neededHotspotPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? new String[] { Manifest.permission.NEARBY_WIFI_DEVICES }
                : new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
    }

    private void startHotspotInternal(PluginCall call) {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) {
            call.reject("HOTSPOT_FAILED", "HOTSPOT_FAILED");
            return;
        }
        if (hotspotPendingCall != null) {
            call.reject("HOTSPOT_BUSY", "HOTSPOT_BUSY");
            return;
        }
        hotspotPendingCall = call;
        try {
            wifi.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
                @Override
                public void onStarted(WifiManager.LocalOnlyHotspotReservation reservation) {
                    hotspotReservation = reservation;
                    readHotspotCredentials(reservation);
                    PluginCall pending = hotspotPendingCall;
                    hotspotPendingCall = null;
                    if (pending != null) {
                        resolveHotspot(pending);
                    }
                }

                @Override
                public void onFailed(int reason) {
                    releaseHotspot();
                    PluginCall pending = hotspotPendingCall;
                    hotspotPendingCall = null;
                    if (pending != null) {
                        pending.reject("HOTSPOT_FAILED:" + reason, "HOTSPOT_FAILED");
                    }
                }

                @Override
                public void onStopped() {
                    releaseHotspot();
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (SecurityException e) {
            hotspotPendingCall = null;
            call.reject("PERMISSION_DENIED", "PERMISSION_DENIED");
        } catch (Exception e) {
            hotspotPendingCall = null;
            call.reject("HOTSPOT_FAILED", "HOTSPOT_FAILED");
        }
    }

    @SuppressWarnings("deprecation")
    private void readHotspotCredentials(WifiManager.LocalOnlyHotspotReservation reservation) {
        String ssid = null;
        String passphrase = null;
        try {
            // API 30+: SoftApConfiguration exposes the credentials directly.
            android.net.wifi.SoftApConfiguration softAp = reservation.getSoftApConfiguration();
            if (softAp != null) {
                ssid = softAp.getSsid();
                passphrase = softAp.getPassphrase();
            }
        } catch (Exception ignored) {
            // fall back to the deprecated WifiConfiguration below
        }
        if (ssid == null) {
            try {
                WifiConfiguration cfg = reservation.getWifiConfiguration();
                if (cfg != null) {
                    ssid = cfg.SSID;
                    passphrase = cfg.preSharedKey;
                }
            } catch (Exception ignored) {
                // leave unset; resolveHotspot will report failure
            }
        }
        if (ssid != null && ssid.length() > 1 && ssid.startsWith("\"") && ssid.endsWith("\"")) {
            ssid = ssid.substring(1, ssid.length() - 1);
        }
        hotspotSsid = ssid;
        hotspotPassphrase = passphrase;
    }

    private void resolveHotspot(PluginCall call) {
        if (hotspotSsid == null) {
            call.reject("HOTSPOT_FAILED", "HOTSPOT_FAILED");
            return;
        }
        JSObject info = hotspotJson();
        info.put("running", true);
        call.resolve(info);
    }

    private JSObject hotspotJson() {
        JSObject info = new JSObject();
        boolean running = hotspotReservation != null && hotspotSsid != null;
        info.put("running", running);
        if (running) {
            info.put("ssid", hotspotSsid);
            info.put("passphrase", hotspotPassphrase);
        }
        return info;
    }

    private void releaseHotspot() {
        WifiManager.LocalOnlyHotspotReservation reservation = hotspotReservation;
        hotspotReservation = null;
        hotspotSsid = null;
        hotspotPassphrase = null;
        if (reservation != null) {
            try {
                reservation.close();
            } catch (Exception ignored) {
                // already released
            }
        }
    }

    private JSObject infoJson() {
        JSObject info = new JSObject();
        boolean running = server != null && server.isRunning();
        info.put("running", running);
        if (running) {
            // With the local-only hotspot up, the reachable address is the AP
            // interface's, not the Wi-Fi client one.
            boolean preferHotspot = hotspotReservation != null;
            String ip = findLanIp(preferHotspot);
            int port = server.getPort();
            info.put("ip", ip);
            info.put("port", port);
            info.put("url", "http://" + ip + ":" + port);
        }
        return info;
    }

    /**
     * Non-loopback site-local IPv4 (Wi-Fi, hotspot, ethernet). When the
     * local-only hotspot is active the AP interface wins, otherwise the
     * regular client interface does.
     */
    private String findLanIp(boolean preferHotspot) {
        List<String> apAddresses = new ArrayList<>();
        List<String> clientAddresses = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface nif = interfaces.nextElement();
                if (!nif.isUp() || nif.isLoopback()) {
                    continue;
                }
                boolean apLike = isHotspotInterfaceName(nif.getName());
                Enumeration<InetAddress> addresses = nif.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) {
                        (apLike ? apAddresses : clientAddresses).add(address.getHostAddress());
                    }
                }
            }
        } catch (IOException ignored) {
            // fall through to the loopback address
        }
        List<String> ordered = new ArrayList<>();
        if (preferHotspot) {
            ordered.addAll(apAddresses);
            ordered.addAll(clientAddresses);
        } else {
            ordered.addAll(clientAddresses);
            ordered.addAll(apAddresses);
        }
        return ordered.isEmpty() ? "127.0.0.1" : ordered.get(0);
    }

    private static boolean isHotspotInterfaceName(String rawName) {
        String name = rawName == null ? "" : rawName.toLowerCase(Locale.ROOT);
        return name.startsWith("ap")
                || name.startsWith("swlan")
                || name.startsWith("hotspot")
                || name.startsWith("tether")
                || name.equals("wlan1")
                || name.equals("wlan2");
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
