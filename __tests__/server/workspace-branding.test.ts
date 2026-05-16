import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { workspaceMembers, workspaces } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

const PNG_DATA_URL =
  "data:image/png;base64," +
  // 1x1 transparent PNG
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("workspace branding (color + logo)", () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  beforeEach(async () => {
    env = setupTestEnv();
    owner = await loginAs(env, "owner@x.com", "password123");
  });
  afterEach(() => teardownTestEnv(env));

  const h = (cookie: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
  });

  describe("GET /api/workspace/me", () => {
    it("returns color and logoDataUrl (NULL by default)", async () => {
      const res = await env.app.request("/api/workspace/me", {
        headers: h(owner.cookie),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.color).toBeNull();
      expect(body.logoDataUrl).toBeNull();
    });
  });

  describe("PATCH /api/workspace/me — color", () => {
    it("accepts 6-digit HEX", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ color: "#7c3aed" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.color).toBe("#7c3aed");
      const row = env.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, owner.workspaceId))
        .get();
      expect(row!.color).toBe("#7c3aed");
    });

    it("accepts 3-digit HEX, lower-cases it", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ color: "#A1F" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.color).toBe("#a1f");
    });

    it("null clears the color", async () => {
      await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ color: "#000000" }),
      });
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ color: null }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.color).toBeNull();
    });

    it("rejects malformed color with 400", async () => {
      for (const bad of ["red", "#ZZZ", "#12345", 123, true, ""]) {
        const res = await env.app.request("/api/workspace/me", {
          method: "PATCH",
          headers: h(owner.cookie),
          body: JSON.stringify({ color: bad }),
        });
        expect(res.status).toBe(400);
      }
    });
  });

  describe("PATCH /api/workspace/me — logoDataUrl", () => {
    it("accepts a valid PNG data URL", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ logoDataUrl: PNG_DATA_URL }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logoDataUrl).toBe(PNG_DATA_URL);
    });

    it("null clears the logo", async () => {
      await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ logoDataUrl: PNG_DATA_URL }),
      });
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ logoDataUrl: null }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logoDataUrl).toBeNull();
    });

    it("rejects non-image data URL with 400", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({
          logoDataUrl: "data:text/plain;base64,SGVsbG8=",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects plain URL string with 400", async () => {
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({
          logoDataUrl: "https://example.com/logo.png",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects oversized data URL with 400", async () => {
      const oversize =
        "data:image/png;base64," + "A".repeat(200_001);
      const res = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(owner.cookie),
        body: JSON.stringify({ logoDataUrl: oversize }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/большой|больш/i);
    });
  });

  describe("authorization", () => {
    it("rejects non-owner with 403 (manager + member)", async () => {
      // Promote a second user into the same workspace as manager.
      const member = await loginAs(env, "m@x.com", "password123");
      env.db
        .update(workspaceMembers)
        .set({
          workspaceId: owner.workspaceId,
        })
        .where(eq(workspaceMembers.userId, member.userId))
        .run();
      // First as member.
      env.db
        .update(workspaceMembers)
        .set({ role: "member" })
        .where(eq(workspaceMembers.userId, member.userId))
        .run();
      // Re-login so SessionUser picks up the new workspace.
      const fresh = await loginAs(env, "m@x.com", "password123");

      const res1 = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(fresh.cookie),
        body: JSON.stringify({ color: "#123456" }),
      });
      expect(res1.status).toBe(403);

      // Now as manager.
      env.db
        .update(workspaceMembers)
        .set({ role: "manager" })
        .where(eq(workspaceMembers.userId, member.userId))
        .run();
      const fresh2 = await loginAs(env, "m@x.com", "password123");
      const res2 = await env.app.request("/api/workspace/me", {
        method: "PATCH",
        headers: h(fresh2.cookie),
        body: JSON.stringify({ color: "#123456" }),
      });
      expect(res2.status).toBe(403);
    });
  });
});
