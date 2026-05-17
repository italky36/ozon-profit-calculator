import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Storage-agnostic abstraction over chat-attachment payloads. Local impl
 * writes under `data/uploads/`; future S3-compatible impl will replace this
 * one without touching routes. */
export interface FileStorage {
  /** Persist a blob. `key` is the logical path (e.g. workspace-scoped). */
  put(key: string, data: Buffer): Promise<void>;
  /** Read a blob into a Buffer. Throws when missing. */
  read(key: string): Promise<Buffer>;
  /** Delete a blob. No-op when missing. */
  delete(key: string): Promise<void>;
  /** Existence + size probe. Returns null when absent. */
  stat(key: string): Promise<{ size: number } | null>;
}

/** Local filesystem backend. Root is configurable; defaults to
 * `<cwd>/data/uploads`. The key is appended verbatim — callers are
 * responsible for safe path composition (workspace prefix, sanitized
 * filenames). Reads/writes guard against path-traversal by resolving the
 * final path and asserting it lives under `root`. */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? path.join(process.cwd(), "data", "uploads"));
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep) && target !== this.root) {
      throw new Error("invalid storage key");
    }
    return target;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }

  async read(key: string): Promise<Buffer> {
    const target = this.resolve(key);
    return fsp.readFile(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    try {
      await fsp.unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async stat(key: string): Promise<{ size: number } | null> {
    const target = this.resolve(key);
    try {
      const s = await fsp.stat(target);
      return { size: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

let cached: FileStorage | null = null;
export function getFileStorage(): FileStorage {
  if (!cached) cached = new LocalFileStorage();
  return cached;
}
/** For tests: inject a custom backend (e.g. in-memory). */
export function setFileStorage(fs: FileStorage | null): void {
  cached = fs;
}

/** Filename sanitizer: keep latin/cyrillic/digits/_-., drop directory parts,
 * collapse spaces, cap length. Pair with a random id prefix at the storage
 * key level to disambiguate collisions. */
export function safeFilename(raw: string): string {
  const base = path.basename(raw || "file");
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "_").trim();
  const collapsed = cleaned.replace(/\s+/g, " ");
  const capped = collapsed.slice(0, 120);
  return capped || "file";
}

/** Workspace-scoped storage key: `{workspaceId}/{YYYY-MM}/{attachmentId}_{safeName}`. */
export function buildStorageKey(
  workspaceId: number,
  attachmentId: number,
  filename: string,
  now: Date = new Date(),
): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${workspaceId}/${yyyy}-${mm}/${attachmentId}_${safeFilename(filename)}`;
}

/** Ensure the upload root exists. Called lazily in tests / on first write. */
export function ensureUploadRoot(): void {
  const root = path.resolve(path.join(process.cwd(), "data", "uploads"));
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
}
