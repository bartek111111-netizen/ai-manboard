import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev server: port 5173, proxies /api to the Node server (127.0.0.1:3100).
 * The production build (base: './') is served by the server itself
 * (apps/web/dist) — see apps/server/src/app.ts.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.AI_DASHBOARD_DEV_API ?? "http://127.0.0.1:3100",
        changeOrigin: true,
      },
    },
  },
});
