import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { shopMember, shops, workspaceMembers } from "../../server/db/schema";
import {
  createShopFor,
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

/** Add a workspace member (manager/member) joining the owner's workspace,
 * re-login to pick up the new role, and return the credentials. */
async function joinAs(
  env: TestEnv,
  email: string,
  ownerWorkspaceId: number,
  role: "manager" | "member",
): Promise<Awaited<ReturnType<typeof loginAs>>> {
  const seeded = await loginAs(env, email, "password123");
  env.db
    .update(workspaceMembers)
    .set({
      workspaceId: ownerWorkspaceId,
      role,
    })
    .where(eq(workspaceMembers.userId, seeded.userId))
    .run();
  return await loginAs(env, email, "password123");
}

describe("per-shop permissions (creator-based)", () => {
  let env: TestEnv;
  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  describe("creation sets created_by", () => {
    it("POST /api/shops sets created_by to the caller", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const res = await env.app.request("/api/shops", {
        method: "POST",
        headers: {
          Cookie: owner.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Shop A", shortName: "A1" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.createdById).toBe(owner.userId);
      expect(body.isOwner).toBe(true);
    });

    it("manager creating a shop sets themselves as creator + auto-assigns shop_member", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");

      const res = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mgr Shop", shortName: "MS" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.createdById).toBe(mgr.userId);
      expect(body.isOwner).toBe(true);

      // shop_member row auto-created so manager keeps visibility.
      const sm = env.db
        .select()
        .from(shopMember)
        .where(eq(shopMember.shopId, body.id))
        .all();
      expect(sm.some((r) => r.userId === mgr.userId)).toBe(true);
    });

    it("member cannot create shops (403)", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mem = await joinAs(env, "mb@x.com", owner.workspaceId, "member");

      const res = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mem.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nope", shortName: "NP" }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /shops/:id", () => {
    it("creator-manager can PATCH their own shop", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mgr Shop", shortName: "MS" }),
      });
      const shopId = (await create.json()).id as number;

      const res = await env.app.request(`/api/shops/${shopId}`, {
        method: "PATCH",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Renamed");
    });

    it("non-creator manager gets 403 on someone else's shop", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgrA = await joinAs(env, "a@x.com", owner.workspaceId, "manager");
      const mgrB = await joinAs(env, "b@x.com", owner.workspaceId, "manager");

      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A's Shop", shortName: "AS" }),
      });
      const shopId = (await create.json()).id as number;

      const res = await env.app.request(`/api/shops/${shopId}`, {
        method: "PATCH",
        headers: { Cookie: mgrB.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hijack" }),
      });
      expect(res.status).toBe(403);
    });

    it("workspace owner can PATCH any shop", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mgr Shop", shortName: "MS" }),
      });
      const shopId = (await create.json()).id as number;

      const res = await env.app.request(`/api/shops/${shopId}`, {
        method: "PATCH",
        headers: { Cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Owner Override" }),
      });
      expect(res.status).toBe(200);
    });

    it("demoted creator (manager → member) loses PATCH rights", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mgr Shop", shortName: "MS" }),
      });
      const shopId = (await create.json()).id as number;

      // Demote.
      env.db
        .update(workspaceMembers)
        .set({ role: "member" })
        .where(eq(workspaceMembers.userId, mgr.userId))
        .run();
      const demoted = await loginAs(env, "m@x.com", "password123");

      const res = await env.app.request(`/api/shops/${shopId}`, {
        method: "PATCH",
        headers: {
          Cookie: demoted.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Should fail" }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /shops/:id", () => {
    it("non-creator manager 403; workspace owner 200", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgrA = await joinAs(env, "a@x.com", owner.workspaceId, "manager");
      const mgrB = await joinAs(env, "b@x.com", owner.workspaceId, "manager");
      // Need another existing shop in the workspace so deletion isn't blocked
      // by «can't remove the last shop» (server enforces total >= 1).
      createShopFor(env.db, owner.userId, { shortName: "K1" });
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A's Shop", shortName: "AA" }),
      });
      const shopId = (await create.json()).id as number;

      const blocked = await env.app.request(`/api/shops/${shopId}`, {
        method: "DELETE",
        headers: { Cookie: mgrB.cookie },
      });
      expect(blocked.status).toBe(403);

      const ok = await env.app.request(`/api/shops/${shopId}`, {
        method: "DELETE",
        headers: { Cookie: owner.cookie },
      });
      expect(ok.status).toBeLessThan(300);
    });
  });

  describe("members assignment (GET/POST/DELETE)", () => {
    it("non-creator manager cannot list/add/remove members of someone else's shop", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgrA = await joinAs(env, "a@x.com", owner.workspaceId, "manager");
      const mgrB = await joinAs(env, "b@x.com", owner.workspaceId, "manager");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A's Shop", shortName: "AA" }),
      });
      const shopId = (await create.json()).id as number;

      const listed = await env.app.request(
        `/api/shops/${shopId}/members`,
        { headers: { Cookie: mgrB.cookie } },
      );
      expect(listed.status).toBe(403);

      const added = await env.app.request(`/api/shops/${shopId}/members`, {
        method: "POST",
        headers: { Cookie: mgrB.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: mgrB.userId }),
      });
      expect(added.status).toBe(403);

      const removed = await env.app.request(
        `/api/shops/${shopId}/members/${mgrB.userId}`,
        { method: "DELETE", headers: { Cookie: mgrB.cookie } },
      );
      expect(removed.status).toBe(403);
    });

    it("creator-manager CAN manage members on their own shop", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");
      const helper = await joinAs(env, "h@x.com", owner.workspaceId, "member");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mgr Shop", shortName: "MS" }),
      });
      const shopId = (await create.json()).id as number;

      const add = await env.app.request(`/api/shops/${shopId}/members`, {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: helper.userId }),
      });
      expect(add.status).toBe(200);
    });
  });

  describe("PUT /shops/:id/transfer", () => {
    it("owner transfers shop to another manager; old creator loses access", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgrA = await joinAs(env, "a@x.com", owner.workspaceId, "manager");
      const mgrB = await joinAs(env, "b@x.com", owner.workspaceId, "manager");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shop", shortName: "TX" }),
      });
      const shopId = (await create.json()).id as number;

      const transfer = await env.app.request(
        `/api/shops/${shopId}/transfer`,
        {
          method: "PUT",
          headers: {
            Cookie: owner.cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId: mgrB.userId }),
        },
      );
      expect(transfer.status).toBe(200);
      const body = await transfer.json();
      expect(body.createdById).toBe(mgrB.userId);

      // mgrA can no longer PATCH.
      const mgrAFail = await env.app.request(`/api/shops/${shopId}`, {
        method: "PATCH",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Lost" }),
      });
      expect(mgrAFail.status).toBe(403);

      // mgrB now can.
      const mgrBOk = await env.app.request(`/api/shops/${shopId}`, {
        method: "PATCH",
        headers: { Cookie: mgrB.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mine now" }),
      });
      expect(mgrBOk.status).toBe(200);

      // New creator gets a shop_member row so the shop appears in their list.
      const sm = env.db
        .select()
        .from(shopMember)
        .where(eq(shopMember.shopId, shopId))
        .all();
      expect(sm.some((r) => r.userId === mgrB.userId)).toBe(true);
    });

    it("owner cannot transfer to a member (400)", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");
      const mem = await joinAs(env, "mb@x.com", owner.workspaceId, "member");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shop", shortName: "TX" }),
      });
      const shopId = (await create.json()).id as number;

      const res = await env.app.request(`/api/shops/${shopId}/transfer`, {
        method: "PUT",
        headers: { Cookie: owner.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: mem.userId }),
      });
      expect(res.status).toBe(400);
    });

    it("manager cannot call transfer (403)", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgrA = await joinAs(env, "a@x.com", owner.workspaceId, "manager");
      const mgrB = await joinAs(env, "b@x.com", owner.workspaceId, "manager");
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Shop", shortName: "TX" }),
      });
      const shopId = (await create.json()).id as number;

      const res = await env.app.request(`/api/shops/${shopId}/transfer`, {
        method: "PUT",
        headers: { Cookie: mgrA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: mgrB.userId }),
      });
      expect(res.status).toBe(403);
    });

    it("cross-workspace transfer is rejected (target not in workspace)", async () => {
      const ownerA = await loginAs(env, "a@x.com", "password123");
      const ownerB = await loginAs(env, "b@x.com", "password123");
      // ownerA tries to transfer their default shop to ownerB.
      const shopIdA = ownerA.shopId;

      const res = await env.app.request(`/api/shops/${shopIdA}/transfer`, {
        method: "PUT",
        headers: { Cookie: ownerA.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: ownerB.userId }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("shop-access matrix filtering", () => {
    it("owner sees every shop; manager sees only theirs", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const mgr = await joinAs(env, "m@x.com", owner.workspaceId, "manager");
      // Owner has a default shop from loginAs. Manager creates one.
      const create = await env.app.request("/api/shops", {
        method: "POST",
        headers: { Cookie: mgr.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mgr's", shortName: "MG" }),
      });
      const mgrShopId = (await create.json()).id as number;

      const ownerView = await env.app.request(
        "/api/workspace/me/shop-access",
        { headers: { Cookie: owner.cookie } },
      );
      const ownerBody = await ownerView.json();
      expect(ownerBody.shops.length).toBeGreaterThanOrEqual(2);
      expect(
        ownerBody.shops.find((s: { id: number }) => s.id === mgrShopId),
      ).toBeTruthy();

      const mgrView = await env.app.request(
        "/api/workspace/me/shop-access",
        { headers: { Cookie: mgr.cookie } },
      );
      const mgrBody = await mgrView.json();
      expect(mgrBody.shops).toHaveLength(1);
      expect(mgrBody.shops[0].id).toBe(mgrShopId);
    });
  });

  describe("backfill (existing data via _helpers.createShopFor)", () => {
    it("legacy shops created via createShopFor default to the user as creator", async () => {
      const owner = await loginAs(env, "owner@x.com", "password123");
      const extraShopId = createShopFor(env.db, owner.userId, {
        shortName: "L1",
      });
      const row = env.db
        .select()
        .from(shops)
        .where(eq(shops.id, extraShopId))
        .get();
      expect(row!.createdBy).toBe(owner.userId);
    });
  });
});
