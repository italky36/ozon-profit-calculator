import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { users } from "../db/schema";
import {
  consumeVerificationToken,
  createSession,
  createVerificationToken,
  deleteSession,
  hashPassword,
  verifyPassword,
  type SessionUser,
} from "../auth/utils";
import { getEmailClient } from "../email/client";
import { generateVerificationEmail } from "../email/templates";
import { SESSION_COOKIE_NAME } from "../middleware/session";

type AuthEnv = { Variables: { user?: SessionUser } };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

interface Credentials {
  email: string;
  password: string;
}

function validateCredentials(raw: unknown): Credentials | string {
  if (!raw || typeof raw !== "object") return "Некорректные данные";
  const r = raw as Partial<Credentials>;
  if (typeof r.email !== "string" || !EMAIL_RE.test(r.email))
    return "Некорректный email";
  if (typeof r.password !== "string" || r.password.length < PASSWORD_MIN)
    return `Пароль должен быть не короче ${PASSWORD_MIN} символов`;
  return { email: r.email.trim().toLowerCase(), password: r.password };
}

function publicUser(u: SessionUser) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    isVerified: u.isVerified,
  };
}

function setSessionCookie(
  c: Context,
  sessionId: string,
  expiresAt: Date,
): void {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
}

export function authRoutes(db: DB): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.post("/register", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const parsed = validateCredentials(body);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.email))
      .get();
    if (existing) return c.json({ error: "Этот email уже зарегистрирован" }, 409);

    const passwordHash = await hashPassword(parsed.password);
    const now = new Date();
    const inserted = db
      .insert(users)
      .values({
        email: parsed.email,
        passwordHash,
        role: "user",
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    const { token } = createVerificationToken(db, inserted.id);
    try {
      await getEmailClient().send(
        generateVerificationEmail(parsed.email, token),
      );
    } catch (e) {
      console.error("[auth] failed to send verification email:", e);
    }

    return c.json({
      message: "Регистрация прошла успешно. Проверьте почту, чтобы подтвердить email.",
    });
  });

  app.post("/verify-email", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as { token?: unknown };
    if (typeof r.token !== "string" || !r.token)
      return c.json({ error: "Не указан токен" }, 400);

    const consumed = consumeVerificationToken(db, r.token);
    if (!consumed) return c.json({ error: "Неверный или просроченный токен" }, 400);

    const now = new Date();
    db.update(users)
      .set({ isVerified: true, updatedAt: now })
      .where(eq(users.id, consumed.userId))
      .run();

    const row = db
      .select()
      .from(users)
      .where(eq(users.id, consumed.userId))
      .get();
    if (!row) return c.json({ error: "Пользователь не найден" }, 404);

    const { sessionId, expiresAt } = createSession(db, row.id);
    setSessionCookie(c, sessionId, expiresAt);
    return c.json({
      user: publicUser({
        id: row.id,
        email: row.email,
        role: row.role,
        isVerified: row.isVerified,
      }),
    });
  });

  app.post("/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const parsed = validateCredentials(body);
    if (typeof parsed === "string")
      return c.json({ error: "Неверный email или пароль" }, 401);

    const row = db
      .select()
      .from(users)
      .where(eq(users.email, parsed.email))
      .get();
    if (!row) return c.json({ error: "Неверный email или пароль" }, 401);

    const ok = await verifyPassword(parsed.password, row.passwordHash);
    if (!ok) return c.json({ error: "Неверный email или пароль" }, 401);

    if (row.isBlocked)
      return c.json(
        { error: "Учётная запись заблокирована администратором" },
        403,
      );

    if (!row.isVerified)
      return c.json({ error: "Email не подтверждён. Проверьте почту." }, 403);

    const { sessionId, expiresAt } = createSession(db, row.id);
    setSessionCookie(c, sessionId, expiresAt);
    return c.json({
      user: publicUser({
        id: row.id,
        email: row.email,
        role: row.role,
        isVerified: row.isVerified,
      }),
    });
  });

  app.post("/logout", async (c) => {
    const sid = getCookie(c, SESSION_COOKIE_NAME);
    if (sid) deleteSession(db, sid);
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.json({ message: "logged out" });
  });

  app.get("/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ user: publicUser(user) });
  });

  return app;
}
