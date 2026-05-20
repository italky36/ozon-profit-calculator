import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  users,
  workspaceInvites,
  workspaceMembers,
} from "../../server/db/schema";
import {
  loginAndGetCookie,
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

describe("workspace + invite routes", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  beforeEach(async () => {
    env = await setupTestEnv();
    owner = await loginAs(env, "owner@test.local", "password");
  });
  afterEach(async () => await teardownTestEnv(env));

  const h = (cookie: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
  });

  describe("GET /api/workspace/me", () => {
    it("returns workspace info + members for owner", async () => {
      const res = await env.app.request("/api/workspace/me", {
        headers: h(owner.cookie),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: number;
        role: string;
        members: Array<{ userId: number; role: string; isYou: boolean }>;
      };
      expect(body.id).toBe(owner.workspaceId);
      expect(body.role).toBe("owner");
      expect(body.members).toHaveLength(1);
      expect(body.members[0].userId).toBe(owner.userId);
      expect(body.members[0].isYou).toBe(true);
    });
  });

  describe("PATCH /api/workspace/me", () => {
    it("owner can rename workspace", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ name: "New Name" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string };
      expect(body.name).toBe("New Name");
    });

    it("rejects empty name", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ name: "  " }),
      });
      expect(res.status).toBe(400);
    });

    it("validates slug format", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ slug: "Has Spaces!" }),
      });
      expect(res.status).toBe(400);
    });

    it("409 on slug conflict", async () => {
      const other = await loginAs(env, "other@test.local", "password");
      // other's workspace has slug `other-<id>` — try to grab it.
      const otherSlug = `other-${other.userId}`;
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ slug: otherSlug }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/workspace/me/invites", () => {
    it("owner creates invite, email is sent", async () => {
      const res = await env.app.request("/api/workspace/me/invites", {
        method: "POST",
        headers: h(owner.cookie),
        body: JSON.stringify({ email: "newbie@test.local", role: "member" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { token: string; role: string };
      expect(body.token).toBeTruthy();
      expect(body.role).toBe("member");
      expect(env.emails).toHaveLength(1);
      expect(env.emails[0].to).toBe("newbie@test.local");
      expect(env.emails[0].text).toContain(body.token);
    });

    it("rejects invalid email", async () => {
      const res = await env.app.request("/api/workspace/me/invites", {
        method: "POST",
        headers: h(owner.cookie),
        body: JSON.stringify({ email: "not-an-email", role: "member" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid role", async () => {
      const res = await env.app.request("/api/workspace/me/invites", {
        method: "POST",
        headers: h(owner.cookie),
        body: JSON.stringify({ email: "a@b.c", role: "admin" }),
      });
      expect(res.status).toBe(400);
    });

    it("409 if email already in workspace", async () => {
      const res = await env.app.request("/api/workspace/me/invites", {
        method: "POST",
        headers: h(owner.cookie),
        body: JSON.stringify({ email: owner.cookie ? "owner@test.local" : "", role: "member" }),
      });
      expect(res.status).toBe(409);
    });

    it("replaces a pre-existing pending invite for same email", async () => {
      await env.app.request("/api/workspace/me/invites", {
        method: "POST",
        headers: h(owner.cookie),
        body: JSON.stringify({ email: "dup@test.local", role: "member" }),
      });
      await env.app.request("/api/workspace/me/invites", {
        method: "POST",
        headers: h(owner.cookie),
        body: JSON.stringify({ email: "dup@test.local", role: "manager" }),
      });
      const list = await env.db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.email, "dup@test.local"))
        ;
      expect(list).toHaveLength(1);
      expect(list[0].role).toBe("manager");
    });
  });

  describe("GET /api/invites/:token (public)", () => {
    it("returns invite info without auth", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "x@test.local", role: "manager" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);

      const res = await env.app.request(`/api/invites/${created.token}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        workspaceName: string;
        role: string;
        email: string;
      };
      expect(body.workspaceName).toMatch(/owner/i);
      expect(body.role).toBe("manager");
      expect(body.email).toBe("x@test.local");
    });

    it("404 on unknown token", async () => {
      const res = await env.app.request("/api/invites/does-not-exist");
      expect(res.status).toBe(404);
    });

    it("410 on used token", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "x@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);
      await env.db
        .update(workspaceInvites)
        .set({ usedAt: new Date() })
        .where(eq(workspaceInvites.token, created.token))
        ;
      const res = await env.app.request(`/api/invites/${created.token}`);
      expect(res.status).toBe(410);
    });
  });

  describe("POST /api/auth/register with inviteToken", () => {
    it("joins the workspace as the invite's role and consumes the invite", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "newhire@test.local", role: "manager" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);
      env.emails.length = 0;

      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "newhire@test.local",
          password: "password123",
          inviteToken: created.token,
        }),
      });
      expect(res.status).toBe(200);

      const [u] = await env.db
        .select()
        .from(users)
        .where(eq(users.email, "newhire@test.local"))
        ;
      expect(u).toBeTruthy();
      const [m] = await env.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, u!.id))
        ;
      expect(m?.workspaceId).toBe(owner.workspaceId);
      expect(m?.role).toBe("manager");

      const [inv] = await env.db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.token, created.token))
        ;
      expect(inv?.usedAt).not.toBeNull();
    });

    it("returns 410 when invite expired", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "exp@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);
      await env.db
        .update(workspaceInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceInvites.token, created.token))
        ;

      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "exp@test.local",
          password: "password123",
          inviteToken: created.token,
        }),
      });
      expect(res.status).toBe(410);
    });

    it("workspaceName not required when inviteToken given", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "noname@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);
      const res = await env.app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "noname@test.local",
          password: "password123",
          inviteToken: created.token,
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/invites/:token/accept", () => {
    it("existing user accepts and joins workspace", async () => {
      // Manually create a user with no workspace.
      const [orphan] = await env.db
        .insert(users)
        .values({
          email: "orphan@test.local",
          passwordHash: "$2a$04$placeholderHashThatWontMatch.................",
          isSysadmin: false,
          isVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: users.id })
        ;
      // Set a real password we can log in with.
      const bcrypt = await import("bcryptjs");
      await env.db
        .update(users)
        .set({ passwordHash: bcrypt.default.hashSync("password", 4) })
        .where(eq(users.id, orphan.id))
        ;

      const cookie = await loginAndGetCookie(
        env.app,
        "orphan@test.local",
        "password",
      );

      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "orphan@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);

      const res = await env.app.request(
        `/api/invites/${created.token}/accept`,
        { method: "POST", headers: { Cookie: cookie } },
      );
      expect(res.status).toBe(200);
      const [m] = await env.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, orphan.id))
        ;
      expect(m?.workspaceId).toBe(owner.workspaceId);
      expect(m?.role).toBe("member");
    });

    it("409 when accepter already in another workspace", async () => {
      const stranger = await loginAs(env, "stranger@test.local", "password");
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({
            email: "stranger@test.local",
            role: "member",
          }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);

      const res = await env.app.request(
        `/api/invites/${created.token}/accept`,
        { method: "POST", headers: { Cookie: stranger.cookie } },
      );
      expect(res.status).toBe(409);
    });

    it("401 without auth", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "anon@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);
      const res = await env.app.request(
        `/api/invites/${created.token}/accept`,
        { method: "POST" },
      );
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/workspace/me/invites/:token", () => {
    it("revokes pending invite", async () => {
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "kill@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);

      const del = await env.app.request(
        `/api/workspace/me/invites/${created.token}`,
        { method: "DELETE", headers: h(owner.cookie) },
      );
      expect(del.status).toBe(200);

      const [remaining] = await env.db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.token, created.token))
        ;
      expect(remaining).toBeUndefined();
    });
  });

  describe("members management", () => {
    it("owner cannot demote themselves if last owner", async () => {
      const res = await env.app.request(
        `/api/workspace/me/members/${owner.userId}`,
        {
          method: "PATCH",
          headers: h(owner.cookie),
          body: JSON.stringify({ role: "member" }),
        },
      );
      expect(res.status).toBe(400);
    });

    it("owner cannot remove themselves", async () => {
      const res = await env.app.request(
        `/api/workspace/me/members/${owner.userId}`,
        { method: "DELETE", headers: h(owner.cookie) },
      );
      expect(res.status).toBe(400);
    });

    it("member cannot manage invites or members", async () => {
      // Create a second user, invite + accept as member.
      const [stranger] = await env.db
        .insert(users)
        .values({
          email: "member@test.local",
          passwordHash: (await import("bcryptjs")).default.hashSync(
            "password",
            4,
          ),
          isSysadmin: false,
          isVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: users.id })
        ;
      const sCookie = await loginAndGetCookie(
        env.app,
        "member@test.local",
        "password",
      );
      const created = await env.app
        .request("/api/workspace/me/invites", {
          method: "POST",
          headers: h(owner.cookie),
          body: JSON.stringify({ email: "member@test.local", role: "member" }),
        })
        .then((r) => r.json() as Promise<{ token: string }>);
      await env.app.request(`/api/invites/${created.token}/accept`, {
        method: "POST",
        headers: { Cookie: sCookie },
      });

      const inviteAttempt = await env.app.request(
        "/api/workspace/me/invites",
        {
          method: "POST",
          headers: h(sCookie),
          body: JSON.stringify({ email: "z@test.local", role: "member" }),
        },
      );
      expect(inviteAttempt.status).toBe(403);

      const removeAttempt = await env.app.request(
        `/api/workspace/me/members/${owner.userId}`,
        { method: "DELETE", headers: h(sCookie) },
      );
      expect(removeAttempt.status).toBe(403);

      // But GET /me works.
      const meRes = await env.app.request("/api/workspace/me", {
        headers: h(sCookie),
      });
      expect(meRes.status).toBe(200);
      const me = (await meRes.json()) as { role: string; members: unknown[] };
      expect(me.role).toBe("member");
      expect(me.members).toHaveLength(2);

      // Sanity: stranger.id used.
      expect(stranger.id).toBeGreaterThan(0);
    });
  });
});
