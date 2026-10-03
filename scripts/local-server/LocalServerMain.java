// Desktop harness: runs the app's offline LocalHttpServer on a JVM so the
// backend can be smoke-tested without a phone (see scripts/smoke-local.mjs).
import com.giovannimazza.paldrop.local.LocalHttpServer;

import java.io.File;

public class LocalServerMain {
    public static void main(String[] args) throws Exception {
        File staticRoot = new File(args[0]);
        File dataDir = new File(args[1]);
        int port = args.length > 2 ? Integer.parseInt(args[2]) : 8787;
        LocalHttpServer server =
                new LocalHttpServer(port, dataDir, new LocalHttpServer.FileStaticSource(staticRoot));
        System.out.println("PORT=" + server.start(port));
    }
}
