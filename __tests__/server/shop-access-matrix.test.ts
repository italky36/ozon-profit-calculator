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

interface Matrix {
  members: Array<{ userId: number; email: string; role: string }>;
  shops: Array<{
    id: number;
    name: string;
    shortName: string;
    color: string | null;
  }>;
  assignments: Array<{ userId: number; shopId: number }>;
}

describe("GET /api/workspace/me/shop-access", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupTestEnv();
  });
  afterEach(async () => await teardownTestEnv(env));

  it("owner sees full matrix of workspace members × shops", async () => {
    const owner = await loginAs(env, "owner@x.com", "password123");
    // Add a second shop in the owner's workspace.
    const secondShopId = await createShopFor(env.db, owner.userId, {
      name: "Shop 2",
      shortName: "S2",
    });
    // Add a member by direct DB write — simulates an invite-acceptance flow.
    const member = await loginAs(env, "m@x.com", "password123");
    await env.db
      .update(workspaceMembers)
      .set({
        workspaceId: owner.workspaceId,
        role: "member",
      })
      .where(eq(workspaceMembers.userId, member.userId))
      ;
    // Assign member to the second shop only.
    await env.db
      .insert(shopMember)
      .values({
        shopId: secondShopId,
        userId: member.userId,
        createdAt: new Date(),
        createdBy: owner.userId,
      })
      ;

    const res = await env.app.request("/api/workspace/me/shop-access", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Matrix;

    expect(body.members).toHaveLength(2);
    expect(body.members.map((m) => m.email).sort()).toEqual([
      "m@x.com",
      "owner@x.com",
    ]);
    expect(body.shops.length).toBeGreaterThanOrEqual(2);
    expect(body.shops.find((s) => s.id === secondShopId)).toBeTruthy();

    // Member's assignment is in the matrix.
    expect(
      body.assignments.find(
        (a) => a.userId === member.userId && a.shopId === secondShopId,
      ),
    ).toBeTruthy();
    // Owner has NO shop_member rows (they see everything by default).
    expect(body.assignments.find((a) => a.userId === owner.userId)).toBeUndefined();
  });

  it("manager (canManageWorkspace) can also fetch the matrix", async () => {
    const owner = await loginAs(env, "owner@x.com", "password123");
    const manager = await loginAs(env, "mgr@x.com", "password123");
    await env.db
      .update(workspaceMembers)
      .set({
        workspaceId: owner.workspaceId,
        role: "manager",
      })
      .where(eq(workspaceMembers.userId, manager.userId))
      ;
    const fresh = await loginAs(env, "mgr@x.com", "password123");

    const res = await env.app.request("/api/workspace/me/shop-access", {
      headers: { Cookie: fresh.cookie },
    });
    expect(res.status).toBe(200);
  });

  it("member is rejected with 403", async () => {
    const owner = await loginAs(env, "owner@x.com", "password123");
    const member = await loginAs(env, "m@x.com", "password123");
    await env.db
      .update(workspaceMembers)
      .set({
        workspaceId: owner.workspaceId,
        role: "member",
      })
      .where(eq(workspaceMembers.userId, member.userId))
      ;
    const fresh = await loginAs(env, "m@x.com", "password123");

    const res = await env.app.request("/api/workspace/me/shop-access", {
      headers: { Cookie: fresh.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await env.app.request("/api/workspace/me/shop-access");
    expect(res.status).toBe(401);
  });

  it("only includes shops + assignments from caller's own workspace", async () => {
    const ownerA = await loginAs(env, "a@x.com", "password123");
    const ownerB = await loginAs(env, "b@x.com", "password123");
    // ownerB creates a shop in their OWN workspace; ownerA's matrix must not
    // see it (workspace isolation).
    const otherWorkspaceShopId = (await env.db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.workspaceId, ownerB.workspaceId))
      )[0]!.id;

    const res = await env.app.request("/api/workspace/me/shop-access", {
      headers: { Cookie: ownerA.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Matrix;
    expect(body.shops.find((s) => s.id === otherWorkspaceShopId)).toBeUndefined();
    expect(
      body.members.find((m) => m.email === "b@x.com"),
    ).toBeUndefined();
  });
});
