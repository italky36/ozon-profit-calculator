import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  passwordResetTokens,
  sessions,
  users,
} from "../../server/db/schema";
import {
  createUserDirect,
  loginAndGetCookie,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

describe("password reset routes", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupTestEnv();
  });
  afterEach(async () => await teardownTestEnv(env));

  describe("POST /api/auth/forgot-password", () => {
    it("issues token + sends reset email for a verified user", async () => {
      await createUserDirect(env.db, "alice@example.com", "password123");

      const res = await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toMatch(/email/i);

      const tokens = await env.db.select().from(passwordResetTokens);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].usedAt).toBeNull();

      expect(env.emails).toHaveLength(1);
      expect(env.emails[0].to).toBe("alice@example.com");
      expect(env.emails[0].subject).toMatch(/восстановлен/i);
      expect(env.emails[0].text).toContain(tokens[0].token);
    });

    it("returns the same generic 200 for unknown email (no leak) and sends no email", async () => {
      const res = await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ghost@example.com" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toMatch(/email/i);

      expect(await env.db.select().from(passwordResetTokens)).toHaveLength(0);
      expect(env.emails).toHaveLength(0);
    });

    it("does not send to a blocked user", async () => {
      const uid = await createUserDirect(env.db, "blocked@example.com", "password123");
      await env.db
        .update(users)
        .set({ isBlocked: true, updatedAt: new Date() })
        .where(eq(users.id, uid))
        ;

      const res = await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "blocked@example.com" }),
      });
      expect(res.status).toBe(200);
      expect(env.emails).toHaveLength(0);
      expect(await env.db.select().from(passwordResetTokens)).toHaveLength(0);
    });

    it("does not send to an unverified user", async () => {
      const now = new Date();
      const hash = bcrypt.hashSync("password123", 4);
      await env.db
        .insert(users)
        .values({
          email: "pending@example.com",
          passwordHash: hash,
          isSysadmin: false,
          isVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        ;

      const res = await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "pending@example.com" }),
      });
      expect(res.status).toBe(200);
      expect(env.emails).toHaveLength(0);
      expect(await env.db.select().from(passwordResetTokens)).toHaveLength(0);
    });

    it("rejects bad email format with 400", async () => {
      const res = await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      expect(res.status).toBe(400);
    });

    it("invalidates earlier unused token when a new one is requested", async () => {
      await createUserDirect(env.db, "alice@example.com", "password123");

      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });

      const rows = await env.db.select().from(passwordResetTokens);
      expect(rows).toHaveLength(2);
      const used = rows.filter((r) => r.usedAt != null);
      const fresh = rows.filter((r) => r.usedAt == null);
      expect(used).toHaveLength(1);
      expect(fresh).toHaveLength(1);
    });
  });

  describe("GET /api/auth/reset-password/:token", () => {
    it("returns 200 for an active token", async () => {
      await createUserDirect(env.db, "alice@example.com", "password123");
      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      const token = (await env.db.select().from(passwordResetTokens))[0]!.token;

      const res = await env.app.request(`/api/auth/reset-password/${token}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("returns 400 with «истёк» for an expired token", async () => {
      const uid = await createUserDirect(env.db, "alice@example.com", "password123");
      await env.db
        .insert(passwordResetTokens)
        .values({
          token: "expiredtoken",
          userId: uid,
          expiresAt: new Date(Date.now() - 1000),
          createdAt: new Date(Date.now() - 60_000),
        })
        ;

      const res = await env.app.request(
        "/api/auth/reset-password/expiredtoken",
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/истёк|истек/i);
    });

    it("returns 400 with «использована» for a consumed token", async () => {
      const uid = await createUserDirect(env.db, "alice@example.com", "password123");
      await env.db
        .insert(passwordResetTokens)
        .values({
          token: "usedtoken",
          userId: uid,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: new Date(),
          createdAt: new Date(),
        })
        ;

      const res = await env.app.request("/api/auth/reset-password/usedtoken");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/использован/i);
    });

    it("returns 400 for an unknown token", async () => {
      const res = await env.app.request("/api/auth/reset-password/nope");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/reset-password", () => {
    it("sets new password, marks token used, revokes all sessions, allows login with new password", async () => {
      await createUserDirect(env.db, "alice@example.com", "oldpassword");
      // Existing session for the user.
      const cookie = await loginAndGetCookie(
        env.app,
        "alice@example.com",
        "oldpassword",
      );
      expect(cookie).toMatch(/ozon_calc_session=/);

      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      const token = (await env.db.select().from(passwordResetTokens))[0]!.token;

      const res = await env.app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "newpassword456" }),
      });
      expect(res.status).toBe(200);

      // Token marked used.
      const [tok] = await env.db.select().from(passwordResetTokens);
      expect(tok.usedAt).not.toBeNull();

      // All sessions for this user gone.
      const [user] = await env.db
        .select()
        .from(users)
        .where(eq(users.email, "alice@example.com"))
        ;
      const remaining = await env.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.id))
        ;
      expect(remaining).toHaveLength(0);

      // Old password no longer works.
      const fail = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "oldpassword",
        }),
      });
      expect(fail.status).toBe(401);

      // New password works.
      const ok = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "newpassword456",
        }),
      });
      expect(ok.status).toBe(200);
    });

    it("rejects reuse of a consumed token", async () => {
      await createUserDirect(env.db, "alice@example.com", "password123");
      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      const token = (await env.db.select().from(passwordResetTokens))[0]!.token;

      const first = await env.app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "newpassword456" }),
      });
      expect(first.status).toBe(200);

      const second = await env.app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "anotherpassword789" }),
      });
      expect(second.status).toBe(400);
    });

    it("rejects expired token", async () => {
      const uid = await createUserDirect(env.db, "alice@example.com", "password123");
      await env.db
        .insert(passwordResetTokens)
        .values({
          token: "expiredtoken",
          userId: uid,
          expiresAt: new Date(Date.now() - 1000),
          createdAt: new Date(Date.now() - 60_000),
        })
        ;

      const res = await env.app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "expiredtoken",
          password: "newpassword456",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects short password", async () => {
      await createUserDirect(env.db, "alice@example.com", "password123");
      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      const token = (await env.db.select().from(passwordResetTokens))[0]!.token;

      const res = await env.app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "short" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 403 if the user is blocked between issuance and reset", async () => {
      const uid = await createUserDirect(env.db, "alice@example.com", "password123");
      await env.app.request("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "alice@example.com" }),
      });
      const token = (await env.db.select().from(passwordResetTokens))[0]!.token;
      await env.db
        .update(users)
        .set({ isBlocked: true, updatedAt: new Date() })
        .where(eq(users.id, uid))
        ;

      const res = await env.app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: "newpassword456" }),
      });
      expect(res.status).toBe(403);
    });
  });
});
