import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  financeTransactions,
  importRuns,
  products,
  sessions,
  shopAccess,
  shops,
  shopUserSettings,
  smtpSettings,
  users,
} from "../db/schema";
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
import { requireAdmin } from "../middleware/session";

type AdminEnv = { Variables: { user?: SessionUser } };

const ROLES = new Set(["admin", "user"] as const);

export function adminRoutes(db: DB): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.use("*", requireAdmin);

  app.get("/users", (c) => {
    const rows = db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        isVerified: users.isVerified,
        isBlocked: users.isBlocked,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .all();
    return c.json(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        isVerified: r.isVerified,
        isBlocked: r.isBlocked,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    );
  });

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
    const r = (body ?? {}) as { role?: unknown };
    if (typeof r.role !== "string" || !ROLES.has(r.role as "admin" | "user"))
      return c.json({ error: "invalid role" }, 400);
    const role = r.role as "admin" | "user";

    if (id === me.id && role !== "admin")
      return c.json({ error: "cannot demote yourself" }, 400);

    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .get();
    if (!existing) return c.json({ error: "user not found" }, 404);

    const now = new Date();
    db.update(users)
      .set({ role, updatedAt: now })
      .where(eq(users.id, id))
      .run();

    const updated = db.select().from(users).where(eq(users.id, id)).get()!;
    return c.json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      isVerified: updated.isVerified,
      isBlocked: updated.isBlocked,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
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
    return c.json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      isVerified: updated.isVerified,
      isBlocked: updated.isBlocked,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
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

    // sessions/email_verification_tokens/user_settings cascade via FK.
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

  // === Shop sharing ===
  // Admin owns shops via shops.user_id = admin.id. They can grant viewers
  // (shop_access) and revoke them, which also wipes the viewer's per-user data
  // in that shop.

  app.get("/shops", async (c) => {
    const me = c.get("user")!;
    const rows = await db
      .select()
      .from(shops)
      .where(eq(shops.userId, me.id))
      .orderBy(shops.createdAt);
    const accessCounts = await db
      .select({
        shopId: shopAccess.shopId,
        cnt: sql<number>`count(*)`,
      })
      .from(shopAccess)
      .groupBy(shopAccess.shopId);
    const cntMap = new Map<number, number>(
      accessCounts.map((r) => [r.shopId, r.cnt]),
    );
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        shortName: r.shortName,
        color: r.color ?? null,
        hasOzonCreds: !!(r.ozonClientId && r.ozonApiKey),
        viewersCount: cntMap.get(r.id) ?? 0,
        createdAt: r.createdAt.getTime(),
      })),
    );
  });

  app.get("/shops/:id/access", async (c) => {
    const me = c.get("user")!;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.userId, me.id)));
    if (!shop) return c.json({ error: "shop not found" }, 404);

    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        role: users.role,
        isBlocked: users.isBlocked,
        createdAt: shopAccess.createdAt,
      })
      .from(shopAccess)
      .innerJoin(users, eq(users.id, shopAccess.userId))
      .where(eq(shopAccess.shopId, id))
      .orderBy(shopAccess.createdAt);
    return c.json(
      rows.map((r) => ({
        userId: r.userId,
        email: r.email,
        role: r.role,
        isBlocked: r.isBlocked,
        grantedAt: r.createdAt.getTime(),
      })),
    );
  });

  app.post("/shops/:id/access", async (c) => {
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
    const { userId } = (body ?? {}) as { userId?: unknown };
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0)
      return c.json({ error: "userId required" }, 400);

    const [shop] = await db
      .select({ ownerId: shops.userId })
      .from(shops)
      .where(eq(shops.id, id));
    if (!shop || shop.ownerId !== me.id)
      return c.json({ error: "shop not found" }, 404);
    if (uid === me.id)
      return c.json({ error: "owner already has access" }, 400);

    const [target] = await db
      .select({ id: users.id, isBlocked: users.isBlocked })
      .from(users)
      .where(eq(users.id, uid));
    if (!target) return c.json({ error: "user not found" }, 404);
    if (target.isBlocked)
      return c.json({ error: "cannot grant access to a blocked user" }, 400);

    const [existing] = await db
      .select()
      .from(shopAccess)
      .where(and(eq(shopAccess.shopId, id), eq(shopAccess.userId, uid)));
    if (existing) {
      return c.json({ ok: true, alreadyGranted: true });
    }
    await db.insert(shopAccess).values({
      shopId: id,
      userId: uid,
      createdAt: new Date(),
    });
    return c.json({ ok: true });
  });

  app.delete("/shops/:id/access/:userId", async (c) => {
    const me = c.get("user")!;
    const id = Number(c.req.param("id"));
    const uid = Number(c.req.param("userId"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);
    if (!Number.isInteger(uid) || uid <= 0)
      return c.json({ error: "invalid userId" }, 400);

    const [shop] = await db
      .select({ ownerId: shops.userId })
      .from(shops)
      .where(eq(shops.id, id));
    if (!shop || shop.ownerId !== me.id)
      return c.json({ error: "shop not found" }, 404);

    const result = await db
      .delete(shopAccess)
      .where(and(eq(shopAccess.shopId, id), eq(shopAccess.userId, uid)));
    // Also wipe viewer's per-user artefacts in this shop. The shop_access row
    // is gone, so the viewer can no longer reach this data anyway — but
    // leaving rows would leave orphans against an inaccessible shop. Cascade
    // via FK isn't enough because data is keyed on (shop_id, user_id).
    await db
      .delete(shopUserSettings)
      .where(
        and(
          eq(shopUserSettings.shopId, id),
          eq(shopUserSettings.userId, uid),
        ),
      );
    await db
      .delete(products)
      .where(and(eq(products.shopId, id), eq(products.userId, uid)));
    await db
      .delete(financeTransactions)
      .where(
        and(
          eq(financeTransactions.shopId, id),
          eq(financeTransactions.userId, uid),
        ),
      );
    await db
      .delete(importRuns)
      .where(and(eq(importRuns.shopId, id), eq(importRuns.userId, uid)));
    return c.json({ ok: true, revoked: result.changes });
  });

  // List of users who could be granted access to a given shop — every user
  // except the owner and those who already have access. Used to populate the
  // grant modal selector.
  app.get("/shops/:id/access/candidates", async (c) => {
    const me = c.get("user")!;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);
    const [shop] = await db
      .select({ ownerId: shops.userId })
      .from(shops)
      .where(eq(shops.id, id));
    if (!shop || shop.ownerId !== me.id)
      return c.json({ error: "shop not found" }, 404);

    const granted = await db
      .select({ userId: shopAccess.userId })
      .from(shopAccess)
      .where(eq(shopAccess.shopId, id));
    const excludeIds = new Set<number>([me.id, ...granted.map((g) => g.userId)]);

    const all = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        isBlocked: users.isBlocked,
      })
      .from(users);
    return c.json(
      all
        .filter((u) => !excludeIds.has(u.id))
        .map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          isBlocked: u.isBlocked,
        })),
    );
  });

  return app;
}
