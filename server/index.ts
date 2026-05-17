import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { requireAuth, sessionMiddleware } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { refsRoutes } from "./routes/refs";
import { productsRoutes } from "./routes/products";
import { settingsRoutes } from "./routes/settings";
import { shopsRoutes } from "./routes/shops";
import { credentialsRoutes } from "./routes/credentials";
import { importRoutes } from "./routes/import";
import type { ImportContext } from "./routes/import";
import { financeRoutes } from "./routes/finance";
import { analyticsRoutes } from "./routes/analytics";
import { exportRoutes } from "./routes/export";
import { inviteRoutes, workspaceRoutes } from "./routes/workspace";
import { chatRoutes } from "./routes/chat";
import { getDb } from "./db/client";
import { setEmailClientDb } from "./email/client";

export interface BuildAppOptions {
  db?: ReturnType<typeof getDb>;
  importContext?: ImportContext;
}

export interface BuiltApp {
  app: Hono;
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
}

export function buildApp(opts: BuildAppOptions = {}): Hono {
  return buildAppWithWs(opts).app;
}

export function buildAppWithWs(opts: BuildAppOptions = {}): BuiltApp {
  const db = opts.db ?? getDb();
  setEmailClientDb(db);

  const app = new Hono();
  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true }));

  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  const api = new Hono();
  api.use("*", sessionMiddleware(db));
  api.route("/auth", authRoutes(db));
  api.route("/admin", adminRoutes(db));
  // /api/invites/:token is public (GET) — must be mounted BEFORE requireAuth.
  // The accept handler does its own auth check.
  api.route("/invites", inviteRoutes(db));
  api.use("*", requireAuth);
  api.route("/refs", refsRoutes(db));
  api.route("/shops", shopsRoutes(db));
  api.route("/products", productsRoutes(db));
  api.route("/settings", settingsRoutes(db));
  api.route("/credentials", credentialsRoutes(db));
  api.route("/import", importRoutes(db, opts.importContext));
  api.route("/finance", financeRoutes(db));
  api.route("/analytics", analyticsRoutes(db));
  api.route("/export", exportRoutes());
  api.route("/workspace", workspaceRoutes(db));
  api.route("/chat", chatRoutes(db, upgradeWebSocket));

  app.route("/api", api);
  return { app, injectWebSocket };
}

const entry = process.argv[1];
const isMain = entry ? import.meta.url === pathToFileURL(entry).href : false;
if (isMain || process.env.START_SERVER === "1") {
  const { app, injectWebSocket } = buildAppWithWs();
  const port = Number(process.env.PORT ?? 3001);
  // Default to 127.0.0.1 (loopback) because the API sits behind the Vite
  // dev-proxy — Vite (on the same machine) calls localhost. If we also read
  // the same `HOST` env var that Vite uses for LAN exposure, the API binds
  // only to the LAN IP and Vite's proxy fails with EACCES. Use `API_HOST` if
  // you need to override (e.g. for a remote backend); leave `HOST` for Vite.
  const hostname = process.env.API_HOST ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.log(`server: http://${hostname}:${info.port}`);
  });
  injectWebSocket(server);
}
