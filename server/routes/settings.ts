import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { userSettings } from "../db/schema";
import type { DB } from "../db/client";
import type { TaxSettings } from "../../src/types";
import type { SessionUser } from "../auth/utils";

type SettingsEnv = { Variables: { user?: SessionUser } };

const TAX_SYSTEMS = new Set([
  "УСН Доходы",
  "УСН Доходы минус расходы",
  "АУСН Доходы",
  "АУСН Доходы минус расходы",
  "ОСНО ООО",
  "ОСНО ИП",
  "НПД",
]);

const NUMERIC_FIELDS: Array<keyof TaxSettings> = [
  "damageRate",
  "usnIncomeRate",
  "usnIncomeMinusRate",
  "ausnIncomeRate",
  "ausnIncomeMinusRate",
  "osnoOooRate",
  "osnoIpAnnualIncome",
  "npdRate",
  "partyExtraExpenses",
];

const validate = (raw: unknown): TaxSettings => {
  if (!raw || typeof raw !== "object") throw new Error("invalid input");
  const r = raw as Partial<TaxSettings>;
  if (!r.taxSystem || !TAX_SYSTEMS.has(r.taxSystem))
    throw new Error("invalid taxSystem");
  for (const f of NUMERIC_FIELDS) {
    const v = r[f];
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`invalid ${f}`);
  }
  if (r.calcMode !== undefined && r.calcMode !== "ozon" && r.calcMode !== "tz")
    throw new Error("invalid calcMode");
  if (r.usnVatRate !== undefined) {
    const v = r.usnVatRate;
    const ok =
      v === "Не облагается" ||
      v === 0.05 ||
      v === 0.07 ||
      v === 0.1 ||
      v === 0.22;
    if (!ok) throw new Error("invalid usnVatRate");
  }
  if (
    r.defaultWhitePurchase !== undefined &&
    typeof r.defaultWhitePurchase !== "boolean"
  )
    throw new Error("invalid defaultWhitePurchase");
  if (
    r.useClusterLogistics !== undefined &&
    typeof r.useClusterLogistics !== "boolean"
  )
    throw new Error("invalid useClusterLogistics");
  return r as TaxSettings;
};

/** Lazy lookup + create for the current user's settings row. Defaults are
 * copied from the seed row (`id=1`, possibly `user_id=NULL`). */
function ensureUserRow(
  db: DB,
  userId: number,
): typeof userSettings.$inferSelect | null {
  const existing = db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .get();
  if (existing) return existing;

  const seed =
    db
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.id, 1), isNull(userSettings.userId)))
      .get() ??
    db.select().from(userSettings).where(eq(userSettings.id, 1)).get();
  if (!seed) return null;

  const now = new Date();
  db.insert(userSettings)
    .values({
      userId,
      taxSettings: seed.taxSettings,
      autoRefreshEnabled: seed.autoRefreshEnabled,
      autoRefreshIntervalMin: seed.autoRefreshIntervalMin,
      updatedAt: now,
    })
    .run();
  return (
    db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .get() ?? null
  );
}

export function settingsRoutes(db: DB): Hono<SettingsEnv> {
  const app = new Hono<SettingsEnv>();

  app.get("/", (c) => {
    const user = c.get("user")!;
    const row = ensureUserRow(db, user.id);
    if (!row) return c.json({ error: "not seeded" }, 500);
    return c.json(row.taxSettings);
  });

  app.put("/", async (c) => {
    const user = c.get("user")!;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    let next: TaxSettings;
    try {
      next = validate(body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const row = ensureUserRow(db, user.id);
    if (!row) return c.json({ error: "not seeded" }, 500);
    const now = new Date();
    db.update(userSettings)
      .set({ taxSettings: next, updatedAt: now })
      .where(eq(userSettings.userId, user.id))
      .run();
    return c.json(next);
  });

  app.get("/auto-refresh", (c) => {
    const user = c.get("user")!;
    const row = ensureUserRow(db, user.id);
    return c.json({
      enabled: row?.autoRefreshEnabled ?? false,
      intervalMin: row?.autoRefreshIntervalMin ?? 30,
    });
  });

  app.put("/auto-refresh", async (c) => {
    const user = c.get("user")!;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const r = (body ?? {}) as { enabled?: unknown; intervalMin?: unknown };
    if (typeof r.enabled !== "boolean")
      return c.json({ error: "enabled must be boolean" }, 400);
    const min =
      typeof r.intervalMin === "number" && Number.isFinite(r.intervalMin)
        ? Math.max(1, Math.min(1440, Math.round(r.intervalMin)))
        : 30;
    const row = ensureUserRow(db, user.id);
    if (!row) return c.json({ error: "not seeded" }, 500);
    const now = new Date();
    db.update(userSettings)
      .set({
        autoRefreshEnabled: r.enabled,
        autoRefreshIntervalMin: min,
        updatedAt: now,
      })
      .where(eq(userSettings.userId, user.id))
      .run();
    return c.json({ enabled: r.enabled, intervalMin: min });
  });

  return app;
}
