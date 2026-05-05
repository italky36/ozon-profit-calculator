import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { userSettings } from "../db/schema";
import type { DB } from "../db/client";
import type { TaxSettings } from "../../src/types";

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
  return r as TaxSettings;
};

export function settingsRoutes(db: DB): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.id, 1));
    if (!row) return c.json({ error: "not seeded" }, 500);
    return c.json(row.taxSettings);
  });

  app.put("/", async (c) => {
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
    const now = new Date();
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.id, 1));
    if (!existing) {
      await db.insert(userSettings).values({
        id: 1,
        taxSettings: next,
        updatedAt: now,
      });
    } else {
      await db
        .update(userSettings)
        .set({ taxSettings: next, updatedAt: now })
        .where(eq(userSettings.id, 1));
    }
    return c.json(next);
  });

  app.get("/auto-refresh", async (c) => {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.id, 1));
    return c.json({
      enabled: row?.autoRefreshEnabled ?? false,
      intervalMin: row?.autoRefreshIntervalMin ?? 30,
    });
  });

  app.put("/auto-refresh", async (c) => {
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

    const now = new Date();
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.id, 1));
    if (!existing) {
      return c.json({ error: "user_settings not seeded" }, 500);
    }
    await db
      .update(userSettings)
      .set({
        autoRefreshEnabled: r.enabled,
        autoRefreshIntervalMin: min,
        updatedAt: now,
      })
      .where(eq(userSettings.id, 1));
    return c.json({ enabled: r.enabled, intervalMin: min });
  });

  return app;
}
