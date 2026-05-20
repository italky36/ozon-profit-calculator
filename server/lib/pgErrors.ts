/** Postgres error helpers. drizzle-orm/node-postgres wraps низкоуровневую
 *  pg-ошибку в собственный DrizzleQueryError, при этом исходная ошибка
 *  попадает в `.cause`. Чтобы получить SQLSTATE (например, 23505 для
 *  уникальной нарушения), надо смотреть и e и e.cause. */

interface PgErrorLike {
  code?: string;
  cause?: unknown;
  message?: string;
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
