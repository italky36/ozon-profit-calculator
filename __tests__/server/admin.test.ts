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
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

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
      createUserDirect(env.db, "u1@x.com", "password123", "user");
      createUserDirect(env.db, "u2@x.com", "password123", "user");

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
      const targetId = createUserDirect(env.db, "u@x.com", "password123", "user");

      const res = await env.app.request(`/api/admin/users/${targetId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe("admin");

      const row = env.db.select().from(users).where(eq(users.id, targetId)).get();
      expect(row!.role).toBe("admin");
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
      const targetId = createUserDirect(env.db, "u@x.com", "password123");
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
      const targetId = createUserDirect(env.db, "victim@x.com", "password123");
      env.db
        .insert(sessions)
        .values({
          id: "victim-active",
          userId: targetId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        })
        .run();

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

      const row = env.db.select().from(users).where(eq(users.id, targetId)).get();
      expect(row!.isBlocked).toBe(true);
      expect(
        env.db.select().from(sessions).where(eq(sessions.userId, targetId)).all(),
      ).toHaveLength(0);
    });

    it("unblocks user without restoring sessions", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = createUserDirect(env.db, "u@x.com", "password123");
      env.db
        .update(users)
        .set({ isBlocked: true })
        .where(eq(users.id, targetId))
        .run();

      const res = await env.app.request(
        `/api/admin/users/${targetId}/blocked`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ blocked: false }),
        },
      );
      expect(res.status).toBe(200);
      const row = env.db.select().from(users).where(eq(users.id, targetId)).get();
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
      const targetId = createUserDirect(env.db, "victim@x.com", "password123");
      // Give the victim a session.
      env.db
        .insert(sessions)
        .values({
          id: "victim-sess",
          userId: targetId,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        })
        .run();

      const res = await env.app.request(`/api/admin/users/${targetId}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);

      expect(
        env.db.select().from(users).where(eq(users.id, targetId)).get(),
      ).toBeUndefined();
      expect(
        env.db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, targetId))
          .all(),
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
      const targetId = createUserDirect(env.db, "u@x.com", "password123");
      env.db.update(users).set({ isVerified: false }).where(eq(users.id, targetId)).run();
      env.emails.length = 0;

      const res = await env.app.request(
        `/api/admin/users/${targetId}/resend-verification`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(200);

      const tokens = env.db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.userId, targetId))
        .all();
      expect(tokens).toHaveLength(1);
      expect(env.emails).toHaveLength(1);
      expect(env.emails[0].to).toBe("u@x.com");
    });

    it("rejects already-verified user with 400", async () => {
      const { cookie } = await loginAs(env, "admin@x.com", "password123", "admin");
      const targetId = createUserDirect(env.db, "u@x.com", "password123");
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
      const targetId = createUserDirect(env.db, "u@x.com", "password123");
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        env.db
          .insert(sessions)
          .values({
            id: `sess-${i}`,
            userId: targetId,
            expiresAt: new Date(now + 60_000),
            createdAt: new Date(now),
          })
          .run();
      }
      const res = await env.app.request(
        `/api/admin/users/${targetId}/revoke-sessions`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(200);
      expect(
        env.db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, targetId))
          .all(),
      ).toHaveLength(0);
    });
  });
});
