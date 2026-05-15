import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { sessions, smtpSettings, users } from "../db/schema";
import {
  createVerificationToken,
  type SessionUser,
} from "../auth/utils";
import {
  describeEmailSource,
  getEmailClient,
  invalidateEmailClient,
} from "../email/client";
import { generateVerificationEmail } from "../email/templates";
import { requireSysadmin } from "../middleware/session";

type AdminEnv = { Variables: { user?: SessionUser } };

/** Stage-2 compat: API still exposes a `role` field on user payloads. Frontend
 * (Stage 6) will switch to `isSysadmin`, but until then we emit the legacy
 * shape so AdminPage.tsx keeps rendering.  */
const userPayload = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  role: u.isSysadmin ? ("admin" as const) : ("user" as const),
  isSysadmin: u.isSysadmin,
  isVerified: u.isVerified,
  isBlocked: u.isBlocked,
  createdAt: u.createdAt.toISOString(),
  updatedAt: u.updatedAt.toISOString(),
});

export function adminRoutes(db: DB): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.use("*", requireSysadmin);

  app.get("/users", (c) => {
    const rows = db.select().from(users).all();
    return c.json(rows.map(userPayload));
  });

  /** Toggle sysadmin flag. Body still accepts the legacy `{role: 'admin'|'user'}`
   * shape from the existing UI; "admin" maps to isSysadmin=true. */
  app.put("/users/:id/role", async (c) => {
    const me = c.get("user")!;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as { role?: unknown; isSysadmin?: unknown };
    let nextSysadmin: boolean;
    if (typeof r.isSysadmin === "boolean") {
      nextSysadmin = r.isSysadmin;
    } else if (r.role === "admin") {
      nextSysadmin = true;
    } else if (r.role === "user") {
      nextSysadmin = false;
    } else {
      return c.json({ error: "invalid role" }, 400);
    }

    if (id === me.id && !nextSysadmin)
      return c.json({ error: "cannot demote yourself" }, 400);

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!existing) return c.json({ error: "user not found" }, 404);

    const now = new Date();
    db.update(users)
      .set({ isSysadmin: nextSysadmin, updatedAt: now })
      .where(eq(users.id, id))
      .run();

    const updated = db.select().from(users).where(eq(users.id, id)).get()!;
    return c.json(userPayload(updated));
  });

  app.put("/users/:id/blocked", async (c) => {
    const me = c.get("user")!;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as { blocked?: unknown };
    if (typeof r.blocked !== "boolean")
      return c.json({ error: "blocked must be boolean" }, 400);

    if (id === me.id)
      return c.json({ error: "cannot block yourself" }, 400);

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!existing) return c.json({ error: "user not found" }, 404);

    const now = new Date();
    db.update(users)
      .set({ isBlocked: r.blocked, updatedAt: now })
      .where(eq(users.id, id))
      .run();

    if (r.blocked) {
      // Kick the user off all devices immediately.
      db.delete(sessions).where(eq(sessions.userId, id)).run();
    }

    const updated = db.select().from(users).where(eq(users.id, id)).get()!;
    return c.json(userPayload(updated));
  });

  app.delete("/users/:id", (c) => {
    const me = c.get("user")!;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);
    if (id === me.id)
      return c.json({ error: "cannot delete yourself" }, 400);

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!existing) return c.json({ error: "user not found" }, 404);

    // sessions/email_verification_tokens/user_settings/workspace_members
    // cascade via FK.
    db.delete(users).where(eq(users.id, id)).run();
    return c.json({ message: "user deleted" });
  });

  app.post("/users/:id/resend-verification", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);

    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) return c.json({ error: "user not found" }, 404);
    if (row.isVerified)
      return c.json({ error: "user already verified" }, 400);

    const { token } = createVerificationToken(db, row.id);
    try {
      await getEmailClient().send(generateVerificationEmail(row.email, token));
    } catch (e) {
      console.error("[admin] failed to send verification email:", e);
      return c.json({ error: "failed to send email" }, 500);
    }
    return c.json({ message: "verification email sent" });
  });

  app.post("/users/:id/revoke-sessions", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!existing) return c.json({ error: "user not found" }, 404);

    db.delete(sessions).where(eq(sessions.userId, id)).run();
    return c.json({ message: "sessions revoked" });
  });

  // === SMTP settings ===

  app.get("/smtp", (c) => {
    const row = db
      .select()
      .from(smtpSettings)
      .where(eq(smtpSettings.id, 1))
      .get();
    return c.json({
      source: describeEmailSource(),
      host: row?.host ?? null,
      port: row?.port ?? null,
      user: row?.user ?? null,
      from: row?.fromAddr ?? null,
      secure: row?.secure ?? "auto",
      hasPassword: !!row?.pass,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  });

  app.put("/smtp", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as {
      host?: unknown;
      port?: unknown;
      user?: unknown;
      pass?: unknown;
      from?: unknown;
      secure?: unknown;
    };
    if (typeof r.host !== "string" || !r.host.trim())
      return c.json({ error: "host is required" }, 400);
    if (
      typeof r.port !== "number" ||
      !Number.isInteger(r.port) ||
      r.port <= 0 ||
      r.port > 65535
    )
      return c.json({ error: "port must be 1..65535" }, 400);
    if (typeof r.user !== "string" || !r.user.trim())
      return c.json({ error: "user is required" }, 400);
    if (typeof r.from !== "string" || !r.from.trim())
      return c.json({ error: "from is required" }, 400);
    if (
      r.pass !== undefined &&
      r.pass !== "" &&
      typeof r.pass !== "string"
    )
      return c.json({ error: "pass must be a string" }, 400);
    const SECURE_VALUES = ["auto", "ssl", "starttls", "none"] as const;
    type SecureMode = (typeof SECURE_VALUES)[number];
    let secure: SecureMode = "auto";
    if (r.secure !== undefined) {
      if (
        typeof r.secure !== "string" ||
        !(SECURE_VALUES as readonly string[]).includes(r.secure)
      )
        return c.json(
          { error: "secure must be one of: auto, ssl, starttls, none" },
          400,
        );
      secure = r.secure as SecureMode;
    }

    const existing = db
      .select()
      .from(smtpSettings)
      .where(eq(smtpSettings.id, 1))
      .get();
    const pass =
      typeof r.pass === "string" && r.pass.length > 0
        ? r.pass
        : existing?.pass;
    if (!pass) return c.json({ error: "pass is required" }, 400);

    const now = new Date();
    if (existing) {
      db.update(smtpSettings)
        .set({
          host: r.host,
          port: r.port,
          user: r.user,
          pass,
          fromAddr: r.from,
          secure,
          updatedAt: now,
        })
        .where(eq(smtpSettings.id, 1))
        .run();
    } else {
      db.insert(smtpSettings)
        .values({
          id: 1,
          host: r.host,
          port: r.port,
          user: r.user,
          pass,
          fromAddr: r.from,
          secure,
          updatedAt: now,
        })
        .run();
    }
    invalidateEmailClient();
    return c.json({ ok: true });
  });

  app.delete("/smtp", (c) => {
    db.delete(smtpSettings).where(eq(smtpSettings.id, 1)).run();
    invalidateEmailClient();
    return c.json({ ok: true });
  });

  app.post("/smtp/test", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as { to?: unknown; subject?: unknown };
    if (typeof r.to !== "string" || !r.to.includes("@"))
      return c.json({ error: "to must be an email" }, 400);
    const subject =
      typeof r.subject === "string" && r.subject.trim()
        ? r.subject.trim()
        : "Тест отправки писем — Калькулятор Ozon";

    const source = describeEmailSource();
    if (source === "console") {
      return c.json(
        {
          ok: false,
          source,
          error:
            "SMTP не настроен — письма пишутся в stdout сервера, а не отправляются. Заполните Host/Port/User/Password/From и сохраните.",
        },
        400,
      );
    }

    try {
      await getEmailClient().send({
        to: r.to,
        subject,
        text:
          "Это тестовое письмо из админки калькулятора Ozon. Если вы его получили, SMTP-настройки работают корректно.",
        html: "<p>Это тестовое письмо из админки калькулятора Ozon. Если вы его получили, SMTP-настройки работают корректно.</p>",
      });
    } catch (e) {
      console.error("[admin] smtp test failed:", e);
      const err = e as Error & {
        code?: string;
        response?: string;
        responseCode?: number;
        command?: string;
      };
      return c.json(
        {
          ok: false,
          source,
          error: err.message,
          code: err.code ?? null,
          responseCode: err.responseCode ?? null,
          response: err.response ?? null,
          command: err.command ?? null,
        },
        500,
      );
    }
    return c.json({ ok: true, source });
  });

  return app;
}
