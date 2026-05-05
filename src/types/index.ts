export type TaxSystem =
  | "УСН Доходы"
  | "УСН Доходы минус расходы"
  | "АУСН Доходы"
  | "АУСН Доходы минус расходы"
  | "ОСНО ООО"
  | "ОСНО ИП"
  | "НПД";

export type VatRate = "Не облагается" | 0.05 | 0.07 | 0.10 | 0.22;
export type IncomingVatRate = 0 | 0.05 | 0.07 | 0.10 | 0.22;

export type AcceptanceTariff =
  | "Доверительная приемка"
  | "Поштучная приемка"
  | "Сортировка по зонам размещения"
  | "Корректировка состава";

export type LogisticsMode = "Авто" | "По доле локальных";
export type ClustersCount = number | "Считать без наценки";

export interface TaxSettings {
  damageRate: number;
  taxSystem: TaxSystem;
  usnIncomeRate: number;
  usnIncomeMinusRate: number;
  ausnIncomeRate: number;
  ausnIncomeMinusRate: number;
  osnoOooRate: number;
  osnoIpAnnualIncome: number;
  npdRate: number;
  partyExtraExpenses: number;
}

export interface LogisticsSettings {
  totalDeliveryClusters: number;
  totalSupplyClusters: number;
  markupClusterShare: number;
  typicalMarkupRate: number;
}

export interface CommissionBuckets {
  upTo100?: number;
  upTo300?: number;
  upTo1500: number;
  upTo5000: number;
  upTo10000: number;
  over10000: number;
}

export interface CommissionRow {
  key: string;
  category: string;
  productType: string;
  fbo: Required<CommissionBuckets>;
  fbs: Required<CommissionBuckets>;
  realFbs: CommissionBuckets;
}

export interface StorageRow {
  key: string;
  category: string;
  productType: string;
  freeStorageDays: number;
  freeStorageDaysKgt: number;
  freeStorageDaysKz: number;
}

export interface LogisticsTariffRow {
  volumeFrom: number;
  volumeTo: number;
  localUpTo300: number;
  nonLocalUpTo300: number;
  localOver300: number;
  nonLocalOver300: number;
}

export interface ProductInput {
  articleId: string;
  productName: string;
  category: string;
  productType: string;
  isKgt: boolean;
  isKazakhstan: boolean;
  isFireHazard: boolean;
  plannedStorageDays: number;
  volumeL: number;
  vatRate: VatRate;
  redemptionPercent: number;
  salesPlan: number;
  logisticsMode: LogisticsMode;
  localShare: number;
  clustersCount: ClustersCount;
  currentPrice: number;
  discountPercent: number;
  marketingPercent: number;
  realFbsDeliveryCost: number;
  realFbsReturnCost: number;
  acceptanceTariff: AcceptanceTariff;
  costPrice: number;
  extraExpensesPerUnit: number;
  whitePurchase: boolean;
  incomingVatPurchase: boolean;
  incomingVatRate: IncomingVatRate;
}

/**
 * Per-SKU pricing block returned by Ozon `/v5/product/info/prices` (and v4).
 * Stored on `products.ozon_commissions` for items pulled from the Seller cabinet.
 * When present, the calc engine prefers these numbers over the table-based
 * lookup in `commissions.json` / `logisticsTariffs.json`.
 */
export interface OzonCommissions {
  // Sale commission percentages as returned by Ozon API (e.g. 18 = 18%)
  sales_percent_fbo?: number;
  sales_percent_fbs?: number;

  // FBO logistics
  fbo_fulfillment_amount?: number;
  fbo_direct_flow_trans_min_amount?: number;
  fbo_direct_flow_trans_max_amount?: number;
  fbo_deliv_to_customer_amount?: number;
  fbo_return_flow_amount?: number;
  fbo_return_flow_trans_min_amount?: number;
  fbo_return_flow_trans_max_amount?: number;

  // FBS logistics
  fbs_first_mile_min_amount?: number;
  fbs_first_mile_max_amount?: number;
  fbs_direct_flow_trans_min_amount?: number;
  fbs_direct_flow_trans_max_amount?: number;
  fbs_deliv_to_customer_amount?: number;
  fbs_return_flow_amount?: number;
  fbs_return_flow_trans_min_amount?: number;
  fbs_return_flow_trans_max_amount?: number;
}

export interface ProductRow {
  id: string;
  input: ProductInput;
  ozonProductId?: number | null;
  ozonCommissions?: OzonCommissions | null;
  ozonCommissionsUpdatedAt?: number | null;
  /** Sticker price from Ozon when a marketing promo dropped the actual selling
   * price (`input.currentPrice`) below it. Informational; not used in calc. */
  regularPrice?: number | null;
  /** Public SKU for marketplace URL (different from `ozonProductId`). */
  ozonSku?: number | null;
}

export interface SchemaResult {
  commissionRub: number;
  acquiringRub: number;
  marketingRub: number;
  logisticsRub: number;
  lastMileRub: number;
  storageRub: number;
  acceptanceRub: number;
  damageRub: number;
  vatPayable: number;
  totalTax: number;
  totalExpenses: number;
  marginRub: number;
  marginPercent: number;
  profitability: number;
  totalProfit: number;
}

export interface CalcResult {
  fbo: SchemaResult;
  fbs: SchemaResult;
  realFbs: SchemaResult;
  promoPrice: number;
  returnPercent: number;
  /** True when calc used per-SKU Ozon API commissions/logistics; false on table fallback. */
  usedOzonCommissions: boolean;
}

export interface References {
  commissions: CommissionRow[];
  storage: StorageRow[];
  logisticsTariffs: LogisticsTariffRow[];
  logisticsSettings: LogisticsSettings;
}
