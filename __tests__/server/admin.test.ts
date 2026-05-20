import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  emailVerificationTokens,
  sessions,
  users,
} from "../../server/db/schema";
import {
  createUserDirect,
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

describe("admin routes", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupTestEnv();
  });
  afterEach(async () => await teardownTestEnv(env));

  describe("authorization", () => {
    it("returns 401 without session", async () => {
      const res = await env.app.request("/api/admin/users");
      expect(res.status).toBe(401);
    });

    it("returns 403 for non-admin user", async () => {
      const { cookie } = await loginAs(env, "u@x.com", "password123", "user");
      const res = await env.app.request("/api/admin/users", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/admin/users", () => {
    it("lists all users without password_hash", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      await createUserDirect(env.db, "u1@x.com", "password123", "user");
      await createUserDirect(env.db, "u2@x.com", "password123", "user");

      const res = await env.app.request("/api/admin/users", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<Record<string, unknown>>;
      expect(list).toHaveLength(3);
      for (const u of list) {
        expect(u).not.toHaveProperty("passwordHash");
        expect(u).not.toHaveProperty("password_hash");
        expect(u).toHaveProperty("email");
        expect(u).toHaveProperty("role");
        expect(u).toHaveProperty("isVerified");
        expect(u).toHaveProperty("createdAt");
      }
    });
  });

  describe("PUT /api/admin/users/:id/role", () => {
    it("changes user role", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "u@x.com", "password123", "user");

      const res = await env.app.request(`/api/admin/users/${targetId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe("admin");

      const [row] = await env.db.select().from(users).where(eq(users.id, targetId));
      expect(row!.isSysadmin).toBe(true);
    });

    it("rejects demoting self with 400", async () => {
      const { cookie, userId } = await loginAs(
        env,
        "admin@x.com",
        "password123",
        "admin",
      );
      const res = await env.app.request(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ role: "user" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid role with 400", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "u@x.com", "password123");
      const res = await env.app.request(`/api/admin/users/${targetId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ role: "superuser" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown user", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const res = await env.app.request("/api/admin/users/99999/role", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ role: "user" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/admin/users/:id/blocked", () => {
    it("blocks user and revokes their sessions", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "victim@x.com", "password123");
      await env.db
        .insert(sessions)
        .values({
          id: "victim-active",
          userId: targetId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        })
        ;

      const res = await env.app.request(
        `/api/admin/users/${targetId}/blocked`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ blocked: true }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.isBlocked).toBe(true);

      const [row] = await env.db.select().from(users).where(eq(users.id, targetId));
      expect(row!.isBlocked).toBe(true);
      expect(
        await env.db.select().from(sessions).where(eq(sessions.userId, targetId)),
      ).toHaveLength(0);
    });

    it("unblocks user without restoring sessions", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "u@x.com", "password123");
      await env.db
        .update(users)
        .set({ isBlocked: true })
        .where(eq(users.id, targetId))
        ;

      const res = await env.app.request(
        `/api/admin/users/${targetId}/blocked`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ blocked: false }),
        },
      );
      expect(res.status).toBe(200);
      const [row] = await env.db.select().from(users).where(eq(users.id, targetId));
      expect(row!.isBlocked).toBe(false);
    });

    it("rejects blocking self with 400", async () => {
      const { cookie, userId } = await loginAs(
        env,
        "admin@x.com",
        "password123",
        "admin",
      );
      const res = await env.app.request(`/api/admin/users/${userId}/blocked`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ blocked: true }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/admin/users/:id", () => {
    it("deletes user and cascades sessions", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "victim@x.com", "password123");
      // Give the victim a session.
      await env.db
        .insert(sessions)
        .values({
          id: "victim-sess",
          userId: targetId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        })
        ;

      const res = await env.app.request(`/api/admin/users/${targetId}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);

      const [deletedUser] = await env.db
        .select()
        .from(users)
        .where(eq(users.id, targetId));
      expect(deletedUser).toBeUndefined();
      expect(
        await env.db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, targetId)),
      ).toHaveLength(0);
    });

    it("rejects deleting self with 400", async () => {
      const { cookie, userId } = await loginAs(
        env,
        "admin@x.com",
        "password123",
        "admin",
      );
      const res = await env.app.request(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/users/:id/resend-verification", () => {
    it("creates a new token and sends email", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "u@x.com", "password123");
      await env.db.update(users).set({ isVerified: false }).where(eq(users.id, targetId));
      env.emails.length = 0;

      const res = await env.app.request(
        `/api/admin/users/${targetId}/resend-verification`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(200);

      const tokens = await env.db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.userId, targetId))
        ;
      expect(tokens).toHaveLength(1);
      expect(env.emails).toHaveLength(1);
      expect(env.emails[0].to).toBe("u@x.com");
    });

    it("rejects already-verified user with 400", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "u@x.com", "password123");
      const res = await env.app.request(
        `/api/admin/users/${targetId}/resend-verification`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/users/:id/revoke-sessions", () => {
    it("removes all sessions for the target user", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = await createUserDirect(env.db, "u@x.com", "password123");
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        await env.db
          .insert(sessions)
          .values({
            id: `sess-${i}`,
            userId: targetId,
            expiresAt: new Date(now + 60_000),
            createdAt: new Date(now),
          })
          ;
      }
      const res = await env.app.request(
        `/api/admin/users/${targetId}/revoke-sessions`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(200);
      expect(
        await env.db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, targetId)),
      ).toHaveLength(0);
    });
  });

  describe("GET /api/admin/workspaces", () => {
    it("lists workspaces with member/shop counts and owner email", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      await loginAs(env, "u1@x.com", "password123", "user");
      await loginAs(env, "u2@x.com", "password123", "user");

      const res = await env.app.request("/api/admin/workspaces", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<Record<string, unknown>>;
      expect(list.length).toBeGreaterThanOrEqual(3);
      for (const w of list) {
        expect(w).toHaveProperty("id");
        expect(w).toHaveProperty("name");
        expect(w).toHaveProperty("slug");
        expect(w).toHaveProperty("memberCount");
        expect(w).toHaveProperty("shopCount");
        expect(w).toHaveProperty("ownerEmail");
        expect(w).toHaveProperty("createdAt");
      }
      const u1 = list.find((w) => w.ownerEmail === "u1@x.com");
      expect(u1).toBeDefined();
      expect(u1?.memberCount).toBe(1);
      expect(u1?.shopCount).toBe(1);
    });

    it("requires admin", async () => {
      const { cookie } = await loginAs(env, "u@x.com", "password123", "user");
      const res = await env.app.request("/api/admin/workspaces", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/admin/workspaces/:id", () => {
    it("removes workspace and cascades members/shops", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const target = await loginAs(env, "victim@x.com", "password123", "user");

      const res = await env.app.request(
        `/api/admin/workspaces/${target.workspaceId}`,
        { method: "DELETE", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(200);

      const remaining = await env.db
        .select()
        .from(users)
        .where(eq(users.email, "victim@x.com"))
        ;
      expect(remaining).toHaveLength(1); // user itself stays

      const list = await env.app.request("/api/admin/workspaces", {
        headers: { Cookie: cookie },
      });
      const rows = (await list.json()) as Array<{ id: number }>;
      expect(rows.find((r) => r.id === target.workspaceId)).toBeUndefined();
    });

    it("requires admin", async () => {
      const { cookie, workspaceId } = await loginAs(
        env,
        "u@x.com",
        "password123",
        "user",
      );
      const res = await env.app.request(`/api/admin/workspaces/${workspaceId}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
    });
  });
});
