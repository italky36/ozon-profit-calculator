import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 (not "localhost") skips Node's IPv4/IPv6 happy-eyeballs probe
  // that on Windows can surface as EACCES if the API isn't listening on ::1.
  const target = env.SERVER_URL ?? "http://127.0.0.1:3001";
  // HTTPS=0 disables the self-signed cert (handy when something downstream
  // doesn't like https://localhost). Default: on — required for `getUserMedia`
  // / WebRTC over LAN IPs and for testing service-worker push end-to-end.
  const httpsEnabled = env.HTTPS !== "0";
  return {
    plugins: [react(), ...(httpsEnabled ? [basicSsl()] : [])],
    server: {
      // HOST=0.0.0.0 to expose on all interfaces (LAN). Default localhost.
      host: env.HOST || undefined,
      proxy: {
        // ws: true forwards WebSocket upgrades (used by /api/chat/ws).
        // secure:false — backend stays on plain http://, the plugin only
        // terminates TLS in front of Vite itself.
        "/api": { target, changeOrigin: false, ws: true, secure: false },
      },
    },
  };
});
