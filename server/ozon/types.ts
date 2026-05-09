// Subset of Ozon Seller API response shapes we actually consume.
// See https://docs.ozon.ru/api/seller/

export interface OzonProductListResp {
  result: {
    items: Array<{ product_id: number; offer_id: string }>;
    total: number;
    last_id: string;
  };
}

export interface OzonDimensions {
  depth: number;
  height: number;
  width: number;
  dimension_unit: "mm" | "cm" | "in";
}

export interface OzonProductSource {
  /** Public SKU used in marketplace URLs (`https://www.ozon.ru/product/{sku}/`). */
  sku?: number;
  /** "fbo" | "fbs" | "rfbs" — which scheme this SKU belongs to. */
  source?: string;
  shipment_type?: string;
  /** Some Ozon API versions tag the discounted/main SKU explicitly. */
  is_enabled?: boolean;
  quant_code?: string;
}

export interface OzonProductInfo {
  id: number;
  offer_id: string;
  name: string;
  description_category_id: number;
  type_id: number;
  vat: string | number; // "0", "0.05", "0.07", "0.1", "0.22" — sometimes returned as a number
  weight: number;
  weight_unit: "kg" | "g" | "lb";
  /** В реальном `/v3/product/info/list` габариты приходят на верхнем
   * уровне item-а, не вложенно. Старые версии API клали их внутрь
   * `dimensions` — поддерживаем оба формата. */
  depth?: number;
  width?: number;
  height?: number;
  dimension_unit?: "mm" | "cm" | "in";
  dimensions?: OzonDimensions;
  is_kgt?: boolean;
  is_super_economy?: boolean;
  /** Per-scheme SKUs (FBO/FBS). Public marketplace URL uses one of these,
   * not `id` (which is the seller's internal product_id). */
  sources?: OzonProductSource[];
  /** True when the product is archived in seller LK. Snake-case mirrors the
   * API; some response versions use `archived`. */
  archived?: boolean;
  is_archived?: boolean;
  /** Visibility flags structured by Ozon: `active_product` is the headline
   * "is the card on sale right now", `has_price` / `has_stock` explain why
   * `active_product` is false when it is. */
  visibility_details?: {
    active_product?: boolean;
    has_price?: boolean;
    has_stock?: boolean;
    /** Sometimes Ozon returns a free-text reason here. */
    reason?: string;
  };
  /** Lifecycle/moderation status. Field shape varies between API versions. */
  status?: {
    state?: string;
    state_name?: string;
    state_description?: string;
    state_failed?: string;
    moderate_status?: string;
    validation_state?: string;
    item_errors?: Array<{ code?: string; message?: string }>;
    state_failed_moderation_reasons?: string[];
  };
}

export interface OzonProductInfoListResp {
  items: OzonProductInfo[];
}

/** Item ответа `/v4/product/info/attributes`. Содержит точные габариты
 * (depth/width/height/dimension_unit) на верхнем уровне — это самый
 * надёжный источник объёма. */
export interface OzonProductAttributesItem {
  id: number;
  offer_id: string;
  type_id?: number;
  description_category_id?: number;
  name?: string;
  sku?: number;
  height?: number;
  depth?: number;
  width?: number;
  dimension_unit?: "mm" | "cm" | "in";
  weight?: number;
  weight_unit?: "kg" | "g" | "lb";
  attributes?: Array<{
    id: number;
    complex_id: number;
    values: Array<{ value: string; dictionary_value_id?: number }>;
  }>;
}

export interface OzonProductAttributesResp {
  result: OzonProductAttributesItem[];
  total: number;
  last_id?: string;
}

export interface OzonPriceItem {
  product_id: number;
  offer_id: string;
  /** Объёмный вес в кг = (L × W × H в см) / 5000. Удобный источник
   * объёма, когда габариты не приходят отдельно: `volume_L = volume_weight × 5`. */
  volume_weight?: number;
  price: {
    // Ozon /v5 sometimes returns these as numbers, sometimes as decimal strings ("1234.56").
    price: string | number;
    old_price: string | number;
    currency_code: string;
    marketing_price?: string | number;
    marketing_seller_price?: string | number;
    /** Cost price the seller filled in Ozon LK. 0 (or absent) → not set. */
    net_price?: string | number;
  };
  /**
   * Per-SKU commission/logistics block — present in /v4 and /v5 responses.
   * Field set documented at https://docs.ozon.ru/api/seller/.
   */
  commissions?: import("../../src/types").OzonCommissions;
}

export interface OzonProductPricesResp {
  items: OzonPriceItem[];
  cursor?: string;
  total?: number;
}

export interface OzonCategoryNode {
  description_category_id?: number;
  category_name?: string;
  type_id?: number;
  type_name?: string;
  disabled?: boolean;
  children?: OzonCategoryNode[];
}

export interface OzonCategoryTreeResp {
  result: OzonCategoryNode[];
}

// === Finance ===

export interface OzonFinanceServiceItem {
  name: string;
  price: number;
}

export interface OzonFinanceItemSku {
  name?: string;
  sku?: number;
}

export interface OzonFinanceTransactionItem {
  operation_id: number;
  operation_type: string;
  operation_type_name?: string;
  operation_date: string; // ISO date-time
  operation_type_code?: string;
  posting?: {
    posting_number?: string;
    order_date?: string;
    delivery_charge?: number;
    return_delivery_charge?: number;
  };
  items?: Array<{
    name?: string;
    sku?: number;
    offer_id?: string;
  }>;
  services?: OzonFinanceServiceItem[];
  amount: number;
  type?: string; // "orders" | "returns" | "services" | ...
  accruals_for_sale?: number;
  sale_commission?: number;
  delivery_charge?: number;
  return_delivery_charge?: number;
}

export interface OzonFinanceTransactionListResp {
  result: {
    operations: OzonFinanceTransactionItem[];
    page_count: number;
    row_count: number;
  };
}
