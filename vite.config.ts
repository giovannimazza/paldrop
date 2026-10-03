import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    watch: {
      // The local Convex backend unpacks its dashboard under .tmp/.
      ignored: ["**/.tmp/**", "**/convex/_generated/**"],
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
