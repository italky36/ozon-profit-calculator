export type FinanceType =
  | "sale"
  | "refund"
  | "commission"
  | "logistics"
  | "last_mile"
  | "storage"
  | "other";

/**
 * Classify an Ozon `operation_type` into our coarse buckets used by the
 * realized-margin analytics. The set of operation_type values is large and
 * Ozon adds new ones — we use explicit overrides for the most common, then
 * fall back to keyword matching, then "other".
 *
 * Rules are intentionally conservative: anything that looks ambiguous
 * (corrections, marketing, premium subscriptions) goes into "other" rather
 * than getting bucketed into commission/logistics where it would skew the
 * predicted-vs-actual comparison.
 */
const EXPLICIT: Record<string, FinanceType> = {
  // Sales
  OperationAgentDeliveredToCustomer: "sale",
  OperationItemAgentDeliveredToCustomer: "sale",
  ClientReturnAgentOperation: "refund",

  // Returns
  OperationReturnGoodsFBSofRMS: "refund",
  OperationItemReturn: "refund",
  ItemReturn: "refund",
  ReturnGoodsFBSofRMSWithdraw: "refund",

  // Last-mile (to / from end customer)
  MarketplaceServiceItemDelivToCustomer: "last_mile",
  MarketplaceServiceItemReturnFlowTrans: "last_mile",
  MarketplaceServiceItemReturnAfterDelivToCustomer: "last_mile",
  MarketplaceServiceItemReturnNotDelivToCustomer: "last_mile",
  MarketplaceServiceItemReturnPartGoodsCustomer: "last_mile",

  // Logistics (between warehouses, dropoff, fulfillment processing)
  MarketplaceServiceItemDirectFlowTrans: "logistics",
  MarketplaceServiceItemFulfillment: "logistics",
  MarketplaceServiceItemPickup: "logistics",
  MarketplaceServiceItemDropoffPVZ: "logistics",
  MarketplaceServiceItemDropoffSC: "logistics",
  MarketplaceServiceItemDropoffFF: "logistics",
  OperationItemPick: "logistics",
  MarketplaceServiceItemDirectFlowLogistic: "logistics",
  MarketplaceServiceItemReturnFlowLogistic: "logistics",

  // Storage
  OperationMarketplaceServiceStorage: "storage",
  MarketplaceServiceItemFulfillmentStorage: "storage",
  ItemAdvertisementForSupplierLogisticSeller: "storage",

  // Commission (acquiring, sales-commission charged separately)
  MarketplaceRedistributionOfAcquiringOperation: "commission",
  OperationMarketplaceServicePremiumCashbackIndividualPoints: "commission",
};

const KEYWORD_RULES: Array<[RegExp, FinanceType]> = [
  [/return/i, "refund"],
  [/storage/i, "storage"],
  [/(deliv.*customer|lastmile|last[\s_]?mile)/i, "last_mile"],
  [/(fulfillment|directflow|pickup|dropoff|pick\b)/i, "logistics"],
  [/(commission|acquiring)/i, "commission"],
  [/(agentdelivered|sale\b|sold)/i, "sale"],
];

export function classifyOperationType(operationType: string): FinanceType {
  if (!operationType) return "other";
  const explicit = EXPLICIT[operationType];
  if (explicit) return explicit;
  for (const [re, type] of KEYWORD_RULES) {
    if (re.test(operationType)) return type;
  }
  return "other";
}
