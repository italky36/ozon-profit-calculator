import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { aliasedTable, and, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  sessions,
  shopMember,
  shops,
  userSettings,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "../db/schema";
import type { SessionUser, WorkspaceRole } from "../auth/utils";
import { canManageWorkspace, requireAuth } from "../middleware/session";
import { getEmailClient } from "../email/client";
import { generateInviteEmail } from "../email/templates";
import { validateImageDataUrl } from "../lib/dataUrl";
import { parseProfilePatch } from "../lib/profile";
import { resolveAppUrl } from "../lib/appUrl";
import type { Context } from "hono";

type Env = { Variables: { user: SessionUser } };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_ROLES: readonly WorkspaceRole[] = ["owner", "manager", "member"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const newToken = () => randomBytes(32).toString("hex");

function inviteLink(c: Context, token: string): string {
  return `${resolveAppUrl(c)}/invite/${encodeURIComponent(token)}`;
}

interface MemberOut {
  userId: number;
  email: string;
  fullName: string;
  jobTitle: string | null;
  avatarDataUrl: string | null;
  role: WorkspaceRole;
  status: "active" | "suspended";
  isBlocked: boolean;
  isYou: boolean;
  createdAt: number;
}

interface InviteOut {
  token: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: { id: number; email: string };
  expiresAt: number;
  createdAt: number;
}

async function listMembers(db: DB, workspaceId: number, currentUserId: number): Promise<MemberOut[]> {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      fullName: users.fullName,
      jobTitle: users.jobTitle,
      avatarDataUrl: users.avatarDataUrl,
      role: workspaceMembers.role,
      status: workspaceMembers.status,
      isBlocked: users.isBlocked,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    ;
  return rows
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      fullName: r.fullName,
      jobTitle: r.jobTitle,
      avatarDataUrl: r.avatarDataUrl,
      role: r.role,
      status: r.status,
      isBlocked: r.isBlocked,
      isYou: r.userId === currentUserId,
      createdAt: r.createdAt.getTime(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function listPendingInvites(db: DB, workspaceId: number): Promise<InviteOut[]> {
  const rows = await db
    .select({
      token: workspaceInvites.token,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      expiresAt: workspaceInvites.expiresAt,
      createdAt: workspaceInvites.createdAt,
      invitedById: users.id,
      invitedByEmail: users.email,
    })
    .from(workspaceInvites)
    .innerJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.usedAt),
      ),
    )
    ;
  const now = Date.now();
  return rows
    .filter((r) => r.expiresAt.getTime() > now)
    .map((r) => ({
      token: r.token,
      email: r.email,
      role: r.role,
      invitedBy: { id: r.invitedById, email: r.invitedByEmail },
      expiresAt: r.expiresAt.getTime(),
      createdAt: r.createdAt.getTime(),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function ownerCount(db: DB, workspaceId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
      ),
    )
    ;
  return row?.n ?? 0;
}

/** Per-workspace «team» management routes. Mount under requireAuth. */
export function workspaceRoutes(db: DB): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/me", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId)
      return c.json({ error: "У вас нет команды" }, 404);
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, user.workspaceId))
      ;
    if (!ws) return c.json({ error: "Команда не найдена" }, 404);
    return c.json({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      color: ws.color,
      logoDataUrl: ws.logoDataUrl,
      useLogoAsAppIcon: ws.useLogoAsAppIcon,
      createdAt: ws.createdAt.getTime(),
      updatedAt: ws.updatedAt.getTime(),
      role: user.workspaceRole,
      members: await listMembers(db, ws.id, user.id),
    });
  });

  app.patch("/me", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (user.workspaceRole !== "owner")
      return c.json({ error: "Только владелец может изменять команду" }, 403);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as {
      name?: unknown;
      slug?: unknown;
      color?: unknown;
      logoDataUrl?: unknown;
      useLogoAsAppIcon?: unknown;
    };

    const patch: Partial<typeof workspaces.$inferInsert> = {};
    if (r.name !== undefined) {
      if (typeof r.name !== "string" || !r.name.trim())
        return c.json({ error: "Имя команды не может быть пустым" }, 400);
      if (r.name.trim().length > 80)
        return c.json({ error: "Имя команды не длиннее 80 символов" }, 400);
      patch.name = r.name.trim();
    }
    if (r.slug !== undefined) {
      if (typeof r.slug !== "string")
        return c.json({ error: "Некорректный slug" }, 400);
      const slug = r.slug.trim().toLowerCase();
      if (slug.length < 3 || slug.length > 40 || !SLUG_RE.test(slug))
        return c.json(
          {
            error:
              "Slug: 3–40 символов, латиница/цифры/дефис, не начинается и не заканчивается дефисом",
          },
          400,
        );
      const [clash] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.slug, slug), sql`${workspaces.id} != ${user.workspaceId}`))
        ;
      if (clash) return c.json({ error: "Такой slug уже занят" }, 409);
      patch.slug = slug;
    }
    if (r.color !== undefined) {
      if (r.color === null) {
        patch.color = null;
      } else if (typeof r.color === "string" && HEX_COLOR_RE.test(r.color)) {
        patch.color = r.color.toLowerCase();
      } else {
        return c.json(
          { error: "Цвет должен быть HEX-кодом (#RGB или #RRGGBB) или null" },
          400,
        );
      }
    }
    if (r.logoDataUrl !== undefined) {
      if (r.logoDataUrl === null) {
        patch.logoDataUrl = null;
      } else {
        const v = validateImageDataUrl(r.logoDataUrl);
        if (!v.ok) return c.json({ error: `Логотип: ${v.error}` }, 400);
        patch.logoDataUrl = v.value;
      }
    }
    if (r.useLogoAsAppIcon !== undefined) {
      if (typeof r.useLogoAsAppIcon !== "boolean")
        return c.json(
          { error: "useLogoAsAppIcon должен быть boolean" },
          400,
        );
      patch.useLogoAsAppIcon = r.useLogoAsAppIcon;
    }

    if (Object.keys(patch).length === 0)
      return c.json({ error: "Нечего обновлять" }, 400);
    patch.updatedAt = new Date();
    await db.update(workspaces).set(patch).where(eq(workspaces.id, user.workspaceId));

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, user.workspaceId));
    if (!ws) return c.json({ error: "workspace not found" }, 404);
    return c.json({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      color: ws.color,
      logoDataUrl: ws.logoDataUrl,
      useLogoAsAppIcon: ws.useLogoAsAppIcon,
      createdAt: ws.createdAt.getTime(),
      updatedAt: ws.updatedAt.getTime(),
    });
  });

  // Matrix view of «who has access to which shop» — single round-trip for the
  // TeamPage UI. Owner sees all workspace shops and can edit every assignment.
  // Manager sees:
  //   - shops they created (canEdit = true) + assignments to them
  //   - shops they themselves are assigned to (canEdit = false), with creator
  //     attribution; only their OWN assignment row is exposed for those (so
  //     other members' presence on those shops is not leaked).
  // Each shop row carries `createdByEmail` so the UI can render «создан X».
  // Each assignment row carries `grantedByEmail` so «доступ от X» is renderable
  // for read-only access.
  app.get("/me/shop-access", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (!canManageWorkspace(user.workspaceRole))
      return c.json(
        { error: "Только владелец или менеджер видит матрицу доступа" },
        403,
      );

    const members = await db
      .select({
        userId: workspaceMembers.userId,
        email: users.email,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, user.workspaceId))
      ;

    type ShopRow = {
      id: number;
      name: string;
      shortName: string;
      color: string | null;
      createdByUserId: number | null;
      createdByEmail: string | null;
      canEdit: boolean;
    };

    const baseShopSelect = {
      id: shops.id,
      name: shops.name,
      shortName: shops.shortName,
      color: shops.color,
      createdByUserId: shops.createdBy,
      createdByEmail: users.email,
    };

    let wsShops: ShopRow[];

    if (user.workspaceRole === "owner") {
      wsShops = (
        await db
          .select(baseShopSelect)
          .from(shops)
          .leftJoin(users, eq(users.id, shops.createdBy))
          .where(eq(shops.workspaceId, user.workspaceId))
      ).map((s) => ({ ...s, canEdit: true }));
    } else {
      // Manager: shops they created (canEdit), plus shops they're assigned to (read-only).
      const own = await db
        .select(baseShopSelect)
        .from(shops)
        .leftJoin(users, eq(users.id, shops.createdBy))
        .where(
          and(
            eq(shops.workspaceId, user.workspaceId),
            eq(shops.createdBy, user.id),
          ),
        )
        ;
      const assigned = await db
        .select(baseShopSelect)
        .from(shops)
        .innerJoin(shopMember, eq(shopMember.shopId, shops.id))
        .leftJoin(users, eq(users.id, shops.createdBy))
        .where(
          and(
            eq(shops.workspaceId, user.workspaceId),
            eq(shopMember.userId, user.id),
          ),
        )
        ;
      const byId = new Map<number, ShopRow>();
      for (const s of own) byId.set(s.id, { ...s, canEdit: true });
      for (const s of assigned) {
        if (!byId.has(s.id)) byId.set(s.id, { ...s, canEdit: false });
      }
      wsShops = Array.from(byId.values());
    }

    const visibleShopIds = new Set(wsShops.map((s) => s.id));
    const editableShopIds = new Set(
      wsShops.filter((s) => s.canEdit).map((s) => s.id),
    );

    const grantorAlias = aliasedTable(users, "grantor");
    const allAssignments = await db
      .select({
        userId: shopMember.userId,
        shopId: shopMember.shopId,
        grantedByUserId: shopMember.createdBy,
        grantedByEmail: grantorAlias.email,
      })
      .from(shopMember)
      .innerJoin(shops, eq(shops.id, shopMember.shopId))
      .leftJoin(grantorAlias, eq(grantorAlias.id, shopMember.createdBy))
      .where(eq(shops.workspaceId, user.workspaceId))
      ;
    const assignments = allAssignments.filter((a) => {
      if (!visibleShopIds.has(a.shopId)) return false;
      if (editableShopIds.has(a.shopId)) return true;
      // Non-editable shop: only the requester's own assignment row is exposed,
      // so the manager's self-row reflects externally-granted access without
      // revealing other members' assignments.
      return a.userId === user.id;
    });

    return c.json({
      members,
      shops: wsShops,
      assignments,
    });
  });

  // === Invites ===

  app.get("/me/invites", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    return c.json(await listPendingInvites(db, user.workspaceId));
  });

  app.post("/me/invites", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (!canManageWorkspace(user.workspaceRole))
      return c.json({ error: "Только владелец или менеджер" }, 403);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as { email?: unknown; role?: unknown };
    if (typeof r.email !== "string" || !EMAIL_RE.test(r.email))
      return c.json({ error: "Некорректный email" }, 400);
    if (
      typeof r.role !== "string" ||
      !(ALLOWED_ROLES as readonly string[]).includes(r.role)
    )
      return c.json({ error: "Роль должна быть owner, manager или member" }, 400);

    const role = r.role as WorkspaceRole;
    if (role === "owner" && user.workspaceRole !== "owner")
      return c.json({ error: "Только владелец может приглашать владельца" }, 403);

    const email = r.email.trim().toLowerCase();

    // Already a member of THIS workspace?
    const [existingMember] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(users.email, email),
        ),
      )
      ;
    if (existingMember)
      return c.json({ error: "Этот пользователь уже в вашей команде" }, 409);

    // Pending invite for the same email? Replace it.
    await db.delete(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, user.workspaceId),
          eq(workspaceInvites.email, email),
          isNull(workspaceInvites.usedAt),
        ),
      )
      ;

    const now = new Date();
    const token = newToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await db.insert(workspaceInvites)
      .values({
        token,
        workspaceId: user.workspaceId,
        email,
        role,
        invitedBy: user.id,
        expiresAt,
        usedAt: null,
        createdAt: now,
      })
      ;

    const [ws] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, user.workspaceId))
      ;

    try {
      (await getEmailClient()).send(
        generateInviteEmail({
          to: email,
          workspaceName: ws?.name ?? "Команда",
          inviterEmail: user.email,
          role,
          link: inviteLink(c, token),
        }),
      );
    } catch (e) {
      console.error("[workspace] failed to send invite email:", e);
    }

    return c.json(
      {
        token,
        email,
        role,
        invitedBy: { id: user.id, email: user.email },
        expiresAt: expiresAt.getTime(),
        createdAt: now.getTime(),
      },
      201,
    );
  });

  app.delete("/me/invites/:token", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (!canManageWorkspace(user.workspaceRole))
      return c.json({ error: "Только владелец или менеджер" }, 403);

    const token = c.req.param("token");
    const deleted = await db
      .delete(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.token, token),
          eq(workspaceInvites.workspaceId, user.workspaceId),
        ),
      )
      .returning({ token: workspaceInvites.token });
    if (deleted.length === 0)
      return c.json({ error: "Приглашение не найдено" }, 404);
    return c.json({ ok: true });
  });

  // === Members ===

  app.patch("/me/members/:userId", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (user.workspaceRole !== "owner")
      return c.json({ error: "Только владелец может менять роли" }, 403);

    const targetId = Number(c.req.param("userId"));
    if (!Number.isInteger(targetId) || targetId <= 0)
      return c.json({ error: "invalid id" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as { role?: unknown };
    if (
      typeof r.role !== "string" ||
      !(ALLOWED_ROLES as readonly string[]).includes(r.role)
    )
      return c.json({ error: "Роль должна быть owner, manager или member" }, 400);
    const nextRole = r.role as WorkspaceRole;

    const [target] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;
    if (!target) return c.json({ error: "Участник не найден" }, 404);

    if (
      target.role === "owner" &&
      nextRole !== "owner" &&
      (await ownerCount(db, user.workspaceId)) <= 1
    )
      return c.json(
        { error: "Нельзя понизить последнего владельца команды" },
        400,
      );

    await db.update(workspaceMembers)
      .set({ role: nextRole })
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;
    return c.json({ ok: true, userId: targetId, role: nextRole });
  });

  // Owner-edit member profile (name / title / avatar). Owner-only by intent:
  // editing someone else's identity is privileged. Self-edits go through
  // POST /api/auth/me/profile instead.
  app.patch("/me/members/:userId/profile", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (user.workspaceRole !== "owner")
      return c.json(
        { error: "Только владелец может редактировать профили участников" },
        403,
      );

    const targetId = Number(c.req.param("userId"));
    if (!Number.isInteger(targetId) || targetId <= 0)
      return c.json({ error: "invalid id" }, 400);

    // Confirm target is in this workspace.
    const [target] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;
    if (!target) return c.json({ error: "Участник не найден" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const parsed = parseProfilePatch(body);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    if (Object.keys(parsed).length > 0) {
      await db.update(users)
        .set({ ...parsed, updatedAt: new Date() })
        .where(eq(users.id, targetId))
        ;
    }

    const [updated] = await db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        jobTitle: users.jobTitle,
        avatarDataUrl: users.avatarDataUrl,
      })
      .from(users)
      .where(eq(users.id, targetId))
      ;
    return c.json(updated);
  });

  app.delete("/me/members/:userId", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (!canManageWorkspace(user.workspaceRole))
      return c.json({ error: "Только владелец или менеджер" }, 403);

    const targetId = Number(c.req.param("userId"));
    if (!Number.isInteger(targetId) || targetId <= 0)
      return c.json({ error: "invalid id" }, 400);

    const [target] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;
    if (!target) return c.json({ error: "Участник не найден" }, 404);

    if (targetId === user.id)
      return c.json(
        {
          error:
            "Нельзя удалить самого себя. Передайте права владельцу или удалите команду.",
        },
        400,
      );

    if (
      target.role === "owner" &&
      (await ownerCount(db, user.workspaceId)) <= 1
    )
      return c.json(
        { error: "Нельзя удалить последнего владельца команды" },
        400,
      );

    if (target.role === "owner" && user.workspaceRole !== "owner")
      return c.json({ error: "Только владелец может удалить владельца" }, 403);

    await db.delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;

    // Reset their active_shop_id pointer if it referenced a shop in this ws.
    await db.update(userSettings)
      .set({ activeShopId: null, updatedAt: new Date() })
      .where(eq(userSettings.userId, targetId))
      ;

    return c.json({ ok: true });
  });

  // Block / unblock a workspace member's account (owner only). Blocking
  // toggles `users.is_blocked` and kills every session of the target so they
  // can't reach any SPA. Reversible — unblock just clears the flag.
  app.put("/me/members/:userId/blocked", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (user.workspaceRole !== "owner")
      return c.json(
        { error: "Только владелец команды может блокировать аккаунты" },
        403,
      );

    const targetId = Number(c.req.param("userId"));
    if (!Number.isInteger(targetId) || targetId <= 0)
      return c.json({ error: "invalid id" }, 400);
    if (targetId === user.id)
      return c.json({ error: "Нельзя заблокировать самого себя" }, 400);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }
    const r = (body ?? {}) as { blocked?: unknown };
    if (typeof r.blocked !== "boolean")
      return c.json({ error: "blocked должен быть boolean" }, 400);

    // Target must be a member of the same workspace.
    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;
    if (!member) return c.json({ error: "Участник не найден" }, 404);

    // Don't lock out the last remaining owner — workspace would become
    // unmanageable until a sysadmin intervenes.
    if (
      r.blocked &&
      member.role === "owner" &&
      (await ownerCount(db, user.workspaceId)) <= 1
    )
      return c.json(
        { error: "Нельзя заблокировать последнего владельца команды" },
        400,
      );

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    if (!target) return c.json({ error: "Пользователь не найден" }, 404);
    // Sysadmin accounts shouldn't be in workspace_members in the first place
    // but stay defensive: don't let a workspace owner lock out a sysadmin.
    if (target.isSysadmin)
      return c.json(
        { error: "Sysadmin-аккаунт не блокируется из рабочей команды" },
        403,
      );

    await db.update(users)
      .set({ isBlocked: r.blocked, updatedAt: new Date() })
      .where(eq(users.id, targetId))
      ;
    if (r.blocked) {
      await db.delete(sessions).where(eq(sessions.userId, targetId));
    }
    return c.json({ ok: true, userId: targetId, blocked: r.blocked });
  });

  // Permanently delete the user account (owner only). Cascades remove their
  // workspace_members row, sessions, products, finance, imports — everything.
  // Reserve for actual departures; for temporary lock-out use `/blocked`.
  app.delete("/me/members/:userId/account", async (c) => {
    const user = c.get("user");
    if (!user.workspaceId) return c.json({ error: "У вас нет команды" }, 404);
    if (user.workspaceRole !== "owner")
      return c.json(
        { error: "Только владелец команды может удалять аккаунты" },
        403,
      );

    const targetId = Number(c.req.param("userId"));
    if (!Number.isInteger(targetId) || targetId <= 0)
      return c.json({ error: "invalid id" }, 400);
    if (targetId === user.id)
      return c.json({ error: "Нельзя удалить самого себя" }, 400);

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, user.workspaceId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      ;
    if (!member) return c.json({ error: "Участник не найден" }, 404);

    if (member.role === "owner" && (await ownerCount(db, user.workspaceId)) <= 1)
      return c.json(
        { error: "Нельзя удалить последнего владельца команды" },
        400,
      );

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    if (!target) return c.json({ error: "Пользователь не найден" }, 404);
    if (target.isSysadmin)
      return c.json(
        { error: "Sysadmin-аккаунт не удаляется из рабочей команды" },
        403,
      );

    // Transfer ownership of shops the target created → current owner.
    // Without this, FK ON DELETE SET NULL would leave shops orphaned (only
    // manageable by workspace owner via the canManageShop fallback). Explicit
    // re-assignment is cleaner: the owner sees them as "Создан вами" instead
    // of "Создатель удалён".
    await db.update(shops)
      .set({ createdBy: user.id, updatedAt: new Date() })
      .where(
        and(
          eq(shops.workspaceId, user.workspaceId),
          eq(shops.createdBy, targetId),
        ),
      )
      ;

    await db.delete(users).where(eq(users.id, targetId));
    return c.json({ ok: true });
  });

  return app;
}

/** Public-ish invite routes:
 *  - GET  /api/invites/:token       — public lookup (no auth)
 *  - POST /api/invites/:token/accept — requires session, joins workspace
 * Mount BEFORE the global requireAuth gate so the GET works for anonymous
 * users coming from an email link. accept() does its own auth check. */
export function inviteRoutes(db: DB): Hono<{ Variables: { user?: SessionUser } }> {
  const app = new Hono<{ Variables: { user?: SessionUser } }>();

  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    const [inv] = await db
      .select({
        token: workspaceInvites.token,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        expiresAt: workspaceInvites.expiresAt,
        usedAt: workspaceInvites.usedAt,
        workspaceId: workspaceInvites.workspaceId,
        workspaceName: workspaces.name,
        inviterEmail: users.email,
      })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .innerJoin(users, eq(users.id, workspaceInvites.invitedBy))
      .where(eq(workspaceInvites.token, token))
      ;
    if (!inv) return c.json({ error: "Приглашение не найдено" }, 404);
    if (inv.usedAt)
      return c.json({ error: "Приглашение уже использовано" }, 410);
    if (inv.expiresAt.getTime() < Date.now())
      return c.json({ error: "Приглашение просрочено" }, 410);
    return c.json({
      workspaceName: inv.workspaceName,
      email: inv.email,
      role: inv.role,
      inviterEmail: inv.inviterEmail,
      expiresAt: inv.expiresAt.getTime(),
    });
  });

  app.post("/:token/accept", requireAuth, async (c) => {
    const user = c.get("user")!;
    const token = c.req.param("token");

    const [inv] = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.token, token))
      ;
    if (!inv) return c.json({ error: "Приглашение не найдено" }, 404);
    if (inv.usedAt)
      return c.json({ error: "Приглашение уже использовано" }, 410);
    if (inv.expiresAt.getTime() < Date.now())
      return c.json({ error: "Приглашение просрочено" }, 410);

    // Already in a workspace?
    const [existing] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
      ;
    if (existing) {
      if (existing.workspaceId === inv.workspaceId) {
        // Idempotent: same workspace → just consume the invite.
        await db.update(workspaceInvites)
          .set({ usedAt: new Date() })
          .where(eq(workspaceInvites.token, token))
          ;
        return c.json({ ok: true, workspaceId: inv.workspaceId });
      }
      return c.json(
        {
          error:
            "Вы уже состоите в другой команде. Покиньте её, прежде чем принять это приглашение.",
        },
        409,
      );
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(workspaceMembers)
        .values({
          workspaceId: inv.workspaceId,
          userId: user.id,
          role: inv.role,
          status: "active",
          createdAt: now,
        })
        ;
      await tx.update(workspaceInvites)
        .set({ usedAt: now })
        .where(eq(workspaceInvites.token, token))
        ;

      // Set active shop to first one of the workspace, if any.
      const [firstShop] = await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.workspaceId, inv.workspaceId))
        ;
      const [settings] = await tx
        .select({ id: userSettings.id })
        .from(userSettings)
        .where(eq(userSettings.userId, user.id))
        ;
      if (settings) {
        await tx.update(userSettings)
          .set({ activeShopId: firstShop?.id ?? null, updatedAt: now })
          .where(eq(userSettings.userId, user.id))
          ;
      } else {
        await tx.insert(userSettings)
          .values({
            userId: user.id,
            activeShopId: firstShop?.id ?? null,
            updatedAt: now,
          })
          ;
      }
    });

    return c.json({ ok: true, workspaceId: inv.workspaceId, role: inv.role });
  });

  return app;
}
