import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  shops,
  userSettings,
  users,
  workspaceMembers,
  workspaces,
} from "../db/schema";
import { readDefaultTaxSettings } from "../settings/defaults";
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

/** Stage-2 compat: keep `role` on the wire (frontend reads it from
 * /auth/me + /auth/login). Will be replaced with `isSysadmin` in Stage 6. */
function publicUser(u: SessionUser) {
  return {
    id: u.id,
    email: u.email,
    role: u.isSysadmin ? ("admin" as const) : ("user" as const),
    isSysadmin: u.isSysadmin,
    isVerified: u.isVerified,
    workspaceId: u.workspaceId,
    workspaceRole: u.workspaceRole,
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

/** Build a unique slug for a fresh personal workspace. Mirrors the SQL backfill
 * from migration 0019: `<email-prefix-with-dashes>-<userId>`. */
function buildPersonalSlug(email: string, userId: number): string {
  const prefix = email.split("@")[0] ?? "user";
  return `${prefix.replace(/\./g, "-").toLowerCase()}-${userId}`;
}

/** Create a personal workspace for `userId` + owner membership + a default
 * shop with active_shop_id pointing at it. Idempotent: if any of these already
 * exist (legacy migration, repeat verify), reuses them. Returns the active
 * shop id for downstream use. */
function ensurePersonalWorkspace(
  db: DB,
  userId: number,
  email: string,
): number {
  const now = new Date();

  let member = db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .get();

  if (!member) {
    const slug = buildPersonalSlug(email, userId);
    const ws = db
      .insert(workspaces)
      .values({
        name: `Workspace ${email.split("@")[0]}`,
        slug,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: workspaces.id })
      .get();
    db.insert(workspaceMembers)
      .values({
        workspaceId: ws.id,
        userId,
        role: "owner",
        status: "active",
        createdAt: now,
      })
      .run();
    member = { workspaceId: ws.id };
  }

  const existingShop = db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.workspaceId, member.workspaceId))
    .get();
  let activeShopId: number;
  if (existingShop) {
    activeShopId = existingShop.id;
  } else {
    const inserted = db
      .insert(shops)
      .values({
        workspaceId: member.workspaceId,
        name: "Мой магазин",
        shortName: "M1",
        color: null,
        taxSettings: readDefaultTaxSettings(db),
        autoRefreshEnabled: false,
        autoRefreshIntervalMin: 30,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: shops.id })
      .all();
    activeShopId = inserted[0].id;
  }

  const existingSettings = db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();
  if (existingSettings) {
    db.update(userSettings)
      .set({ activeShopId, updatedAt: now })
      .where(eq(userSettings.userId, userId))
      .run();
  } else {
    db.insert(userSettings)
      .values({ userId, activeShopId, updatedAt: now })
      .run();
  }
  return activeShopId;
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
        isSysadmin: false,
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

    ensurePersonalWorkspace(db, row.id, row.email);

    const { sessionId, expiresAt } = createSession(db, row.id);
    setSessionCookie(c, sessionId, expiresAt);

    // Re-read membership info into a SessionUser shape for the response.
    const member = db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, row.id))
      .get();
    return c.json({
      user: publicUser({
        id: row.id,
        email: row.email,
        isSysadmin: row.isSysadmin,
        isVerified: true,
        workspaceId: member?.workspaceId ?? 0,
        workspaceRole: member?.role ?? "owner",
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

    const member = db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, row.id))
      .get();
    return c.json({
      user: publicUser({
        id: row.id,
        email: row.email,
        isSysadmin: row.isSysadmin,
        isVerified: row.isVerified,
        workspaceId: member?.workspaceId ?? 0,
        workspaceRole: member?.role ?? "member",
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
