import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  emailVerificationTokens,
  sessions,
  shops,
  users,
  workspaceMembers,
  workspaces,
} from "../../server/db/schema";
import {
  createUserDirect,
  loginAndGetCookie,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

describe("auth routes", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  describe("POST /api/auth/register", () => {
    it("creates an unverified user + workspace + owner membership + default shop", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "Foo@Bar.com",
          password: "password123",
          workspaceName: "Acme Trading",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toMatch(/подтверд/i);

      const user = env.db
        .select()
        .from(users)
        .where(eq(users.email, "foo@bar.com"))
        .get();
      expect(user).toBeTruthy();
      expect(user!.isVerified).toBe(false);
      expect(user!.isSysadmin).toBe(false);
      expect(user!.passwordHash).not.toBe("password123");

      // Workspace created with the supplied name.
      const ws = env.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.name, "Acme Trading"))
        .get();
      expect(ws).toBeTruthy();
      expect(ws!.slug).toBe(`foo-${user!.id}`);

      // Owner membership.
      const member = env.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, user!.id))
        .get();
      expect(member?.role).toBe("owner");
      expect(member?.workspaceId).toBe(ws!.id);

      // Default shop in the workspace.
      const wsShops = env.db
        .select()
        .from(shops)
        .where(eq(shops.workspaceId, ws!.id))
        .all();
      expect(wsShops).toHaveLength(1);
      expect(wsShops[0].name).toBe("Мой магазин");

      // Verification email + token.
      expect(env.emails).toHaveLength(1);
      expect(env.emails[0].to).toBe("foo@bar.com");
      const tokens = env.db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.userId, user!.id))
        .all();
      expect(tokens).toHaveLength(1);
    });

    it("rejects missing workspaceName with 400", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "password123" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/команд/i);
    });

    it("rejects empty workspaceName (whitespace only) with 400", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "a@b.co",
          password: "password123",
          workspaceName: "   ",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("unknown inviteToken → 404", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "a@b.co",
          password: "password123",
          inviteToken: "deadbeef",
        }),
      });
      expect(res.status).toBe(404);
    });

    it("rejects invalid email", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "notanemail",
          password: "password123",
          workspaceName: "X",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects short password", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "a@b.co",
          password: "short",
          workspaceName: "X",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects duplicate email with 409", async () => {
      const body = JSON.stringify({
        email: "dup@x.com",
        password: "password123",
        workspaceName: "Team",
      });
      const a = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(a.status).toBe(200);
      const b = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(b.status).toBe(409);

      // 409 must not leak a second workspace/membership.
      const wsRows = env.db.select().from(workspaces).all();
      expect(wsRows).toHaveLength(1);
      const members = env.db.select().from(workspaceMembers).all();
      expect(members).toHaveLength(1);
    });
  });

  describe("POST /api/auth/verify-email", () => {
    it("activates user, issues session cookie, returns user payload", async () => {
      await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "v@x.com",
          password: "password123",
          workspaceName: "VeeTeam",
        }),
      });
      const tokenRow = env.db.select().from(emailVerificationTokens).get();
      expect(tokenRow).toBeTruthy();

      const res = await env.app.request("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRow!.token }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe("v@x.com");
      expect(body.user.isVerified).toBe(true);
      expect(body.user.workspaceId).toBeGreaterThan(0);
      expect(body.user.workspaceRole).toBe("owner");
      expect(res.headers.get("set-cookie")).toMatch(/ozon_calc_session=/);

      const user = env.db
        .select()
        .from(users)
        .where(eq(users.email, "v@x.com"))
        .get();
      expect(user!.isVerified).toBe(true);

      const remaining = env.db.select().from(emailVerificationTokens).all();
      expect(remaining).toHaveLength(0);

      // No duplicate workspace from ensurePersonalWorkspace safety-net.
      const wsCount = env.db
        .select()
        .from(workspaces)
        .all().length;
      expect(wsCount).toBe(1);
    });

    it("rejects unknown / reused token with 400", async () => {
      const res = await env.app.request("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "deadbeef" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects expired token", async () => {
      const userId = createUserDirect(env.db, "exp@x.com", "password123");
      env.db
        .update(users)
        .set({ isVerified: false })
        .where(eq(users.id, userId))
        .run();
      env.db
        .insert(emailVerificationTokens)
        .values({
          token: "expired-tok",
          userId,
          expiresAt: new Date(Date.now() - 1000),
          createdAt: new Date(Date.now() - 10000),
        })
        .run();
      const res = await env.app.request("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "expired-tok" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    it("issues a session cookie for verified user", async () => {
      createUserDirect(env.db, "u@x.com", "password123");
      const cookie = await loginAndGetCookie(env.app, "u@x.com", "password123");
      expect(cookie).toMatch(/^ozon_calc_session=/);

      const sess = env.db.select().from(sessions).all();
      expect(sess).toHaveLength(1);
    });

    it("returns 401 on wrong password (no enumeration of email existence)", async () => {
      createUserDirect(env.db, "u@x.com", "password123");
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "u@x.com", password: "wrong-password" }),
      });
      expect(res.status).toBe(401);
      const noUser = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ghost@x.com", password: "password123" }),
      });
      expect(noUser.status).toBe(401);
      // Same error message for both cases.
      expect((await res.json()).error).toEqual((await noUser.json()).error);
    });

    it("returns 403 when email is not verified", async () => {
      const id = createUserDirect(env.db, "u@x.com", "password123");
      env.db.update(users).set({ isVerified: false }).where(eq(users.id, id)).run();
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "u@x.com", password: "password123" }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 403 when account is blocked", async () => {
      const id = createUserDirect(env.db, "blocked@x.com", "password123");
      env.db.update(users).set({ isBlocked: true }).where(eq(users.id, id)).run();
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "blocked@x.com", password: "password123" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/заблокирован/i);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns current user when cookie is valid", async () => {
      createUserDirect(env.db, "u@x.com", "password123", "admin");
      const cookie = await loginAndGetCookie(env.app, "u@x.com", "password123");
      const res = await env.app.request("/api/auth/me", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe("u@x.com");
      expect(body.user.role).toBe("admin");
      expect(body.user.isSysadmin).toBe(true);
      expect(body.user.workspaceId).toBeGreaterThan(0);
      expect(body.user.workspaceRole).toBe("owner");
    });

    it("returns 401 without cookie", async () => {
      const res = await env.app.request("/api/auth/me");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("deletes session and clears cookie", async () => {
      createUserDirect(env.db, "u@x.com", "password123");
      const cookie = await loginAndGetCookie(env.app, "u@x.com", "password123");
      expect(env.db.select().from(sessions).all()).toHaveLength(1);

      const res = await env.app.request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      expect(env.db.select().from(sessions).all()).toHaveLength(0);

      // Subsequent /me should now 401.
      const me = await env.app.request("/api/auth/me", {
        headers: { Cookie: cookie },
      });
      expect(me.status).toBe(401);
    });
  });
});
