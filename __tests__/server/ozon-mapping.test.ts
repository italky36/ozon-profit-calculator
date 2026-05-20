import { describe, it, expect } from "vitest";
import {
  computeCurrentPriceAndDiscount,
  computeVolumeL,
  mapCatalogEntry,
  NEW_PRODUCT_DEFAULTS,
  parseOzonVat,
  pickPublicSku,
} from "../../server/ozon/mapToProduct";
import type { OzonProductInfo, OzonPriceItem } from "../../server/ozon/types";
import type { CategoryLookup } from "../../server/ozon/catalog";

const lookup: CategoryLookup = {
  resolve: (cat, type) =>
    cat === 17027578 && type === 970761122
      ? { categoryName: "Кофеварки и кофемашины", typeName: "Автоматическая кофемашина" }
      : null,
};

describe("parseOzonVat", () => {
  it.each([
    ["0", "Не облагается"],
    ["0.0", "Не облагается"],
    ["0.05", 0.05],
    ["0.07", 0.07],
    ["0.1", 0.1],
    ["0.10", 0.1],
    ["0.20", 0.22],
    ["0.22", 0.22],
    ["0,05", 0.05],
  ])("%s → %s", (input, expected) => {
    expect(parseOzonVat(input)).toBe(expected);
  });

  it("falls back to 'Не облагается' for unknown", async () => {
    expect(parseOzonVat("nonsense")).toBe("Не облагается");
  });
});

describe("computeVolumeL", () => {
  it("converts mm dimensions to litres", async () => {
    const info = {
      dimensions: { depth: 100, height: 100, width: 100, dimension_unit: "mm" },
    } as OzonProductInfo;
    // 100mm × 100mm × 100mm = 1000 cm³ = 1 L
    expect(computeVolumeL(info)).toBeCloseTo(1, 5);
  });

  it("converts cm dimensions to litres", async () => {
    const info = {
      dimensions: { depth: 10, height: 10, width: 10, dimension_unit: "cm" },
    } as OzonProductInfo;
    expect(computeVolumeL(info)).toBeCloseTo(1, 5);
  });

  it("returns 0 on degenerate dimensions", async () => {
    const info = {
      dimensions: { depth: 0, height: 100, width: 100, dimension_unit: "mm" },
    } as OzonProductInfo;
    expect(computeVolumeL(info)).toBe(0);
  });
});

describe("computeCurrentPriceAndDiscount", () => {
  it("uses old_price → price strike-through when no marketing promo", async () => {
    const r = computeCurrentPriceAndDiscount({
      price: "700",
      old_price: "1000",
      currency_code: "RUB",
    } as OzonPriceItem["price"]);
    expect(r.currentPrice).toBe(700);
    expect(r.discountPercent).toBeCloseTo(0.3, 4);
    expect(r.regularPrice).toBeNull();
  });

  it("returns no discount when old_price equals price", async () => {
    const r = computeCurrentPriceAndDiscount({
      price: "1000",
      old_price: "1000",
      currency_code: "RUB",
    } as OzonPriceItem["price"]);
    expect(r.currentPrice).toBe(1000);
    expect(r.discountPercent).toBe(0);
    expect(r.regularPrice).toBeNull();
  });

  it("returns no discount when old_price missing and no promo", async () => {
    const r = computeCurrentPriceAndDiscount({
      price: "1000",
      old_price: "0",
      currency_code: "RUB",
    } as OzonPriceItem["price"]);
    expect(r.currentPrice).toBe(1000);
    expect(r.discountPercent).toBe(0);
    expect(r.regularPrice).toBeNull();
  });

  it("takes marketing_seller_price directly + exposes sticker as regularPrice", async () => {
    // Real-world example: sticker 2990, sold for 1668 via "Эластичный бустинг".
    const r = computeCurrentPriceAndDiscount({
      price: 2990,
      old_price: 0,
      marketing_seller_price: 1668,
      currency_code: "RUB",
    } as OzonPriceItem["price"]);
    expect(r.currentPrice).toBe(1668);
    expect(r.discountPercent).toBe(0);
    expect(r.regularPrice).toBe(2990);
  });

  it("does not expose regularPrice when sticker equals marketing price", async () => {
    const r = computeCurrentPriceAndDiscount({
      price: 1500,
      old_price: 0,
      marketing_seller_price: 1500,
      currency_code: "RUB",
    } as OzonPriceItem["price"]);
    expect(r.currentPrice).toBe(1500);
    expect(r.regularPrice).toBeNull();
  });

  it("prefers marketing_seller_price over old_price strike-through", async () => {
    const r = computeCurrentPriceAndDiscount({
      price: 1000,
      old_price: 1200,
      marketing_seller_price: 800,
      currency_code: "RUB",
    } as OzonPriceItem["price"]);
    expect(r.currentPrice).toBe(800);
    expect(r.discountPercent).toBe(0);
    expect(r.regularPrice).toBe(1000);
  });
});

describe("mapCatalogEntry", () => {
  const info: OzonProductInfo = {
    id: 12345,
    offer_id: "COFFEE-1",
    name: "Кофемашина X",
    description_category_id: 17027578,
    type_id: 970761122,
    vat: "0.05",
    weight: 12000,
    weight_unit: "g",
    dimensions: { depth: 500, height: 400, width: 600, dimension_unit: "mm" },
    is_kgt: true,
  };
  const price: OzonPriceItem = {
    product_id: 12345,
    offer_id: "COFFEE-1",
    price: { price: "337000", old_price: "514000", currency_code: "RUB" },
  };

  it("maps full record", async () => {
    const m = mapCatalogEntry(info, price, undefined, lookup);
    expect(m.articleId).toBe("COFFEE-1");
    expect(m.ozonProductId).toBe(12345);
    expect(m.patch.category).toBe("Кофеварки и кофемашины");
    expect(m.patch.productType).toBe("Автоматическая кофемашина");
    expect(m.patch.vatRate).toBe(0.05);
    expect(m.patch.isKgt).toBe(true);
    expect(m.patch.volumeL).toBeCloseTo(120, 1); // 500*400*600 mm³ = 120000 cm³ → 120 L
    expect(m.patch.currentPrice).toBe(337000);
    expect(m.patch.discountPercent).toBeCloseTo((514000 - 337000) / 514000, 4);
    expect(m.costPrice).toBeNull();
  });

  it("picks up net_price as costPrice when seller has filled it in LK", async () => {
    const m = mapCatalogEntry(
      info,
      {
        ...price,
        price: { ...price.price, net_price: 200000 },
      } as OzonPriceItem,
      undefined,
      lookup,
    );
    expect(m.costPrice).toBe(200000);
  });

  it("leaves costPrice null when net_price is 0", async () => {
    const m = mapCatalogEntry(
      info,
      {
        ...price,
        price: { ...price.price, net_price: 0 },
      } as OzonPriceItem,
      undefined,
      lookup,
    );
    expect(m.costPrice).toBeNull();
  });

  it("handles missing price gracefully", async () => {
    const m = mapCatalogEntry(info, undefined, undefined, lookup);
    expect(m.patch.currentPrice).toBe(0);
    expect(m.patch.discountPercent).toBe(0);
    expect(m.costPrice).toBeNull();
  });

  it("emits empty category names when lookup fails", async () => {
    const m = mapCatalogEntry(
      { ...info, type_id: 99999 },
      price,
      undefined,
      lookup,
    );
    expect(m.patch.category).toBe("");
    expect(m.patch.productType).toBe("");
  });
});

describe("pickPublicSku", () => {
  it("returns null when sources is missing or empty", async () => {
    expect(pickPublicSku({ id: 1 } as OzonProductInfo)).toBeNull();
    expect(pickPublicSku({ id: 1, sources: [] } as OzonProductInfo)).toBeNull();
  });

  it("prefers fbo over fbs", async () => {
    const info = {
      id: 1,
      sources: [
        { sku: 222, source: "fbs" },
        { sku: 111, source: "fbo" },
      ],
    } as OzonProductInfo;
    expect(pickPublicSku(info)).toBe(111);
  });

  it("falls back to fbs when fbo absent", async () => {
    const info = {
      id: 1,
      sources: [{ sku: 333, source: "fbs" }],
    } as OzonProductInfo;
    expect(pickPublicSku(info)).toBe(333);
  });

  it("falls back to first valid sku for unknown source", async () => {
    const info = {
      id: 1,
      sources: [
        { sku: 0, source: "fbo" },
        { sku: 444, source: "rfbs" },
      ],
    } as OzonProductInfo;
    expect(pickPublicSku(info)).toBe(444);
  });
});

describe("NEW_PRODUCT_DEFAULTS", () => {
  it("provides all non-catalog fields with safe values", async () => {
    expect(NEW_PRODUCT_DEFAULTS.salesPlan).toBe(0);
    expect(NEW_PRODUCT_DEFAULTS.costPrice).toBe(0);
    expect(NEW_PRODUCT_DEFAULTS.logisticsMode).toBe("Авто");
    expect(NEW_PRODUCT_DEFAULTS.acceptanceTariff).toBe("Доверительная приемка");
    expect(NEW_PRODUCT_DEFAULTS.clustersCount).toBe("Считать без наценки");
  });
});
