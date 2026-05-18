import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Same mkcert-first / basic-ssl-fallback resolution as the main app —
 *  see vite.config.ts for the full rationale. */
function resolveHttps(root: string): { cert: Buffer; key: Buffer } | "fallback" {
  const files = fs
    .readdirSync(root)
    .filter((f) => f.startsWith("localhost+") || f.startsWith("localhost."));
  const keyFile = files.find((f) => f.endsWith("-key.pem"));
  if (keyFile) {
    const certFile = keyFile.replace("-key.pem", ".pem");
    if (files.includes(certFile)) {
      try {
        return {
          cert: fs.readFileSync(path.join(root, certFile)),
          key: fs.readFileSync(path.join(root, keyFile)),
        };
      } catch {
        /* fall through */
      }
    }
  }
  return "fallback";
}

// Separate Vite app for the sysadmin SPA. Lives at `sysadmin/index.html` with
// its own entrypoint `src/sysadmin/main.tsx`. Dev: port 5174 (main app stays on
// 5173). Prod: `dist/sysadmin/` — deploy to admin.<domain> in production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 (not "localhost") skips Node's IPv4/IPv6 happy-eyeballs probe
  // that on Windows can surface as EACCES if the API isn't listening on ::1.
  const target = env.SERVER_URL ?? "http://127.0.0.1:3001";
  // HTTPS=0 disables TLS entirely. Kept in sync with the main app config.
  const httpsEnabled = env.HTTPS !== "0";
  const httpsResolution = httpsEnabled ? resolveHttps(__dirname) : null;
  const usesMkcert =
    httpsResolution !== null && httpsResolution !== "fallback";
  return {
    root: path.resolve(__dirname, "sysadmin"),
    publicDir: path.resolve(__dirname, "public"),
    plugins: [
      react(),
      ...(httpsResolution === "fallback" ? [basicSsl()] : []),
    ],
    resolve: {
      alias: {
        "/src": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: 5174,
      host: env.HOST || undefined,
      ...(usesMkcert ? { https: httpsResolution } : {}),
      fs: {
        allow: [path.resolve(__dirname)],
      },
      proxy: {
        "/api": { target, changeOrigin: false, secure: false },
      },
    },
    build: {
      outDir: path.resolve(__dirname, "dist/sysadmin"),
      emptyOutDir: true,
    },
  };
});
