import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  logisticsClusterTariffSets,
  logisticsClusterTariffs,
} from "../../server/db/schema";
import * as XLSX from "xlsx";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";
import { resolveTariffSetId } from "../../server/settings/tariffSets";

const buildXlsxBuffer = (rows: Array<[number, string, string, number, number]>): Buffer => {
  const aoa = [
    ["Объём, л", "Кластер отправки", "Кластер назначения", "до 300", "свыше 300"],
    ...rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

const uploadSet = async (
  app: TestEnv["app"],
  cookie: string,
  opts: {
    name: string;
    scope: "global" | "shop";
    shopId?: number;
    rows?: Array<[number, string, string, number, number]>;
  },
): Promise<Response> => {
  const buf = buildXlsxBuffer(opts.rows ?? [[1, "A", "B", 100, 200]]);
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(buf)], "tariffs.xlsx"));
  fd.append("name", opts.name);
  fd.append("scope", opts.scope);
  if (opts.scope === "shop" && opts.shopId != null) {
    fd.append("shopId", String(opts.shopId));
  }
  return app.request("/api/refs/cluster-logistics/sets", {
    method: "POST",
    headers: { Cookie: cookie },
    body: fd,
  });
};

describe("cluster tariff sets", () => {
  let env: TestEnv;
  let admin: { cookie: string; userId: number; shopId: number };
  let user: { cookie: string; userId: number; shopId: number };

  beforeEach(async () => {
    env = setupTestEnv();
    admin = await loginAs(env, "admin@test.local", "password", "admin");
    user = await loginAs(env, "user@test.local", "password", "user");
  });
  afterEach(() => teardownTestEnv(env));

  it("GET /sets returns globals + own personal", async () => {
    // Admin uploads a global, user uploads a personal one.
    const g = await uploadSet(env.app, admin.cookie, {
      name: "Global Q2",
      scope: "global",
    });
    expect(g.status).toBe(201);
    const p = await uploadSet(env.app, user.cookie, {
      name: "User own",
      scope: "shop",
      shopId: user.shopId,
    });
    expect(p.status).toBe(201);

    const res = await env.app.request("/api/refs/cluster-logistics/sets", {
      headers: { Cookie: user.cookie },
    });
    const list = (await res.json()) as Array<{ name: string; scope: string }>;
    const names = list.map((s) => s.name).sort();
    expect(names).toContain("Global Q2");
    expect(names).toContain("User own");
    // Should not contain admin's personal sets (only admin's globals are visible).
  });

  it("user cannot upload global (admin-only)", async () => {
    const res = await uploadSet(env.app, user.cookie, {
      name: "Hijack global",
      scope: "global",
    });
    expect(res.status).toBe(403);
  });

  it("admin can upload global", async () => {
    const res = await uploadSet(env.app, admin.cookie, {
      name: "Admin global",
      scope: "global",
    });
    expect(res.status).toBe(201);
  });

  it("user cannot upload personal set to another user's shop", async () => {
    const res = await uploadSet(env.app, user.cookie, {
      name: "Cross-shop",
      scope: "shop",
      shopId: admin.shopId,
    });
    expect(res.status).toBe(404);
  });

  it("DELETE: only admin can delete global", async () => {
    const created = await uploadSet(env.app, admin.cookie, {
      name: "Deletable global",
      scope: "global",
    });
    const set = (await created.json()) as { id: number };
    const userDel = await env.app.request(
      `/api/refs/cluster-logistics/sets/${set.id}`,
      { method: "DELETE", headers: { Cookie: user.cookie } },
    );
    expect(userDel.status).toBe(403);
    const adminDel = await env.app.request(
      `/api/refs/cluster-logistics/sets/${set.id}`,
      { method: "DELETE", headers: { Cookie: admin.cookie } },
    );
    expect(adminDel.status).toBe(204);
  });

  it("DELETE: only owner can delete personal set", async () => {
    const created = await uploadSet(env.app, user.cookie, {
      name: "User's set",
      scope: "shop",
      shopId: user.shopId,
    });
    const set = (await created.json()) as { id: number };
    const otherDel = await env.app.request(
      `/api/refs/cluster-logistics/sets/${set.id}`,
      { method: "DELETE", headers: { Cookie: admin.cookie } },
    );
    expect(otherDel.status).toBe(403);
    const ownDel = await env.app.request(
      `/api/refs/cluster-logistics/sets/${set.id}`,
      { method: "DELETE", headers: { Cookie: user.cookie } },
    );
    expect(ownDel.status).toBe(204);
  });

  it("resolveTariffSetId prefers shop's own selection over latest global", async () => {
    // Two globals — newer should win as default.
    const oldGlobal = env.db
      .insert(logisticsClusterTariffSets)
      .values({
        workspaceId: null,
        name: "Old",
        uploadedAt: new Date(2026, 0, 1),
        createdAt: new Date(),
      })
      .returning()
      .get();
    const newGlobal = env.db
      .insert(logisticsClusterTariffSets)
      .values({
        workspaceId: null,
        name: "New",
        uploadedAt: new Date(2026, 5, 1),
        createdAt: new Date(),
      })
      .returning()
      .get();
    void oldGlobal;

    expect(await resolveTariffSetId(env.db, user.shopId)).toBe(newGlobal.id);

    // Now user pins the old one.
    env.sqlite
      .prepare("UPDATE shops SET tariff_set_id = ? WHERE id = ?")
      .run(oldGlobal.id, user.shopId);
    expect(await resolveTariffSetId(env.db, user.shopId)).toBe(oldGlobal.id);
  });

  it("resolveTariffSetId rejects pointing at another workspace's personal set", async () => {
    const adminPersonal = env.db
      .insert(logisticsClusterTariffSets)
      .values({
        workspaceId: admin.workspaceId,
        name: "Admin's personal",
        uploadedAt: new Date(),
        createdAt: new Date(),
      })
      .returning()
      .get();
    // Pin user's shop to admin's personal set (would happen through bad client).
    env.sqlite
      .prepare("UPDATE shops SET tariff_set_id = ? WHERE id = ?")
      .run(adminPersonal.id, user.shopId);
    // Resolver should fall back to global (or null if no globals).
    const resolved = await resolveTariffSetId(env.db, user.shopId);
    expect(resolved).not.toBe(adminPersonal.id);
  });

  it("cascade: deleting a set wipes its tariff rows", async () => {
    const created = await uploadSet(env.app, user.cookie, {
      name: "Wipe me",
      scope: "shop",
      shopId: user.shopId,
      rows: [
        [1, "X", "Y", 100, 200],
        [5, "X", "Z", 110, 210],
      ],
    });
    const set = (await created.json()) as { id: number };
    const before = env.db
      .select()
      .from(logisticsClusterTariffs)
      .where(eq(logisticsClusterTariffs.setId, set.id))
      .all();
    expect(before).toHaveLength(2);

    await env.app.request(`/api/refs/cluster-logistics/sets/${set.id}`, {
      method: "DELETE",
      headers: { Cookie: user.cookie },
    });
    const after = env.db
      .select()
      .from(logisticsClusterTariffs)
      .where(eq(logisticsClusterTariffs.setId, set.id))
      .all();
    expect(after).toHaveLength(0);
  });
});
