import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.SERVER_URL ?? "http://localhost:3001";
  return {
    plugins: [react()],
    server: {
      // HOST=0.0.0.0 to expose on all interfaces (LAN). Default localhost.
      host: env.HOST || undefined,
      proxy: {
        "/api": { target, changeOrigin: false },
      },
    },
  };
});
