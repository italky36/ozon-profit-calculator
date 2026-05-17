import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 (not "localhost") skips Node's IPv4/IPv6 happy-eyeballs probe
  // that on Windows can surface as EACCES if the API isn't listening on ::1.
  const target = env.SERVER_URL ?? "http://127.0.0.1:3001";
  return {
    plugins: [react()],
    server: {
      // HOST=0.0.0.0 to expose on all interfaces (LAN). Default localhost.
      host: env.HOST || undefined,
      proxy: {
        // ws: true forwards WebSocket upgrades (used by /api/chat/ws).
        "/api": { target, changeOrigin: false, ws: true },
      },
    },
  };
});
