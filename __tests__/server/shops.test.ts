import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { shops, userSettings } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

interface ShopOut {
  id: number;
  name: string;
  shortName: string;
  color: string | null;
  hasOzonCreds: boolean;
}

describe("shops CRUD", () => {
  let env: TestEnv;
  let alice: { cookie: string; userId: number; shopId: number };

  beforeEach(async () => {
    env = setupTestEnv();
    alice = await loginAs(env, "alice@test.local", "password");
  });
  afterEach(() => teardownTestEnv(env));

  const headers = () => ({
    "Content-Type": "application/json",
    Cookie: alice.cookie,
  });

  it("GET /api/shops returns the default shop after login", async () => {
    const res = await env.app.request("/api/shops", { headers: headers() });
    expect(res.status).toBe(200);
    const list = (await res.json()) as ShopOut[];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(alice.shopId);
  });

  it("POST /api/shops creates a shop with auto shortName", async () => {
    const res = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "Second shop" }),
    });
    expect(res.status).toBe(201);
    const shop = (await res.json()) as ShopOut;
    expect(shop.name).toBe("Second shop");
    expect(shop.shortName).toHaveLength(2);
  });

  it("POST /api/shops rejects shortName !== 2 chars", async () => {
    const res = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "X", shortName: "ABC" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/shops rejects empty name", async () => {
    const res = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/shops returns 409 on duplicate shortName", async () => {
    const a = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "S1", shortName: "AB" }),
    });
    expect(a.status).toBe(201);
    const b = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "S2", shortName: "AB" }),
    });
    expect(b.status).toBe(409);
  });

  it("PATCH /api/shops/:id updates fields", async () => {
    const res = await env.app.request(`/api/shops/${alice.shopId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ name: "Renamed", color: "#16a34a" }),
    });
    expect(res.status).toBe(200);
    const shop = (await res.json()) as ShopOut;
    expect(shop.name).toBe("Renamed");
    expect(shop.color).toBe("#16a34a");
  });

  it("PATCH on another user's shop returns 404", async () => {
    const bob = await loginAs(env, "bob@test.local", "password");
    const res = await env.app.request(`/api/shops/${bob.shopId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ name: "Hijack" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/shops/:id cascades but is forbidden if last shop", async () => {
    const tooSoon = await env.app.request(`/api/shops/${alice.shopId}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(tooSoon.status).toBe(400);

    const create = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "Second" }),
    });
    expect(create.status).toBe(201);
    const second = (await create.json()) as ShopOut;

    const ok = await env.app.request(`/api/shops/${second.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(ok.status).toBe(204);

    const after = env.db
      .select()
      .from(shops)
      .where(eq(shops.workspaceId, alice.workspaceId))
      .all();
    expect(after).toHaveLength(1);
  });

  it("PUT /api/shops/active updates user_settings.active_shop_id", async () => {
    const create = await env.app.request("/api/shops", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "Other" }),
    });
    const other = (await create.json()) as ShopOut;

    const res = await env.app.request("/api/shops/active", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ shopId: other.id }),
    });
    expect(res.status).toBe(200);

    const [row] = env.db
      .select({ activeShopId: userSettings.activeShopId })
      .from(userSettings)
      .where(eq(userSettings.userId, alice.userId))
      .all();
    expect(row.activeShopId).toBe(other.id);
  });

  it("PUT /api/shops/active rejects shop of another user", async () => {
    const bob = await loginAs(env, "bob@test.local", "password");
    const res = await env.app.request("/api/shops/active", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ shopId: bob.shopId }),
    });
    expect(res.status).toBe(404);
  });
});

describe("auth.verifyEmail autocreates a default shop", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = setupTestEnv();
  });
  afterEach(() => teardownTestEnv(env));

  it("registration → verify creates a 'Мой магазин' (M1) and sets active", async () => {
    const reg = await env.app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "fresh@test.local",
        password: "password123",
        workspaceName: "Fresh Team",
      }),
    });
    expect(reg.status).toBe(200);

    // Pull token from the captured email body (dev fallback wraps token in url).
    const msg = env.emails.find((m) => m.to === "fresh@test.local");
    expect(msg).toBeTruthy();
    const tokenMatch = /token=([a-f0-9]+)/.exec(
      `${msg!.html ?? ""}${msg!.text ?? ""}`,
    );
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    const verify = await env.app.request("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(verify.status).toBe(200);

    const created = env.db
      .select()
      .from(shops)
      .all()
      .find((s) => s.name === "Мой магазин");
    expect(created?.shortName).toBe("M1");
    const settings = env.db
      .select({ activeShopId: userSettings.activeShopId })
      .from(userSettings)
      .all();
    expect(settings[0].activeShopId).toBe(created!.id);
  });
});
