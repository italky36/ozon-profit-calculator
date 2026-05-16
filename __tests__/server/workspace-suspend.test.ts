import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  sessions,
  workspaceMembers,
  workspaces,
} from "../../server/db/schema";
import {
  createUserDirect,
  loginAndGetCookie,
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

describe("workspace suspension", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  describe("PUT /api/admin/workspaces/:id/suspended", () => {
    it("suspends workspace, marks timestamp, revokes member sessions", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");
      // Confirm the member's session exists before suspension.
      const before = env.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, member.userId))
        .all();
      expect(before.length).toBeGreaterThan(0);

      const res = await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.suspendedAt).toBeTypeOf("number");

      // Timestamp written in DB.
      const ws = env.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, member.workspaceId))
        .get();
      expect(ws!.suspendedAt).toBeInstanceOf(Date);

      // Member sessions deleted.
      const after = env.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, member.userId))
        .all();
      expect(after).toHaveLength(0);
    });

    it("does not revoke sysadmin sessions", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");
      const sysadminBefore = env.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, admin.userId))
        .all();
      expect(sysadminBefore.length).toBeGreaterThan(0);

      await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );

      const sysadminAfter = env.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, admin.userId))
        .all();
      expect(sysadminAfter).toHaveLength(sysadminBefore.length);
    });

    it("un-suspending clears the timestamp and allows fresh login", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");

      await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );

      // Login while suspended → 403.
      const blocked = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "u@x.com", password: "password123" }),
      });
      expect(blocked.status).toBe(403);
      const blockedBody = await blocked.json();
      expect(blockedBody.error).toMatch(/приостановлен/i);

      // Un-suspend.
      const off = await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: false }),
        },
      );
      expect(off.status).toBe(200);
      const offBody = await off.json();
      expect(offBody.suspendedAt).toBeNull();

      const ws = env.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, member.workspaceId))
        .get();
      expect(ws!.suspendedAt).toBeNull();

      // Fresh login allowed.
      const ok = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "u@x.com", password: "password123" }),
      });
      expect(ok.status).toBe(200);
    });

    it("rejects non-admin caller with 403", async () => {
      const member = await loginAs(env, "u@x.com", "password123", "user");
      const res = await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: {
            Cookie: member.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ suspended: true }),
        },
      );
      expect(res.status).toBe(403);
    });

    it("returns 404 for unknown workspace", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const res = await env.app.request(
        "/api/admin/workspaces/99999/suspended",
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );
      expect(res.status).toBe(404);
    });

    it("rejects non-boolean body with 400", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");
      const res = await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: "yes" }),
        },
      );
      expect(res.status).toBe(400);
    });
  });

  describe("login + scoped access while suspended", () => {
    it("login fails with localized 403 for suspended workspace member", async () => {
      const uid = createUserDirect(env.db, "u@x.com", "password123");
      const wsId = env.db
        .select({ id: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, uid))
        .get()!.id;
      env.db
        .update(workspaces)
        .set({ suspendedAt: new Date(), updatedAt: new Date() })
        .where(eq(workspaces.id, wsId))
        .run();

      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "u@x.com", password: "password123" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/приостановлен/i);
    });

    it("existing cookie becomes invalid once workspace is suspended", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");

      // Before suspension /auth/me succeeds.
      const before = await env.app.request("/api/auth/me", {
        headers: { Cookie: member.cookie },
      });
      expect(before.status).toBe(200);

      await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );

      const after = await env.app.request("/api/auth/me", {
        headers: { Cookie: member.cookie },
      });
      // session was revoked + workspace gate → no user
      expect(after.status).toBe(401);
    });

    it("sysadmin can still log in after suspending some other workspace", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");

      await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );

      const cookie = await loginAndGetCookie(
        env.app,
        "admin@x.com",
        "password123",
        "sysadmin",
      );
      expect(cookie).toMatch(/ozon_calc_sysadmin_session=/);
    });
  });

  describe("GET /api/admin/workspaces", () => {
    it("returns suspendedAt for each workspace", async () => {
      const admin = await loginAs(env, "admin@x.com", "password123", "admin");
      const member = await loginAs(env, "u@x.com", "password123", "user");

      // Suspend just one.
      await env.app.request(
        `/api/admin/workspaces/${member.workspaceId}/suspended`,
        {
          method: "PUT",
          headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ suspended: true }),
        },
      );

      const res = await env.app.request("/api/admin/workspaces", {
        headers: { Cookie: admin.cookie },
      });
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{
        id: number;
        suspendedAt: number | null;
      }>;
      const suspended = list.find((w) => w.id === member.workspaceId);
      const active = list.find((w) => w.id === admin.workspaceId);
      expect(suspended?.suspendedAt).toBeTypeOf("number");
      expect(active?.suspendedAt).toBeNull();
    });
  });
});
