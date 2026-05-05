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
  dimensions?: OzonDimensions;
  is_kgt?: boolean;
  is_super_economy?: boolean;
  /** Per-scheme SKUs (FBO/FBS). Public marketplace URL uses one of these,
   * not `id` (which is the seller's internal product_id). */
  sources?: OzonProductSource[];
}

export interface OzonProductInfoListResp {
  items: OzonProductInfo[];
}

export interface OzonPriceItem {
  product_id: number;
  offer_id: string;
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
