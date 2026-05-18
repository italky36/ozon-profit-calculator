import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

/** Resolve a usable HTTPS config for the dev server. Priority:
 *
 *   1. Local mkcert files (`localhost+N.pem` + `localhost+N-key.pem` in
 *      the project root) — trusted by the browser, no flags or warnings.
 *      Service worker registration and getUserMedia work out of the box.
 *   2. @vitejs/plugin-basic-ssl — auto-generated self-signed cert as a
 *      fallback. Browser shows «Not Secure» and refuses to register
 *      service workers without per-origin Chrome flags / launch options.
 *
 * Returns `null` when the user explicitly disables HTTPS via `HTTPS=0`. */
function resolveHttps(): { cert: Buffer; key: Buffer } | "fallback" | null {
  const root = process.cwd();
  const files = fs
    .readdirSync(root)
    .filter((f) => f.startsWith("localhost+") || f.startsWith("localhost."));
  // Look for a `*-key.pem` / matching `*.pem` pair created by mkcert.
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 (not "localhost") skips Node's IPv4/IPv6 happy-eyeballs probe
  // that on Windows can surface as EACCES if the API isn't listening on ::1.
  const target = env.SERVER_URL ?? "http://127.0.0.1:3001";
  // HTTPS=0 disables TLS entirely (handy when downstream tooling chokes on
  // self-signed). Default: on — required for `getUserMedia` over LAN IPs
  // and for service-worker push end-to-end.
  const httpsEnabled = env.HTTPS !== "0";
  const httpsResolution = httpsEnabled ? resolveHttps() : null;
  const usesMkcert =
    httpsResolution !== null && httpsResolution !== "fallback";
  return {
    plugins: [
      react(),
      // basic-ssl is only registered when mkcert files aren't found. With
      // mkcert we feed cert/key into `server.https` directly.
      ...(httpsResolution === "fallback" ? [basicSsl()] : []),
    ],
    server: {
      // HOST=0.0.0.0 to expose on all interfaces (LAN). Default localhost.
      host: env.HOST || undefined,
      ...(usesMkcert ? { https: httpsResolution } : {}),
      proxy: {
        // ws: true forwards WebSocket upgrades (used by /api/chat/ws).
        // secure:false — backend stays on plain http://, Vite terminates
        // TLS in front of itself only.
        "/api": { target, changeOrigin: false, ws: true, secure: false },
      },
    },
  };
});
