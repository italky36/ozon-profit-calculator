import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Separate Vite app for the sysadmin SPA. Lives at `sysadmin/index.html` with
// its own entrypoint `src/sysadmin/main.tsx`. Dev: port 5174 (main app stays on
// 5173). Prod: `dist/sysadmin/` — deploy to admin.<domain> in production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 (not "localhost") skips Node's IPv4/IPv6 happy-eyeballs probe
  // that on Windows can surface as EACCES if the API isn't listening on ::1.
  const target = env.SERVER_URL ?? "http://127.0.0.1:3001";
  return {
    root: path.resolve(__dirname, "sysadmin"),
    publicDir: path.resolve(__dirname, "public"),
    plugins: [react()],
    resolve: {
      alias: {
        "/src": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: 5174,
      host: env.HOST || undefined,
      fs: {
        allow: [path.resolve(__dirname)],
      },
      proxy: {
        "/api": { target, changeOrigin: false },
      },
    },
    build: {
      outDir: path.resolve(__dirname, "dist/sysadmin"),
      emptyOutDir: true,
    },
  };
});
