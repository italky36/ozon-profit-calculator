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

/**
 * Mode for the per-SKU API calculation branch:
 *   - "ozon" — match the official Ozon online calculator: use
 *     `*_return_flow_amount` for return cost (no `+15` constant).
 *   - "tz" — keep legacy formulas from the original tech spec
 *     (`(baseDelivery + 15) × returnPercentInt / 100` for return).
 * Affects only items that have `ozonCommissions` (API path); the table-based
 * path is independent of this setting.
 */
export type CalcMode = "ozon" | "tz";

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
  /** Optional in stored data for backwards-compatibility — defaults to "tz". */
  calcMode?: CalcMode;
  /** Default for `ProductInput.whitePurchase` when товар не выставил явно
   * (whitePurchase = null). false по умолчанию. */
  defaultWhitePurchase?: boolean;
  /** VAT rate that applies to the seller on USN. Determined by previous-year
   * revenue (since 2025): <60M → "Не облагается", 60-250M → 5%, 250-450M → 7%,
   * >450M → 22%. Used in place of per-product `vatRate` whenever `taxSystem`
   * is "УСН Доходы" or "УСН Доходы минус расходы". On OSNO this field is
   * ignored and the per-product `vatRate` applies (mixed-rate categories). */
  usnVatRate?: VatRate;
  /** Использовать точную per-cluster-pair матрицу логистики из загруженной
   * Excel-таблицы Ozon (`ref_logistics_cluster_tariffs`) вместо API min/max
   * или базового табличного лукапа. По умолчанию false. */
  useClusterLogistics?: boolean;
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

export interface LogisticsClusterTariffRow {
  /** Нижняя граница диапазона объёма (литры). Применяем к товарам с
   * `volumeL >= volumeFrom`, выбирая максимальный подходящий. */
  volumeFrom: number;
  fromCluster: string;
  toCluster: string;
  /** Тариф для товаров с ценой < 300 ₽. */
  tariffLte300: number;
  /** Тариф для товаров с ценой ≥ 300 ₽. */
  tariffGt300: number;
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
  /** Габариты упаковки в мм. Заполняются Ozon-импортом или вручную; при
   * заполнении используются для пересчёта `volumeL`. null = не задано. */
  depthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  /** Вес упаковки в граммах. null = не задано. */
  weightG: number | null;
  vatRate: VatRate;
  redemptionPercent: number;
  salesPlan: number;
  logisticsMode: LogisticsMode;
  localShare: number;
  clustersCount: ClustersCount;
  /** Ozon dispatch cluster (warehouse origin). Used in the API path to pick
   * the min/max logistics bracket: same cluster = local = min, different = max. */
  dispatchCluster: string;
  /** Ozon destination cluster (buyer region). */
  destinationCluster: string;
  currentPrice: number;
  discountPercent: number;
  marketingPercent: number;
  realFbsDeliveryCost: number;
  realFbsReturnCost: number;
  acceptanceTariff: AcceptanceTariff;
  costPrice: number;
  extraExpensesPerUnit: number;
  /** true = белая закупка (с документами), false = серая, null = брать из
   * глобальной настройки `taxSettings.defaultWhitePurchase`. */
  whitePurchase: boolean | null;
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
  /** realFBS commission. Older versions of the project substituted
   * `sales_percent_fbs` here — use this field when present. */
  sales_percent_rfbs?: number;
  /** Fulfilled-by-Partner commission. Stored for completeness; the calculator
   * does not currently model the FBP scheme. */
  sales_percent_fbp?: number;

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
  /** Card archive flag from Ozon. null when product wasn't imported. */
  ozonArchived?: boolean | null;
  /** Whether Ozon currently shows the card on sale. */
  ozonVisible?: boolean | null;
  /** Short machine state name from Ozon (e.g. "processed"). */
  ozonStatusName?: string | null;
  /** Free-text reason for inactivity (failed moderation, no price, etc.). */
  ozonStatusDescription?: string | null;
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
  /** Ozon return-services cost (separately from the headline "Логистика"). */
  ozonReturnServicesRub: number;
  vatPayable: number;
  totalTax: number;
  totalExpenses: number;
  /** Mirror of the Ozon online calculator's "К начислению за товар": price
   * minus all Ozon-side fees, before taxes / cost of goods / marketing. */
  ozonNetPayout: number;
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
  /** Точные тарифы per-cluster-pair, опциональные. Заполняются загрузкой
   * `Тарифы_с_6_апреля`-листа из Excel-эталона Ozon. */
  logisticsClusterTariffs?: LogisticsClusterTariffRow[];
}
