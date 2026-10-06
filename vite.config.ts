/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
  },
  // Set BASE_PATH when hosting under a sub-path (e.g. /paldrop/ on GitHub Pages).
  base: process.env.BASE_PATH ?? "/",
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
