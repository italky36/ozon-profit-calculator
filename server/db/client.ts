import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

interface OpenOptions {
  /** Path to the SQLite file. Pass `:memory:` for tests. */
  dbPath: string;
  /** When true, run migrations on open. Defaults to true for file DBs, false for in-memory. */
  runMigrations?: boolean;
  /** Override migrations folder (only used for tests/CLI). */
  migrationsFolder?: string;
}

export function openDb(opts: OpenOptions): { db: DB; sqlite: Database.Database } {
  const { dbPath } = opts;
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  const shouldMigrate = opts.runMigrations ?? dbPath !== ":memory:";
  if (shouldMigrate) {
    const folder =
      opts.migrationsFolder ?? path.resolve(import.meta.dirname, "migrations");
    if (fs.existsSync(folder)) {
      migrate(db, { migrationsFolder: folder });
    }
  }

  return { db, sqlite };
}

let cached: { db: DB; sqlite: Database.Database } | null = null;

/** Lazy singleton for the running server. */
export function getDb(): DB {
  if (!cached) {
    const dbPath = process.env.DB_PATH ?? "data/app.db";
    cached = openDb({ dbPath });
  }
  return cached.db;
}

export function closeDb(): void {
  if (cached) {
    cached.sqlite.close();
    cached = null;
  }
}
