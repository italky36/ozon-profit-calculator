import type { CategoryLookup } from "./catalog";
import type { OzonPriceItem, OzonProductInfo } from "./types";
import type {
  OzonCommissions,
  ProductInput,
  VatRate,
} from "../../src/types";

/** Subset of ProductInput that Ozon authoritatively owns — written on every import. */
export type CatalogPatch = Pick<
  ProductInput,
  | "productName"
  | "category"
  | "productType"
  | "volumeL"
  | "vatRate"
  | "isKgt"
  | "currentPrice"
  | "discountPercent"
> & {
  ozonProductId: number;
  /** Sticker price from Ozon when a promo dropped currentPrice below it. */
  regularPrice: number | null;
};

/** Defaults used when inserting a brand-new row (no existing product matched articleId). */
export const NEW_PRODUCT_DEFAULTS: Omit<
  ProductInput,
  keyof CatalogPatch | "articleId"
> = {
  isKazakhstan: false,
  isFireHazard: false,
  plannedStorageDays: 30,
  redemptionPercent: 90,
  salesPlan: 0,
  logisticsMode: "Авто",
  localShare: 0.5,
  clustersCount: "Считать без наценки",
  marketingPercent: 0,
  realFbsDeliveryCost: 0,
  realFbsReturnCost: 0,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 0,
  extraExpensesPerUnit: 0,
  whitePurchase: false,
  incomingVatPurchase: false,
  incomingVatRate: 0,
};

const VAT_FROM_OZON: Record<string, VatRate> = {
  "0": "Не облагается",
  "0.0": "Не облагается",
  "0.05": 0.05,
  "0.07": 0.07,
  "0.1": 0.1,
  "0.10": 0.1,
  "0.20": 0.22,
  "0.22": 0.22,
};

export function parseOzonVat(raw: string | number | null | undefined): VatRate {
  if (raw == null) return "Не облагается";
  const trimmed = typeof raw === "string" ? raw.trim() : String(raw);
  if (trimmed in VAT_FROM_OZON) return VAT_FROM_OZON[trimmed];
  // Numeric fallback for unexpected formatting like "0,05".
  const n = Number(trimmed.replace(",", "."));
  if (Number.isFinite(n)) {
    if (n === 0) return "Не облагается";
    if (n === 0.05) return 0.05;
    if (n === 0.07) return 0.07;
    if (n === 0.1) return 0.1;
    if (n === 0.2 || n === 0.22) return 0.22;
  }
  return "Не облагается";
}

const UNIT_TO_CM: Record<string, number> = {
  mm: 0.1,
  cm: 1,
  in: 2.54,
};

/** Compute volume in litres from Ozon dimensions (cm³ / 1000). */
export function computeVolumeL(info: OzonProductInfo): number {
  if (!info.dimensions) return 0;
  const { depth, height, width, dimension_unit } = info.dimensions;
  const factor = UNIT_TO_CM[dimension_unit] ?? 0.1; // default mm
  const cmVolume =
    Number(depth) * factor *
    Number(height) * factor *
    Number(width) * factor;
  if (!Number.isFinite(cmVolume) || cmVolume <= 0) return 0;
  return cmVolume / 1000;
}

const toMoney = (s: string | number | undefined | null): number => {
  if (s == null || s === "") return 0;
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolve the price the buyer actually pays.
 *
 * Ozon already returns the post-promo price as `marketing_seller_price` —
 * if it's set, we use it directly as `currentPrice` and skip the
 * sticker × (1 − discount) split entirely. `discountPercent` is reserved
 * for the user's manual "what-if" promo on top of the real selling price.
 *
 * Fallback for the no-marketing case: if seller set a strike-through
 * `old_price > price`, we still surface the implied discount so the
 * existing UI behaves as before.
 */
export function computeCurrentPriceAndDiscount(
  price: OzonPriceItem["price"],
): { currentPrice: number; discountPercent: number; regularPrice: number | null } {
  const sticker = toMoney(price.price);
  const oldPrice = toMoney(price.old_price);
  const marketing = toMoney(price.marketing_seller_price);

  if (marketing > 0) {
    return {
      currentPrice: marketing,
      discountPercent: 0,
      regularPrice: sticker > marketing ? sticker : null,
    };
  }
  if (sticker > 0 && oldPrice > sticker) {
    return {
      currentPrice: sticker,
      discountPercent: (oldPrice - sticker) / oldPrice,
      regularPrice: null,
    };
  }
  return { currentPrice: sticker, discountPercent: 0, regularPrice: null };
}

/** Pick the public marketplace SKU from Ozon's `sources` array.
 * Preference: FBO → FBS → first non-zero. Returns null when none present. */
export function pickPublicSku(info: OzonProductInfo): number | null {
  const sources = info.sources ?? [];
  const valid = sources.filter((s) => typeof s.sku === "number" && s.sku > 0);
  if (valid.length === 0) return null;
  const fbo = valid.find((s) => s.source === "fbo");
  if (fbo?.sku) return fbo.sku;
  const fbs = valid.find((s) => s.source === "fbs");
  if (fbs?.sku) return fbs.sku;
  return valid[0].sku ?? null;
}

export interface MappedCatalogEntry {
  articleId: string;
  ozonProductId: number;
  patch: CatalogPatch;
  /** Verbatim per-SKU pricing block from Ozon, or null if not provided. */
  ozonCommissions: OzonCommissions | null;
  /** Cost price from Ozon LK (`price.net_price`). null when seller hasn't
   * filled it in — caller should keep local value in that case. */
  costPrice: number | null;
  /** Public SKU for marketplace URL. null when API didn't return any sources. */
  ozonSku: number | null;
}

export function mapCatalogEntry(
  info: OzonProductInfo,
  price: OzonPriceItem | undefined,
  categories: CategoryLookup,
): MappedCatalogEntry {
  const cat = categories.resolve(info.description_category_id, info.type_id);
  const { currentPrice, discountPercent, regularPrice } = price
    ? computeCurrentPriceAndDiscount(price.price)
    : { currentPrice: 0, discountPercent: 0, regularPrice: null };
  const netPrice = price ? toMoney(price.price.net_price) : 0;

  return {
    articleId: info.offer_id,
    ozonProductId: info.id,
    patch: {
      productName: info.name,
      category: cat?.categoryName ?? "",
      productType: cat?.typeName ?? "",
      volumeL: computeVolumeL(info),
      vatRate: parseOzonVat(info.vat),
      isKgt: !!info.is_kgt,
      currentPrice,
      discountPercent,
      ozonProductId: info.id,
      regularPrice,
    },
    ozonCommissions: price?.commissions ?? null,
    costPrice: netPrice > 0 ? netPrice : null,
    ozonSku: pickPublicSku(info),
  };
}
