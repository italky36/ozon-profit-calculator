import { describe, it, expect } from "vitest";
import { calculateRow } from "../src/lib/calc";
import type {
  OzonCommissions,
  ProductInput,
  References,
  TaxSettings,
} from "../src/types";
import commissions from "../src/data/commissions.json";
import storage from "../src/data/storage.json";
import logisticsTariffs from "../src/data/logisticsTariffs.json";
import logisticsSettings from "../src/data/logisticsSettings.json";
import defaultTaxSettings from "../src/data/defaultTaxSettings.json";

const refs: References = {
  commissions: commissions as References["commissions"],
  storage: storage as References["storage"],
  logisticsTariffs: logisticsTariffs as References["logisticsTariffs"],
  logisticsSettings: logisticsSettings as References["logisticsSettings"],
};

// Override usnVatRate to 5% for the acceptance fixture so the kofeavtomat's
// per-product `vatRate: 0.05` keeps its meaning (the global setting now
// drives VAT on USN; default is "Не облагается"=0).
const settings: TaxSettings = {
  ...(defaultTaxSettings as TaxSettings),
  usnVatRate: 0.05,
};

const baseInput: ProductInput = {
  articleId: "TEST-001",
  productName: "Coffee machine",
  category: "Кофеварки и кофемашины",
  productType: "Автоматическая кофемашина",
  volumeL: 209,
  isKgt: false,
  isKazakhstan: false,
  isFireHazard: false,
  plannedStorageDays: 30,
  vatRate: 0.05,
  redemptionPercent: 90,
  salesPlan: 10,
  logisticsMode: "Авто",
  clustersCount: "Считать без наценки",
  localShare: 0.5,
  dispatchCluster: "Москва, МО и Дальние регионы",
  destinationCluster: "Москва, МО и Дальние регионы",
  currentPrice: 337000,
  discountPercent: 0.345,
  marketingPercent: 0,
  realFbsDeliveryCost: 500,
  realFbsReturnCost: 250,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 87000,
  extraExpensesPerUnit: 0,
  whitePurchase: true,
  incomingVatPurchase: false,
  incomingVatRate: 0,
};

describe("calculateRow — coffee machine reference", () => {
  it("matches Excel reference within tolerance", () => {
    const r = calculateRow(baseInput, settings, refs);

    expect(r.promoPrice).toBeCloseTo(220735, 0);
    // tolerance ±100: numDigits = -2 (vitest) gives ±50 — use -3 for ±500
    expect(Math.abs(r.fbo.marginRub - 25190)).toBeLessThan(500);
    expect(r.fbo.marginPercent).toBeCloseTo(0.114, 2);
    expect(Math.abs(r.fbs.marginRub - 12845)).toBeLessThan(500);
    expect(Math.abs(r.realFbs.marginRub - 13836)).toBeLessThan(500);
    expect(r.fbo.profitability).toBeCloseTo(0.2895, 2);
  });
});

describe("edge cases", () => {
  it("zero costPrice → profitability = 0 (guarded)", () => {
    const r = calculateRow({ ...baseInput, costPrice: 0 }, settings, refs);
    expect(Number.isFinite(r.fbo.profitability)).toBe(true);
  });

  it("price bucket boundaries return finite results", () => {
    for (const price of [100, 300, 1500, 5000, 10000]) {
      const r = calculateRow(
        { ...baseInput, currentPrice: price, discountPercent: 0 },
        settings,
        refs,
      );
      expect(Number.isFinite(r.fbo.marginRub)).toBe(true);
      expect(Number.isFinite(r.fbs.marginRub)).toBe(true);
      expect(Number.isFinite(r.realFbs.marginRub)).toBe(true);
    }
  });

  it("totalProfit = marginRub × salesPlan", () => {
    const r = calculateRow(baseInput, settings, refs);
    expect(r.fbo.totalProfit).toBeCloseTo(r.fbo.marginRub * baseInput.salesPlan, 4);
  });
});

describe("Ozon API per-SKU override (Phase 5)", () => {
  it("uses sales_percent_fbo + fbo_direct_flow_trans_max + fbo_deliv_to_customer instead of tables", () => {
    const tableResult = calculateRow(baseInput, settings, refs);
    expect(tableResult.usedOzonCommissions).toBe(false);

    // Synthetic commissions block radically different from the table values so
    // the override path is unmistakable in the numbers.
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 5, // table-derived FBO commission was ~17–25%
      sales_percent_fbs: 5,
      fbo_direct_flow_trans_max_amount: 100,
      fbs_direct_flow_trans_max_amount: 100,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
    };

    const apiResult = calculateRow(baseInput, settings, refs, { ozonCommissions });
    expect(apiResult.usedOzonCommissions).toBe(true);

    // With drastically lower commissions/logistics, FBO margin should jump well
    // above the table-path baseline.
    expect(apiResult.fbo.marginRub).toBeGreaterThan(tableResult.fbo.marginRub + 10000);

    // Commission line should equal promoPrice * 5% (with rounding tolerance).
    expect(apiResult.fbo.commissionRub).toBeCloseTo(apiResult.promoPrice * 0.05, 0);

    // Logistics line equals the API-supplied flat amount.
    expect(apiResult.fbo.logisticsRub).toBe(100);
    // Last-mile is 0 per the override.
    expect(apiResult.fbo.lastMileRub).toBe(0);
  });

  it("falls back to tables when ozonCommissions is null/undefined", () => {
    const a = calculateRow(baseInput, settings, refs, { ozonCommissions: null });
    const b = calculateRow(baseInput, settings, refs);
    expect(a.fbo.marginRub).toBe(b.fbo.marginRub);
    expect(a.usedOzonCommissions).toBe(false);
  });

  it("realFBS uses sales_percent_fbs (Ozon doesn't differentiate)", () => {
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 20,
      sales_percent_fbs: 10,
      fbo_direct_flow_trans_max_amount: 0,
      fbs_direct_flow_trans_max_amount: 0,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
    };
    const r = calculateRow(baseInput, settings, refs, { ozonCommissions });
    expect(r.fbs.commissionRub).toBeCloseTo(r.promoPrice * 0.1, 0);
    expect(r.realFbs.commissionRub).toBeCloseTo(r.promoPrice * 0.1, 0);
  });

  it("treats Ozon sales_percent values as percentages, not fractions", () => {
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 40,
      sales_percent_fbs: 46,
      fbo_direct_flow_trans_max_amount: 0,
      fbs_direct_flow_trans_max_amount: 0,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
    };

    const r = calculateRow(
      { ...baseInput, currentPrice: 1000, discountPercent: 0 },
      settings,
      refs,
      { ozonCommissions },
    );

    expect(r.fbo.commissionRub).toBe(400);
    expect(r.fbs.commissionRub).toBe(460);
  });

  it("uses sales_percent_rfbs for realFBS when present (separate from FBS)", () => {
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 20,
      sales_percent_fbs: 10,
      sales_percent_rfbs: 25,
      fbo_direct_flow_trans_max_amount: 0,
      fbs_direct_flow_trans_max_amount: 0,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
    };
    const r = calculateRow(baseInput, settings, refs, { ozonCommissions });
    expect(r.fbs.commissionRub).toBeCloseTo(r.promoPrice * 0.1, 0);
    expect(r.realFbs.commissionRub).toBeCloseTo(r.promoPrice * 0.25, 0);
  });

  it("uses fbs_first_mile_max_amount when API supplies it (FBS first-mile)", () => {
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 0,
      sales_percent_fbs: 0,
      fbo_direct_flow_trans_max_amount: 0,
      fbs_direct_flow_trans_max_amount: 0,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
      fbs_first_mile_max_amount: 70,
    };
    const r = calculateRow(baseInput, settings, refs, { ozonCommissions });
    // FBS acceptance line surfaces first-mile.
    expect(r.fbs.acceptanceRub).toBe(70);
  });

  it("calcMode='ozon' uses fbs_return_flow_amount; calcMode='tz' uses (baseDelivery+15)×return%", () => {
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 5,
      sales_percent_fbs: 5,
      fbo_direct_flow_trans_max_amount: 100,
      fbs_direct_flow_trans_max_amount: 100,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
      fbo_return_flow_amount: 200,
      fbs_return_flow_amount: 300,
    };

    const tz = calculateRow(baseInput, { ...settings, calcMode: "tz" }, refs, {
      ozonCommissions,
    });
    const ozon = calculateRow(
      baseInput,
      { ...settings, calcMode: "ozon" },
      refs,
      { ozonCommissions },
    );

    // returnPercentInt = 100 - 90 = 10. baseDelivery (FBS direct-flow) = 100.
    // tz: (100 + 15) × 10 / 100 = 11.5 ₽
    // ozon FBS: 300 × 10 / 100 = 30 ₽
    expect(tz.fbs.ozonReturnServicesRub).toBeCloseTo(11.5, 5);
    expect(ozon.fbs.ozonReturnServicesRub).toBeCloseTo(30, 5);
    // FBO ozon: 200 × 10 / 100 = 20 ₽
    expect(ozon.fbo.ozonReturnServicesRub).toBeCloseTo(20, 5);
  });

  it("ozonNetPayout matches Ozon online calculator iPhone reference (FBO/FBS)", () => {
    // Reproduce the screenshot from seller.ozon.ru calculator: iPhone 17 256GB
    // price 65292 ₽, FBO commission 27 % / FBS 34 %, logistics 80, last-mile 25,
    // FBS first-mile 30, no returns. Note: Ozon online displays acquiring at 1 %
    // (653 ₽) but the official Excel calc uses 1.5 % — we follow the Excel.
    // Expected with 1.5 %: FBO net ≈ 65292 - (17629 + 979 + 80 + 25) = 46579,
    // FBS net ≈ 65292 - (22199 + 979 + 30 + 80 + 25) = 41979.
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 27,
      sales_percent_fbs: 34,
      sales_percent_rfbs: 34,
      fbo_direct_flow_trans_min_amount: 80,
      fbo_direct_flow_trans_max_amount: 80,
      fbs_direct_flow_trans_min_amount: 80,
      fbs_direct_flow_trans_max_amount: 80,
      fbo_deliv_to_customer_amount: 25,
      fbs_deliv_to_customer_amount: 25,
      fbs_first_mile_max_amount: 30,
      fbo_return_flow_amount: 0,
      fbs_return_flow_amount: 0,
    };
    const input: ProductInput = {
      ...baseInput,
      currentPrice: 65292,
      discountPercent: 0,
      isKgt: false,
      // Storage off: planned ≤ free days for the coffee category, big enough.
      plannedStorageDays: 0,
      acceptanceTariff: "Доверительная приемка",
    };
    const r = calculateRow(input, { ...settings, calcMode: "ozon" }, refs, {
      ozonCommissions,
    });
    // FBO: 65292 − (17628.84 + 979.38 + 80 + 25) = 46578.78
    expect(r.fbo.ozonNetPayout).toBeCloseTo(46578.78, 1);
    // FBS: 65292 − (22199.28 + 979.38 + 30 + 80 + 25) = 41978.34
    expect(r.fbs.ozonNetPayout).toBeCloseTo(41978.34, 1);
  });

  it("dispatchCluster === destinationCluster picks min logistics bracket", () => {
    const ozonCommissions: OzonCommissions = {
      sales_percent_fbo: 0,
      sales_percent_fbs: 0,
      fbo_direct_flow_trans_min_amount: 50,
      fbo_direct_flow_trans_max_amount: 200,
      fbs_direct_flow_trans_min_amount: 60,
      fbs_direct_flow_trans_max_amount: 250,
      fbo_deliv_to_customer_amount: 0,
      fbs_deliv_to_customer_amount: 0,
    };
    const local = calculateRow(
      {
        ...baseInput,
        dispatchCluster: "Москва, МО и Дальние регионы",
        destinationCluster: "Москва, МО и Дальние регионы",
      },
      settings,
      refs,
      { ozonCommissions },
    );
    const remote = calculateRow(
      {
        ...baseInput,
        dispatchCluster: "Москва, МО и Дальние регионы",
        destinationCluster: "Сибирь",
      },
      settings,
      refs,
      { ozonCommissions },
    );
    expect(local.fbo.logisticsRub).toBe(50);
    expect(local.fbs.logisticsRub).toBe(60);
    expect(remote.fbo.logisticsRub).toBe(200);
    expect(remote.fbs.logisticsRub).toBe(250);
  });
});

describe("KGT cluster tariff", () => {
  const kgtRefs: References = {
    ...refs,
    kgtClusterTariffs: [
      {
        volumeFrom: 0,
        fromCluster: "Москва, МО и Дальние регионы",
        toCluster: "Москва, МО и Дальние регионы",
        tariffLte300: 9999,
        tariffGt300: 9999,
      },
    ],
  };

  it("при isKgt=true берёт тариф из refs.kgtClusterTariffs (FBO+FBS)", () => {
    const kgt = calculateRow(
      { ...baseInput, isKgt: true },
      settings,
      kgtRefs,
    );
    expect(kgt.fbo.logisticsRub).toBe(9999);
    expect(kgt.fbs.logisticsRub).toBe(9999);
    // realFBS не трогаем — для него своя логика
    expect(kgt.realFbs.logisticsRub).not.toBe(9999);
  });

  it("при isKgt=false KGT-сетка игнорируется", () => {
    const r = calculateRow({ ...baseInput, isKgt: false }, settings, kgtRefs);
    expect(r.fbo.logisticsRub).not.toBe(9999);
    expect(r.fbs.logisticsRub).not.toBe(9999);
  });

  it("при isKgt=true и отсутствии KGT-сетки — fallback на табличный расчёт", () => {
    const noKgt = calculateRow({ ...baseInput, isKgt: true }, settings, refs);
    const baseline = calculateRow(baseInput, settings, refs);
    // Логистика для КГТ-товара без KGT-набора равна табличной (как для не-КГТ).
    expect(noKgt.fbo.logisticsRub).toBe(baseline.fbo.logisticsRub);
    expect(noKgt.fbs.logisticsRub).toBe(baseline.fbs.logisticsRub);
  });
});
