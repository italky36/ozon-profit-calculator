import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { users, workspaceMembers } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

/** Tiny 1x1 transparent PNG as base64 — valid avatar payload. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

describe("user profile", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  const h = (cookie: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
  });

  describe("POST /api/auth/register", () => {
    it("stores fullName + jobTitle when provided", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "ivan@test.local",
          password: "password123",
          workspaceName: "T",
          fullName: "Иван Иванов",
          jobTitle: "Менеджер по продажам",
        }),
      });
      expect(res.status).toBe(200);
      const row = env.db
        .select()
        .from(users)
        .where(eq(users.email, "ivan@test.local"))
        .get();
      expect(row?.fullName).toBe("Иван Иванов");
      expect(row?.jobTitle).toBe("Менеджер по продажам");
    });

    it("derives fullName from email prefix when omitted (backfill parity)", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "skarlatuka@test.local",
          password: "password123",
          workspaceName: "T",
        }),
      });
      expect(res.status).toBe(200);
      const row = env.db
        .select()
        .from(users)
        .where(eq(users.email, "skarlatuka@test.local"))
        .get();
      expect(row?.fullName).toBe("Skarlatuka");
      expect(row?.jobTitle).toBeNull();
    });

    it("rejects empty fullName string", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "x@test.local",
          password: "password123",
          workspaceName: "T",
          fullName: "   ",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects jobTitle longer than 80 chars", async () => {
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "x@test.local",
          password: "password123",
          workspaceName: "T",
          jobTitle: "x".repeat(81),
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/auth/me/profile (self-edit)", () => {
    it("updates own profile and returns the new shape", async () => {
      const me = await loginAs(env, "u@test.local", "password123");
      const res = await env.app.request("/api/auth/me/profile", {
        method: "PATCH",
        headers: h(me.cookie),
        body: JSON.stringify({
          fullName: "Новое Имя",
          jobTitle: "Аналитик",
          avatarDataUrl: TINY_PNG,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: {
          fullName: string;
          jobTitle: string | null;
          avatarDataUrl: string | null;
        };
      };
      expect(body.user.fullName).toBe("Новое Имя");
      expect(body.user.jobTitle).toBe("Аналитик");
      expect(body.user.avatarDataUrl).toBe(TINY_PNG);
    });

    it("can clear jobTitle and avatar via null", async () => {
      const me = await loginAs(env, "u@test.local", "password123");
      await env.app.request("/api/auth/me/profile", {
        method: "PATCH",
        headers: h(me.cookie),
        body: JSON.stringify({ jobTitle: "tmp", avatarDataUrl: TINY_PNG }),
      });
      const res = await env.app.request("/api/auth/me/profile", {
        method: "PATCH",
        headers: h(me.cookie),
        body: JSON.stringify({ jobTitle: null, avatarDataUrl: null }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        user: { jobTitle: string | null; avatarDataUrl: string | null };
      };
      expect(body.user.jobTitle).toBeNull();
      expect(body.user.avatarDataUrl).toBeNull();
    });

    it("rejects oversized avatar", async () => {
      const me = await loginAs(env, "u@test.local", "password123");
      const huge = "data:image/png;base64," + "A".repeat(250_000);
      const res = await env.app.request("/api/auth/me/profile", {
        method: "PATCH",
        headers: h(me.cookie),
        body: JSON.stringify({ avatarDataUrl: huge }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-image data URLs", async () => {
      const me = await loginAs(env, "u@test.local", "password123");
      const res = await env.app.request("/api/auth/me/profile", {
        method: "PATCH",
        headers: h(me.cookie),
        body: JSON.stringify({
          avatarDataUrl: "data:application/pdf;base64,AAAA",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("requires auth", async () => {
      const res = await env.app.request("/api/auth/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: "x" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/workspace/me/members/:userId/profile (owner-edit)", () => {
    it("owner can edit another member's profile", async () => {
      const owner = await loginAs(env, "owner@test.local", "password123");
      // Seed a manager directly in the owner's workspace.
      const m = await loginAs(env, "manager@test.local", "password123");
      env.db
        .update(workspaceMembers)
        .set({ workspaceId: owner.workspaceId, role: "manager" })
        .where(eq(workspaceMembers.userId, m.userId))
        .run();

      const res = await env.app.request(
        `/api/workspace/me/members/${m.userId}/profile`,
        {
          method: "PATCH",
          headers: h(owner.cookie),
          body: JSON.stringify({
            fullName: "Изменённое имя",
            jobTitle: "Логист",
          }),
        },
      );
      expect(res.status).toBe(200);
      const row = env.db
        .select({ fullName: users.fullName, jobTitle: users.jobTitle })
        .from(users)
        .where(eq(users.id, m.userId))
        .get();
      expect(row?.fullName).toBe("Изменённое имя");
      expect(row?.jobTitle).toBe("Логист");
    });

    it("manager cannot edit another member's profile", async () => {
      const owner = await loginAs(env, "owner@test.local", "password123");
      const mgrSeed = await loginAs(env, "manager@test.local", "password123");
      const targetSeed = await loginAs(env, "target@test.local", "password123");
      // Join manager + target to owner workspace.
      env.db
        .update(workspaceMembers)
        .set({ workspaceId: owner.workspaceId, role: "manager" })
        .where(eq(workspaceMembers.userId, mgrSeed.userId))
        .run();
      env.db
        .update(workspaceMembers)
        .set({ workspaceId: owner.workspaceId, role: "member" })
        .where(eq(workspaceMembers.userId, targetSeed.userId))
        .run();
      // Re-login manager so session reflects new workspace + role.
      const mgr = await loginAs(env, "manager@test.local", "password123");

      const res = await env.app.request(
        `/api/workspace/me/members/${targetSeed.userId}/profile`,
        {
          method: "PATCH",
          headers: h(mgr.cookie),
          body: JSON.stringify({ fullName: "hacked" }),
        },
      );
      expect(res.status).toBe(403);
    });

    it("rejects edit of user in another workspace with 404", async () => {
      const a = await loginAs(env, "a-owner@test.local", "password123");
      const b = await loginAs(env, "b-owner@test.local", "password123");
      // a owns workspace A; tries to edit b who is in workspace B.
      const res = await env.app.request(
        `/api/workspace/me/members/${b.userId}/profile`,
        {
          method: "PATCH",
          headers: h(a.cookie),
          body: JSON.stringify({ fullName: "X" }),
        },
      );
      expect(res.status).toBe(404);
    });
  });
});
