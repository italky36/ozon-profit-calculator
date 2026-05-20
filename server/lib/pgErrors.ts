/** Postgres error helpers. drizzle-orm/node-postgres wraps низкоуровневую
 *  pg-ошибку в собственный DrizzleQueryError, при этом исходная ошибка
 *  попадает в `.cause`. Чтобы получить SQLSTATE (например, 23505 для
 *  уникальной нарушения), надо смотреть и e и e.cause. */

interface PgErrorLike {
  code?: string;
  cause?: unknown;
  message?: string;
  detail?: string;
  column?: string;
  constraint?: string;
  table?: string;
}

/** Спуститься по цепочке `.cause` до первого узла с реальным pg-кодом
 *  (5-символьный SQLSTATE). Если нет — вернуть исходный объект, чтобы
 *  у вызывающей стороны был хоть какой-то message. */
function unwrapPgError(e: unknown): PgErrorLike | null {
  if (e == null || typeof e !== "object") return null;
  const err = e as PgErrorLike;
  if (typeof err.code === "string" && err.code.length === 5) return err;
  if (err.cause) {
    const inner = unwrapPgError(err.cause);
    if (inner) return inner;
  }
  return err;
}

/** Достать человекочитаемое сообщение из ошибки drizzle/pg.
 *  Drizzle оборачивает pg-ошибку в DrizzleQueryError, чей `.message` —
 *  «Failed query: <SQL>». Реальная причина — в `.cause`. Возвращаем
 *  message+detail+SQLSTATE без SQL-портянки. */
export function extractPgErrorMessage(e: unknown): string {
  const pg = unwrapPgError(e);
  if (!pg) return String(e);
  const parts: string[] = [];
  if (pg.message) parts.push(pg.message);
  if (pg.detail) parts.push(pg.detail);
  if (pg.code) parts.push(`SQLSTATE ${pg.code}`);
  // Fallback на исходный message если ничего полезного не извлекли.
  return parts.join(" — ") || (e as Error).message || String(e);
}

/** True для нарушения unique-constraint (SQLSTATE 23505). Срабатывает и на
 *  сырых node-postgres ошибках, и на обёрнутых drizzle. */
export function isUniqueViolation(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const err = e as PgErrorLike;
  if (err.code === "23505") return true;
  if (err.cause && isUniqueViolation(err.cause)) return true;
  // Fallback: текст ошибки. На localized PG русские строки тоже работают,
  // потому что англоязычный SQLSTATE-name `unique_violation` обычно
  // присутствует или текст содержит `duplicate key`.
  const msg = err.message ?? "";
  return msg.includes("duplicate key") || msg.includes("UNIQUE");
}

/** True для violation FK constraint (SQLSTATE 23503). */
export function isForeignKeyViolation(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const err = e as PgErrorLike;
  if (err.code === "23503") return true;
  if (err.cause && isForeignKeyViolation(err.cause)) return true;
  const msg = err.message ?? "";
  return msg.includes("foreign key");
}
