import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
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
import { getDb } from "./db/client";
import { setEmailClientDb } from "./email/client";

export interface BuildAppOptions {
  db?: ReturnType<typeof getDb>;
  importContext?: ImportContext;
}

export function buildApp(opts: BuildAppOptions = {}): Hono {
  const db = opts.db ?? getDb();
  setEmailClientDb(db);

  const app = new Hono();
  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true }));

  const api = new Hono();
  api.use("*", sessionMiddleware(db));
  api.route("/auth", authRoutes(db));
  api.route("/admin", adminRoutes(db));
  api.use("*", requireAuth);
  api.route("/refs", refsRoutes(db));
  api.route("/shops", shopsRoutes(db));
  api.route("/products", productsRoutes(db));
  api.route("/settings", settingsRoutes(db));
  api.route("/credentials", credentialsRoutes(db));
  api.route("/import", importRoutes(db, opts.importContext));
  api.route("/finance", financeRoutes(db));
  api.route("/analytics", analyticsRoutes(db));

  app.route("/api", api);
  return app;
}

const entry = process.argv[1];
const isMain = entry ? import.meta.url === pathToFileURL(entry).href : false;
if (isMain || process.env.START_SERVER === "1") {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3001);
  // HOST=0.0.0.0 exposes on all interfaces (LAN). Default localhost.
  const hostname = process.env.HOST || "localhost";
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.log(`server: http://${hostname}:${info.port}`);
  });
}
