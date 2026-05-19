import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

interface OpenOptions {
  /** Postgres connection string. Pass an in-memory variant for tests is not
   *  supported — Postgres needs a real server. Tests should use a shared
   *  testcontainer or schema-per-test on a dev PG. */
  databaseUrl: string;
  /** Run migrations after connecting. Defaults to true. */
  runMigrations?: boolean;
  /** Override migrations folder (only used for tests/CLI). */
  migrationsFolder?: string;
}

export async function openDb(
  opts: OpenOptions,
): Promise<{ db: DB; pool: pg.Pool }> {
  const pool = new pg.Pool({ connectionString: opts.databaseUrl });
  const db = drizzle(pool, { schema });

  if (opts.runMigrations ?? true) {
    const folder =
      opts.migrationsFolder ?? path.resolve(import.meta.dirname, "migrations");
    if (fs.existsSync(folder)) {
      await migrate(db, { migrationsFolder: folder });
    }
  }

  return { db, pool };
}

let cached: { db: DB; pool: pg.Pool } | null = null;
let cachedPromise: Promise<{ db: DB; pool: pg.Pool }> | null = null;

/** Lazy singleton for the running server. Returns a promise on first call so
 *  migrations run before any query; subsequent calls return the cached DB
 *  synchronously via getDb(). */
export async function initDb(): Promise<DB> {
  if (cached) return cached.db;
  if (!cachedPromise) {
    const databaseUrl =
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5433/ozon_calc";
    cachedPromise = openDb({ databaseUrl });
  }
  cached = await cachedPromise;
  return cached.db;
}

/** Synchronous accessor — only valid after `initDb()` has resolved. Throws
 *  if called before initDb completes. The server bootstrap awaits initDb()
 *  before mounting routes, so handler code can use this safely. */
export function getDb(): DB {
  if (!cached) {
    throw new Error("getDb() called before initDb() resolved");
  }
  return cached.db;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.pool.end();
    cached = null;
    cachedPromise = null;
  }
}
