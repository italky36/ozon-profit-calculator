import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  sessions,
  shops,
  userSettings,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "../db/schema";
import { readDefaultTaxSettings } from "../settings/defaults";
import {
  checkPasswordResetToken,
  consumePasswordResetToken,
  consumeVerificationToken,
  createPasswordResetToken,
  createSession,
  createVerificationToken,
  deleteSession,
  hashPassword,
  verifyPassword,
  type SessionUser,
} from "../auth/utils";
import { getEmailClient } from "../email/client";
import {
  generatePasswordResetEmail,
  generateVerificationEmail,
} from "../email/templates";
import {
  readAppScope,
  SESSION_COOKIE_NAME,
  SYSADMIN_COOKIE_NAME,
  type AppScope,
} from "../middleware/session";

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

function cookieNameForScope(scope: AppScope): string {
  return scope === "sysadmin" ? SYSADMIN_COOKIE_NAME : SESSION_COOKIE_NAME;
}

function setSessionCookie(
  c: Context,
  sessionId: string,
  expiresAt: Date,
  scope: AppScope = "workspace",
): void {
  setCookie(c, cookieNameForScope(scope), sessionId, {
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

    const r = (body ?? {}) as {
      workspaceName?: unknown;
      inviteToken?: unknown;
    };
    const inviteToken =
      typeof r.inviteToken === "string" && r.inviteToken.trim()
        ? r.inviteToken.trim()
        : null;

    let invite:
      | typeof workspaceInvites.$inferSelect
      | null = null;
    if (inviteToken) {
      const inv = db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.token, inviteToken))
        .get();
      if (!inv)
        return c.json({ error: "Приглашение не найдено" }, 404);
      if (inv.usedAt)
        return c.json({ error: "Приглашение уже использовано" }, 410);
      if (inv.expiresAt.getTime() < Date.now())
        return c.json({ error: "Приглашение просрочено" }, 410);
      invite = inv;
    }

    let workspaceName = "";
    if (!invite) {
      workspaceName =
        typeof r.workspaceName === "string" ? r.workspaceName.trim() : "";
      if (!workspaceName)
        return c.json({ error: "Укажите название команды" }, 400);
      if (workspaceName.length > 80)
        return c.json({ error: "Название команды не длиннее 80 символов" }, 400);
    }

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.email))
      .get();
    if (existing) return c.json({ error: "Этот email уже зарегистрирован" }, 409);

    const passwordHash = await hashPassword(parsed.password);
    const now = new Date();
    const defaultTax = readDefaultTaxSettings(db);

    // user → (workspace + owner-membership + default shop) OR (join via invite),
    // atomically.
    const userId = db.transaction((tx) => {
      const u = tx
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

      if (invite) {
        // Join existing workspace via invite.
        tx.insert(workspaceMembers)
          .values({
            workspaceId: invite.workspaceId,
            userId: u.id,
            role: invite.role,
            status: "active",
            createdAt: now,
          })
          .run();
        tx.update(workspaceInvites)
          .set({ usedAt: now })
          .where(eq(workspaceInvites.token, invite.token))
          .run();
        const firstShop = tx
          .select({ id: shops.id })
          .from(shops)
          .where(eq(shops.workspaceId, invite.workspaceId))
          .get();
        tx.insert(userSettings)
          .values({
            userId: u.id,
            activeShopId: firstShop?.id ?? null,
            updatedAt: now,
          })
          .run();
      } else {
        const slug = buildPersonalSlug(parsed.email, u.id);
        const ws = tx
          .insert(workspaces)
          .values({
            name: workspaceName,
            slug,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: workspaces.id })
          .get();

        tx.insert(workspaceMembers)
          .values({
            workspaceId: ws.id,
            userId: u.id,
            role: "owner",
            status: "active",
            createdAt: now,
          })
          .run();

        const shop = tx
          .insert(shops)
          .values({
            workspaceId: ws.id,
            name: "Мой магазин",
            shortName: "M1",
            color: null,
            taxSettings: defaultTax,
            autoRefreshEnabled: false,
            autoRefreshIntervalMin: 30,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: shops.id })
          .get();

        tx.insert(userSettings)
          .values({ userId: u.id, activeShopId: shop.id, updatedAt: now })
          .run();
      }

      return u.id;
    });

    // Sanity guard: if invite email differed from registration email, surface
    // a hint in logs (we still accept — the link grants access regardless).
    if (invite && invite.email.toLowerCase() !== parsed.email.toLowerCase()) {
      console.warn(
        `[auth] invite ${invite.token} consumed by ${parsed.email} (was for ${invite.email})`,
      );
    }

    const { token } = createVerificationToken(db, userId);
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

    // Scope drives both the cookie that gets set and the user-type that's
    // allowed. Default is the workspace SPA scope.
    const scope: AppScope = readAppScope(c) ?? "workspace";

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

    // Scope/type gate: sysadmin can only log in via sysadmin SPA, workspace
    // user only via workspace SPA. Localized hint tells them where to go.
    if (scope === "sysadmin" && !row.isSysadmin)
      return c.json(
        {
          error:
            "Это форма входа в консоль администратора. Используйте основное приложение калькулятора.",
        },
        403,
      );
    if (scope === "workspace" && row.isSysadmin)
      return c.json(
        {
          error:
            "Sysadmin-аккаунты входят через консоль администратора, а не через основное приложение.",
        },
        403,
      );

    const member = db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, row.id))
      .get();

    // Block non-sysadmin members of a suspended workspace at the door.
    // Sysadmins aren't in workspaces and stay reachable for re-enabling.
    if (!row.isSysadmin && member) {
      const ws = db
        .select({ suspendedAt: workspaces.suspendedAt })
        .from(workspaces)
        .where(eq(workspaces.id, member.workspaceId))
        .get();
      if (ws?.suspendedAt)
        return c.json(
          {
            error:
              "Доступ команды приостановлен администратором сервиса. Обратитесь к нему для возобновления.",
          },
          403,
        );
    }

    const { sessionId, expiresAt } = createSession(db, row.id);
    setSessionCookie(c, sessionId, expiresAt, scope);
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
    const scope: AppScope = readAppScope(c) ?? "workspace";
    const cookieName = cookieNameForScope(scope);
    const sid = getCookie(c, cookieName);
    if (sid) deleteSession(db, sid);
    deleteCookie(c, cookieName, { path: "/" });
    return c.json({ message: "logged out" });
  });

  app.get("/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({ user: publicUser(user) });
  });

  // Generic OK message — kept identical for found / not-found / blocked /
  // unverified to avoid leaking which addresses are registered. The reset
  // link is only sent for an active, verified, non-blocked account.
  const FORGOT_OK = {
    message:
      "Если такой email зарегистрирован, мы отправили на него ссылку для восстановления пароля.",
  };

  app.post("/forgot-password", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as { email?: unknown };
    if (typeof r.email !== "string" || !EMAIL_RE.test(r.email))
      return c.json({ error: "Некорректный email" }, 400);
    const email = r.email.trim().toLowerCase();

    const row = db.select().from(users).where(eq(users.email, email)).get();
    // No row, blocked, or unverified → return generic OK without sending.
    // Unverified accounts must finish the verification flow first; sending a
    // reset link would let an attacker bypass verification entirely.
    if (!row || row.isBlocked || !row.isVerified) return c.json(FORGOT_OK);

    const { token } = createPasswordResetToken(db, row.id);
    try {
      await getEmailClient().send(generatePasswordResetEmail(row.email, token));
    } catch (e) {
      console.error("[auth] failed to send password reset email:", e);
    }
    return c.json(FORGOT_OK);
  });

  app.get("/reset-password/:token", async (c) => {
    const token = c.req.param("token");
    if (!token) return c.json({ error: "Не указан токен" }, 400);
    const status = checkPasswordResetToken(db, token);
    if (!status.ok) {
      const msg =
        status.reason === "expired"
          ? "Срок действия ссылки истёк. Запросите восстановление пароля заново."
          : status.reason === "used"
            ? "Эта ссылка уже была использована. Запросите восстановление пароля заново."
            : "Ссылка недействительна. Запросите восстановление пароля заново.";
      return c.json({ error: msg }, 400);
    }
    return c.json({ ok: true });
  });

  app.post("/reset-password", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as { token?: unknown; password?: unknown };
    if (typeof r.token !== "string" || !r.token)
      return c.json({ error: "Не указан токен" }, 400);
    if (typeof r.password !== "string" || r.password.length < PASSWORD_MIN)
      return c.json(
        { error: `Пароль должен быть не короче ${PASSWORD_MIN} символов` },
        400,
      );

    const status = checkPasswordResetToken(db, r.token);
    if (!status.ok) {
      const msg =
        status.reason === "expired"
          ? "Срок действия ссылки истёк. Запросите восстановление пароля заново."
          : status.reason === "used"
            ? "Эта ссылка уже была использована. Запросите восстановление пароля заново."
            : "Ссылка недействительна. Запросите восстановление пароля заново.";
      return c.json({ error: msg }, 400);
    }

    const target = db
      .select()
      .from(users)
      .where(eq(users.id, status.userId))
      .get();
    if (!target)
      return c.json({ error: "Пользователь не найден" }, 404);
    if (target.isBlocked)
      return c.json(
        { error: "Учётная запись заблокирована администратором" },
        403,
      );

    const passwordHash = await hashPassword(r.password);
    const now = new Date();
    db.update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, target.id))
      .run();
    consumePasswordResetToken(db, r.token);
    // Revoke all existing sessions: the user is logging in fresh.
    db.delete(sessions).where(eq(sessions.userId, target.id)).run();

    return c.json({
      message:
        "Пароль обновлён. Войдите с новым паролем.",
    });
  });

  return app;
}
