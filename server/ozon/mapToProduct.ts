import type { CategoryLookup } from "./catalog";
import type {
  OzonPriceItem,
  OzonProductAttributesItem,
  OzonProductInfo,
} from "./types";
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
  | "depthMm"
  | "widthMm"
  | "heightMm"
  | "weightG"
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
  dispatchCluster: "Москва, МО и Дальние регионы",
  destinationCluster: "Москва, МО и Дальние регионы",
  marketingPercent: 0,
  realFbsDeliveryCost: 0,
  realFbsReturnCost: 0,
  acceptanceTariff: "Доверительная приемка",
  costPrice: 0,
  extraExpensesPerUnit: 0,
  whitePurchase: null,
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

/** Compute volume in litres from any object with depth/width/height fields. */
export function computeVolumeLFromDims(d: {
  depth?: number;
  width?: number;
  height?: number;
  dimension_unit?: "mm" | "cm" | "in";
}): number {
  const { depth, width, height } = d;
  const unit = d.dimension_unit ?? "mm";
  if (!depth || !width || !height) return 0;
  const factor = UNIT_TO_CM[unit] ?? 0.1;
  const cmVolume =
    Number(depth) * factor * Number(width) * factor * Number(height) * factor;
  if (!Number.isFinite(cmVolume) || cmVolume <= 0) return 0;
  return cmVolume / 1000;
}

/** Compute volume in litres из `OzonProductInfo` (на случай если у новых
 * версий API габариты придут прямо в info/list). Поддерживает оба формата:
 * top-level и вложенный `dimensions`. */
export function computeVolumeL(info: OzonProductInfo): number {
  return computeVolumeLFromDims({
    depth: info.depth ?? info.dimensions?.depth,
    width: info.width ?? info.dimensions?.width,
    height: info.height ?? info.dimensions?.height,
    dimension_unit:
      info.dimension_unit ?? info.dimensions?.dimension_unit ?? "mm",
  });
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

export interface OzonStatus {
  /** Card is in archive (will not show up on the marketplace). */
  archived: boolean;
  /** Visibility flag — `true` when Ozon considers the card on sale right now. */
  visible: boolean;
  /** Short machine-friendly state name (e.g. "processed", "moderating"). */
  statusName: string | null;
  /** Free-text description. Aggregated from `state_description`,
   * `state_failed_moderation_reasons[0]`, `visibility_details.reason`, etc. */
  statusDescription: string | null;
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
  /** Card lifecycle/visibility status from `/v3/product/info/list`. */
  status: OzonStatus;
}

/** Pull a card-status snapshot from `OzonProductInfo`. Tolerant to missing
 * fields — different API versions populate different subsets. */
export function extractStatus(info: OzonProductInfo): OzonStatus {
  const archived = !!(info.archived ?? info.is_archived);
  const vd = info.visibility_details ?? {};
  // "Visible" = published AND in stock — matches the buyer-facing state on
  // the marketplace ("Этот товар закончился" → visible: false even when the
  // card itself is still active in seller LK).
  const onSale = vd.active_product ?? !archived;
  const inStock = vd.has_stock !== false; // undefined treated as "in stock"
  const visible = onSale && inStock;
  const statusName =
    info.status?.state_name?.trim() ||
    info.status?.state?.trim() ||
    null;
  const reasons: string[] = [];
  const sd = info.status?.state_description?.trim();
  if (sd) reasons.push(sd);
  const fail = info.status?.state_failed?.trim();
  if (fail) reasons.push(fail);
  const fmr = info.status?.state_failed_moderation_reasons ?? [];
  for (const r of fmr) if (r) reasons.push(r);
  const ie = info.status?.item_errors ?? [];
  for (const e of ie) if (e?.message) reasons.push(e.message);
  if (vd.reason) reasons.push(vd.reason);
  if (!visible && !archived) {
    if (vd.has_price === false) reasons.push("Нет цены");
    if (vd.has_stock === false) reasons.push("Нет в наличии");
  }
  return {
    archived,
    visible,
    statusName,
    statusDescription: reasons.length ? reasons.join("; ") : null,
  };
}

export function mapCatalogEntry(
  info: OzonProductInfo,
  price: OzonPriceItem | undefined,
  attrs: OzonProductAttributesItem | undefined,
  categories: CategoryLookup,
): MappedCatalogEntry {
  const cat = categories.resolve(info.description_category_id, info.type_id);
  const { currentPrice, discountPercent, regularPrice } = price
    ? computeCurrentPriceAndDiscount(price.price)
    : { currentPrice: 0, discountPercent: 0, regularPrice: null };
  const netPrice = price ? toMoney(price.price.net_price) : 0;

  // Объём: 3-уровневый fallback от лучшего к худшему:
  // 1) /v4/product/info/attributes — точные depth/width/height;
  // 2) /v3/product/info/list — если в этой версии API габариты есть;
  // 3) /v5/product/info/prices.volume_weight × 5 — расчёт из объёмного веса.
  // Параллельно сохраняем сами габариты в отдельные поля для UI и пересчёта.
  const dimsSrc =
    attrs && (attrs.depth || attrs.width || attrs.height)
      ? {
          depth: attrs.depth,
          width: attrs.width,
          height: attrs.height,
          unit: attrs.dimension_unit ?? "mm",
          weight: attrs.weight,
          weightUnit: attrs.weight_unit ?? "g",
        }
      : info.depth || info.width || info.height
        ? {
            depth: info.depth ?? info.dimensions?.depth,
            width: info.width ?? info.dimensions?.width,
            height: info.height ?? info.dimensions?.height,
            unit: info.dimension_unit ?? info.dimensions?.dimension_unit ?? "mm",
            weight: info.weight,
            weightUnit: info.weight_unit ?? "g",
          }
        : null;

  // Конвертация габаритов в мм (для хранения).
  const toMm = (v: number | undefined, unit: string): number | null => {
    if (v == null || !Number.isFinite(Number(v))) return null;
    const mult = unit === "cm" ? 10 : unit === "in" ? 25.4 : 1;
    return Number(v) * mult;
  };
  const toG = (v: number | undefined, unit: string): number | null => {
    if (v == null || !Number.isFinite(Number(v))) return null;
    const mult = unit === "kg" ? 1000 : unit === "lb" ? 453.592 : 1;
    return Number(v) * mult;
  };

  const depthMm = dimsSrc ? toMm(dimsSrc.depth, dimsSrc.unit) : null;
  const widthMm = dimsSrc ? toMm(dimsSrc.width, dimsSrc.unit) : null;
  const heightMm = dimsSrc ? toMm(dimsSrc.height, dimsSrc.unit) : null;
  const weightG = dimsSrc ? toG(dimsSrc.weight, dimsSrc.weightUnit) : null;

  let volumeL = computeVolumeLFromDims({
    depth: depthMm ?? undefined,
    width: widthMm ?? undefined,
    height: heightMm ?? undefined,
    dimension_unit: "mm",
  });
  if (volumeL <= 0) volumeL = computeVolumeL(info);
  if (volumeL <= 0 && price?.volume_weight) {
    const vw = Number(price.volume_weight);
    if (Number.isFinite(vw) && vw > 0) volumeL = vw * 5;
  }

  return {
    articleId: info.offer_id,
    ozonProductId: info.id,
    patch: {
      productName: info.name,
      category: cat?.categoryName ?? "",
      productType: cat?.typeName ?? "",
      volumeL,
      depthMm,
      widthMm,
      heightMm,
      weightG,
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
    status: extractStatus(info),
  };
}
