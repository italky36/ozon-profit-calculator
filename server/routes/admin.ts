import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  iceServers,
  sessions,
  smtpSettings,
  users,
  vapidSettings,
  workspaceMembers,
  workspaces,
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
import { resolveAppUrl } from "../lib/appUrl";
import { requireSysadmin } from "../middleware/session";
import {
  generateVapidKeys,
  getVapidConfig,
  invalidateVapid,
  isPushConfigured,
} from "../lib/webPush";

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
  fullName: u.fullName,
  jobTitle: u.jobTitle,
  avatarDataUrl: u.avatarDataUrl,
  createdAt: u.createdAt.toISOString(),
  updatedAt: u.updatedAt.toISOString(),
});

export function adminRoutes(db: DB): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.use("*", requireSysadmin);

  app.get("/users", (c) => {
    const rows = db.select().from(users).all();
    // Workspace lookup in a single query — keeps /users a constant-cost call.
    const memberships = db
      .select({
        userId: workspaceMembers.userId,
        workspaceId: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .all();
    const byUser = new Map<
      number,
      { id: number; name: string; slug: string; role: string }
    >();
    for (const m of memberships) {
      byUser.set(m.userId, {
        id: m.workspaceId,
        name: m.name,
        slug: m.slug,
        role: m.role,
      });
    }
    return c.json(
      rows.map((u) => ({
        ...userPayload(u),
        workspace: byUser.get(u.id) ?? null,
      })),
    );
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
    const verifyLink = `${resolveAppUrl(c)}/verify-email?token=${encodeURIComponent(token)}`;
    try {
      await getEmailClient().send(generateVerificationEmail(row.email, verifyLink));
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

  // === Workspaces (platform overview) ===

  /** All workspaces in the platform with member/shop counts and the email of
   * the primary owner. Paginated only by limit (we expect <10k workspaces). */
  app.get("/workspaces", (c) => {
    const rows = db.all<{
      id: number;
      name: string;
      slug: string;
      created_at: number;
      suspended_at: number | null;
      member_count: number;
      shop_count: number;
      owner_email: string | null;
    }>(sql`
      SELECT
        w.id AS id,
        w.name AS name,
        w.slug AS slug,
        w.created_at AS created_at,
        w.suspended_at AS suspended_at,
        (SELECT count(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
        (SELECT count(*) FROM shops s WHERE s.workspace_id = w.id) AS shop_count,
        (
          SELECT u.email FROM workspace_members wm
          INNER JOIN users u ON u.id = wm.user_id
          WHERE wm.workspace_id = w.id AND wm.role = 'owner'
          ORDER BY wm.created_at ASC
          LIMIT 1
        ) AS owner_email
      FROM workspaces w
      ORDER BY w.created_at ASC
    `);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        memberCount: Number(r.member_count),
        shopCount: Number(r.shop_count),
        ownerEmail: r.owner_email ?? null,
        createdAt:
          typeof r.created_at === "number"
            ? r.created_at
            : new Date(r.created_at).getTime(),
        suspendedAt:
          r.suspended_at == null
            ? null
            : typeof r.suspended_at === "number"
              ? r.suspended_at
              : new Date(r.suspended_at).getTime(),
      })),
    );
  });

  /** Toggle a platform pause on a workspace. Suspending revokes all member
   * sessions immediately; un-suspending just clears the flag (members log in
   * fresh). Sysadmins are never affected (they're not in workspace_members). */
  app.put("/workspaces/:id/suspended", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as { suspended?: unknown };
    if (typeof r.suspended !== "boolean")
      return c.json({ error: "suspended must be boolean" }, 400);

    const existing = db
      .select({ id: workspaces.id, suspendedAt: workspaces.suspendedAt })
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .get();
    if (!existing) return c.json({ error: "workspace not found" }, 404);

    const now = new Date();
    db.update(workspaces)
      .set({
        suspendedAt: r.suspended ? now : null,
        updatedAt: now,
      })
      .where(eq(workspaces.id, id))
      .run();

    if (r.suspended) {
      // Kick every non-sysadmin member off all devices. Sysadmins shouldn't be
      // in workspace_members in the first place, but filter defensively in
      // case a future migration puts them there.
      const memberIds = db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, id))
        .all()
        .map((m) => m.userId);
      if (memberIds.length > 0) {
        db.delete(sessions).where(inArray(sessions.userId, memberIds)).run();
      }
    }

    return c.json({
      id,
      suspendedAt: r.suspended ? now.getTime() : null,
    });
  });

  // Members of a specific workspace — feeds the accordion-expansion on the
  // sysadmin → Команды tab. Sysadmin-only by virtue of the requireSysadmin
  // middleware mounted on this router.
  app.get("/workspaces/:id/members", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);
    const ws = db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .get();
    if (!ws) return c.json({ error: "workspace not found" }, 404);
    const rows = db
      .select({
        userId: workspaceMembers.userId,
        email: users.email,
        role: workspaceMembers.role,
        isBlocked: users.isBlocked,
        isVerified: users.isVerified,
        createdAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, id))
      .all();
    return c.json(
      rows
        .map((r) => ({
          userId: r.userId,
          email: r.email,
          role: r.role,
          isBlocked: r.isBlocked,
          isVerified: r.isVerified,
          createdAt: r.createdAt.getTime(),
        }))
        .sort((a, b) => a.createdAt - b.createdAt),
    );
  });

  app.delete("/workspaces/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0)
      return c.json({ error: "invalid id" }, 400);
    const existing = db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .get();
    if (!existing) return c.json({ error: "workspace not found" }, 404);
    // Cascades: members, shops, products, finance_transactions, import_runs,
    // tariff sets, invites — all FK ON DELETE CASCADE to workspaces.id.
    db.delete(workspaces).where(eq(workspaces.id, id)).run();
    return c.json({ ok: true });
  });

  // === VAPID settings (Web Push) ===
  // GET — current keys (private masked) + source descriptor.
  // PUT — replace keys (sysadmin can paste fresh ones from CLI or click
  // «сгенерировать»).
  // DELETE — clear DB row → fallback to env vars.
  // POST /generate — fresh keypair returned to UI (sysadmin chooses to save).
  app.get("/vapid", (c) => {
    const row = db
      .select()
      .from(vapidSettings)
      .where(eq(vapidSettings.id, 1))
      .get();
    const cfg = getVapidConfig();
    const envFallback =
      !row && cfg != null
        ? "env"
        : row
          ? "db"
          : ("none" as const);
    return c.json({
      source: envFallback,
      configured: isPushConfigured(),
      publicKey: cfg?.publicKey ?? null,
      subject: cfg?.subject ?? null,
      // Never echo the private key — only confirm whether one is stored.
      hasPrivateKey: cfg != null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  });

  app.put("/vapid", async (c) => {
    let body: {
      publicKey?: unknown;
      privateKey?: unknown;
      subject?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const publicKey = String(body.publicKey ?? "").trim();
    const privateKey = String(body.privateKey ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    if (!publicKey || !privateKey || !subject) {
      return c.json(
        { error: "publicKey + privateKey + subject обязательны" },
        400,
      );
    }
    if (!/^mailto:/i.test(subject) && !/^https?:\/\//i.test(subject)) {
      return c.json(
        { error: "subject должен быть mailto: или https:// URL" },
        400,
      );
    }
    const now = new Date();
    const existing = db
      .select({ id: vapidSettings.id })
      .from(vapidSettings)
      .where(eq(vapidSettings.id, 1))
      .get();
    if (existing) {
      db.update(vapidSettings)
        .set({ publicKey, privateKey, subject, updatedAt: now })
        .where(eq(vapidSettings.id, 1))
        .run();
    } else {
      db.insert(vapidSettings)
        .values({ id: 1, publicKey, privateKey, subject, updatedAt: now })
        .run();
    }
    invalidateVapid();
    return c.json({ ok: true });
  });

  app.delete("/vapid", (c) => {
    db.delete(vapidSettings).where(eq(vapidSettings.id, 1)).run();
    invalidateVapid();
    return c.json({ ok: true });
  });

  app.post("/vapid/generate", (c) => {
    const { publicKey, privateKey } = generateVapidKeys();
    return c.json({ publicKey, privateKey });
  });

  // === ICE servers (Stage 5 — WebRTC) ===
  // Sysadmin manages the STUN/TURN pool that clients use when building a
  // RTCPeerConnection. List endpoint mirrors /api/chat/ice (which strips
  // disabled rows + credentials) but here we expose everything.
  app.get("/ice", (c) => {
    const rows = db
      .select()
      .from(iceServers)
      .orderBy(iceServers.sortOrder, iceServers.id)
      .all();
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        urls: r.urls,
        username: r.username,
        credential: r.credential,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });

  app.post("/ice", async (c) => {
    let body: {
      urls?: unknown;
      username?: unknown;
      credential?: unknown;
      enabled?: unknown;
      sortOrder?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const urls = String(body.urls ?? "").trim();
    if (!urls) return c.json({ error: "urls обязателен" }, 400);
    if (!/^(stun|turn|turns):/i.test(urls)) {
      return c.json(
        { error: "urls должен начинаться с stun: / turn: / turns:" },
        400,
      );
    }
    const username =
      body.username == null ? null : String(body.username).trim() || null;
    const credential =
      body.credential == null ? null : String(body.credential).trim() || null;
    const enabled = body.enabled == null ? true : Boolean(body.enabled);
    const sortOrder =
      typeof body.sortOrder === "number" ? Math.trunc(body.sortOrder) : 0;
    const now = new Date();
    const result = db
      .insert(iceServers)
      .values({
        urls,
        username,
        credential,
        enabled,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json({
      id: result.id,
      urls: result.urls,
      username: result.username,
      credential: result.credential,
      enabled: result.enabled,
      sortOrder: result.sortOrder,
    });
  });

  app.patch("/ice/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
    const existing = db
      .select()
      .from(iceServers)
      .where(eq(iceServers.id, id))
      .get();
    if (!existing) return c.json({ error: "not found" }, 404);
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "expected JSON" }, 400);
    }
    const patch: Partial<typeof iceServers.$inferInsert> = {};
    if (typeof body.urls === "string") {
      const urls = body.urls.trim();
      if (!urls) return c.json({ error: "urls пуст" }, 400);
      if (!/^(stun|turn|turns):/i.test(urls)) {
        return c.json(
          { error: "urls должен начинаться с stun: / turn: / turns:" },
          400,
        );
      }
      patch.urls = urls;
    }
    if ("username" in body) {
      patch.username =
        body.username == null ? null : String(body.username).trim() || null;
    }
    if ("credential" in body) {
      patch.credential =
        body.credential == null
          ? null
          : String(body.credential).trim() || null;
    }
    if ("enabled" in body) patch.enabled = Boolean(body.enabled);
    if (typeof body.sortOrder === "number") {
      patch.sortOrder = Math.trunc(body.sortOrder);
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "нет изменений" }, 400);
    }
    patch.updatedAt = new Date();
    db.update(iceServers).set(patch).where(eq(iceServers.id, id)).run();
    return c.json({ ok: true });
  });

  app.delete("/ice/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
    db.delete(iceServers).where(eq(iceServers.id, id)).run();
    return c.json({ ok: true });
  });

  return app;
}
