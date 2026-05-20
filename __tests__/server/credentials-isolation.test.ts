import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { shops } from "../../server/db/schema";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

/** Cross-workspace Ozon credentials isolation. A workspace must not be able
 * to read, write, or even probe credentials belonging to shops in another
 * workspace. Endpoints must also never serialize the raw key values — only
 * a `hasCredentials` boolean. */
describe("credentials cross-workspace isolation", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupTestEnv();
  });
  afterEach(async () => await teardownTestEnv(env));

  /** Workspace A's owner sets credentials, then workspace B's owner tries to
   * see / mutate them. */
  async function setupTwoWorkspaces() {
    const a = await loginAs(env, "owner-a@x.com", "password123");
    const b = await loginAs(env, "owner-b@x.com", "password123");
    // Set creds on A's shop directly via DB to keep the test independent of
    // PUT-flow bugs (we test reads & mutations from B in isolation).
    await env.db
      .update(shops)
      .set({
        ozonClientId: "A-client-secret",
        ozonApiKey: "A-api-key-secret",
        ozonUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, a.shopId))
      ;
    return { a, b };
  }

  it("GET /api/credentials/status?shopId=<other-ws shop> returns 404", async () => {
    const { a, b } = await setupTwoWorkspaces();
    const res = await env.app.request(
      `/api/credentials/status?shopId=${a.shopId}`,
      { headers: { Cookie: b.cookie } },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    // Same opaque 404 as «not found in your workspace» — no info leak about
    // whether the shop exists at all.
    expect(body.error).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("A-client-secret");
    expect(JSON.stringify(body)).not.toContain("A-api-key-secret");
  });

  it("GET /api/credentials/status/all lists only the caller's workspace shops", async () => {
    const { a, b } = await setupTwoWorkspaces();
    const res = await env.app.request("/api/credentials/status/all", {
      headers: { Cookie: b.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shops: Array<{ shopId: number; hasCredentials: boolean }>;
    };
    const ids = body.shops.map((s) => s.shopId);
    expect(ids).not.toContain(a.shopId);
    expect(JSON.stringify(body)).not.toContain("A-client-secret");
    expect(JSON.stringify(body)).not.toContain("A-api-key-secret");
  });

  it("PUT /api/credentials with another workspace's shopId is rejected and does not overwrite", async () => {
    const { a, b } = await setupTwoWorkspaces();
    const res = await env.app.request("/api/credentials/", {
      method: "PUT",
      headers: { Cookie: b.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "B-tries-to-overwrite",
        apiKey: "B-tries-to-overwrite",
        shopId: a.shopId,
      }),
    });
    expect(res.status).toBe(404);
    const [row] = await env.db
      .select({
        clientId: shops.ozonClientId,
        apiKey: shops.ozonApiKey,
      })
      .from(shops)
      .where(eq(shops.id, a.shopId));
    expect(row.clientId).toBe("A-client-secret");
    expect(row.apiKey).toBe("A-api-key-secret");
  });

  it("DELETE /api/credentials with another workspace's shopId is rejected and does not clear", async () => {
    const { a, b } = await setupTwoWorkspaces();
    const res = await env.app.request(
      `/api/credentials/?shopId=${a.shopId}`,
      { method: "DELETE", headers: { Cookie: b.cookie } },
    );
    expect(res.status).toBe(404);
    const [row] = await env.db
      .select({
        clientId: shops.ozonClientId,
        apiKey: shops.ozonApiKey,
      })
      .from(shops)
      .where(eq(shops.id, a.shopId));
    expect(row.clientId).toBe("A-client-secret");
    expect(row.apiKey).toBe("A-api-key-secret");
  });

  it("GET /api/credentials/status?shopId=<own shop> never returns raw key values", async () => {
    const { a } = await setupTwoWorkspaces();
    const res = await env.app.request(
      `/api/credentials/status?shopId=${a.shopId}`,
      { headers: { Cookie: a.cookie } },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("A-client-secret");
    expect(text).not.toContain("A-api-key-secret");
    const body = JSON.parse(text) as { hasCredentials: boolean };
    expect(body.hasCredentials).toBe(true);
  });

  it("GET /api/shops never returns raw Ozon key values", async () => {
    const { a } = await setupTwoWorkspaces();
    const res = await env.app.request("/api/shops", {
      headers: { Cookie: a.cookie },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("A-client-secret");
    expect(text).not.toContain("A-api-key-secret");
  });
});
