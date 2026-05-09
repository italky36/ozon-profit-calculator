import type {
  OzonCommissions,
  ProductInput,
  TaxSettings,
  References,
  CalcResult,
  SchemaResult,
} from "../../types";
import {
  promoPriceOf,
  returnPercentOf,
  returnPercentIntOf,
} from "./pricing";
import { findCommission, commissionsRub } from "./commission";
import { calcLogistics, findClusterTariff, lastMileOf } from "./logistics";
import {
  findStorage,
  freeStorageDaysOf,
  storageFboOf,
  acceptanceFboFeeOf,
  ACCEPTANCE_FBS_FEE,
} from "./storage";
import { vatOutOf, vatInOf, vatPayableOf } from "./vat";
import { ndflOsnoIp, totalTaxOf } from "./tax";

const CROSS_DOCKING = 0; // TODO: implement cross-docking calculator
const ozonPercentOf = (value: number | null | undefined): number => (value ?? 0) / 100;

export interface PerSkuOverrides {
  ozonCommissions?: OzonCommissions | null;
}

export const calculateRow = (
  input: ProductInput,
  taxSettings: TaxSettings,
  refs: References,
  perSku: PerSkuOverrides = {},
): CalcResult => {
  const promoPrice = promoPriceOf(input.currentPrice, input.discountPercent);
  const returnPercent = returnPercentOf(input.redemptionPercent);
  const returnPercentInt = returnPercentIntOf(input.redemptionPercent);

  // Resolve commission/logistics/last-mile from Ozon per-SKU data when present,
  // otherwise fall back to the table-based lookup. Ozon's `info/prices.commissions`
  // returns the exact charge that will be applied to this SKU; using it removes
  // the category lookup and the volume/local-share logistics formula.
  let cFboRub: number;
  let cFbsRub: number;
  let cRealFbsRub: number;
  let logisticsFbo: number;
  let logisticsFbs: number;
  let baseDelivery: number;
  let lastMileFbo: number;
  let lastMileFbs: number;
  let firstMileFbsRub = ACCEPTANCE_FBS_FEE; // FBS "Обработка отправления"
  let usedOzonCommissions = false;

  if (perSku.ozonCommissions) {
    const oc = perSku.ozonCommissions;
    cFboRub = promoPrice * ozonPercentOf(oc.sales_percent_fbo);
    cFbsRub = promoPrice * ozonPercentOf(oc.sales_percent_fbs);
    // Older API versions only returned `sales_percent_fbs` for both — keep it
    // as a fallback when `sales_percent_rfbs` is absent.
    cRealFbsRub =
      promoPrice *
      ozonPercentOf(oc.sales_percent_rfbs ?? oc.sales_percent_fbs);

    // Pick the min/max bracket of `direct_flow_trans` based on cluster choice:
    // same dispatch+destination cluster ≈ "local" sale → min; otherwise → max.
    const isLocal = input.dispatchCluster === input.destinationCluster;
    const pickBracket = (
      min: number | undefined,
      max: number | undefined,
    ): number => {
      if (isLocal) return min ?? max ?? 0;
      return max ?? min ?? 0;
    };
    logisticsFbo = pickBracket(
      oc.fbo_direct_flow_trans_min_amount,
      oc.fbo_direct_flow_trans_max_amount,
    );
    logisticsFbs = pickBracket(
      oc.fbs_direct_flow_trans_min_amount,
      oc.fbs_direct_flow_trans_max_amount,
    );
    // FBS direct-flow is a clean proxy for "base delivery" used in return-services
    // 'tz' formula; FBO additionally bundles its own markup.
    baseDelivery = logisticsFbs;
    lastMileFbo = oc.fbo_deliv_to_customer_amount ?? 0;
    lastMileFbs = oc.fbs_deliv_to_customer_amount ?? 0;
    // FBS first-mile ("Обработка отправления") — Ozon's per-SKU value when
    // present; otherwise legacy 30 ₽ constant.
    firstMileFbsRub = oc.fbs_first_mile_max_amount ?? ACCEPTANCE_FBS_FEE;
    usedOzonCommissions = true;
  } else {
    const cRow = findCommission(refs.commissions, input.category, input.productType);
    if (!cRow) {
      throw new Error(`Commission not found for ${input.category} / ${input.productType}`);
    }
    const c = commissionsRub(cRow, promoPrice);
    cFboRub = c.fboRub;
    cFbsRub = c.fbsRub;
    cRealFbsRub = c.realFbsRub;
    const log = calcLogistics(
      promoPrice,
      input.volumeL,
      input.logisticsMode,
      input.localShare,
      input.clustersCount,
      refs.logisticsTariffs,
      refs.logisticsSettings,
    );
    logisticsFbo = log.logisticsFbo;
    logisticsFbs = log.logisticsFbs;
    baseDelivery = log.baseDelivery;
    const lm = lastMileOf(promoPrice);
    lastMileFbo = lm;
    lastMileFbs = lm;
  }

  // Override логистики точной матрицей, если включено и данные подходят.
  // Матрица одна на пару → для FBO/FBS подменяем оба значения. last-mile,
  // first-mile и комиссии остаются как были (API/таблица). baseDelivery тоже
  // подменяется, чтобы tz-формула возврата работала с актуальной величиной.
  if (taxSettings.useClusterLogistics) {
    const clusterTariff = findClusterTariff(
      refs.logisticsClusterTariffs,
      input.volumeL,
      input.dispatchCluster,
      input.destinationCluster,
      promoPrice,
    );
    if (clusterTariff != null) {
      logisticsFbo = clusterTariff;
      logisticsFbs = clusterTariff;
      baseDelivery = clusterTariff;
    }
  }

  // acquiring & marketing
  const acquiringRub = promoPrice * 0.015;
  const marketingRub = promoPrice * input.marketingPercent;

  // ozon return services — two formulas controlled by `taxSettings.calcMode`.
  // Default ('tz') keeps the legacy spec formula `(baseDelivery + 15) × return%`.
  // 'ozon' uses Ozon's per-SKU `*_return_flow_amount` × return% — matches the
  // online calculator. The 'ozon' branch only differs in the API path; on the
  // table path there is no API value to substitute, so we always use 'tz'.
  const calcMode = taxSettings.calcMode ?? "tz";
  const useOzonReturn = calcMode === "ozon" && usedOzonCommissions;
  const oc = perSku.ozonCommissions;
  const ozonReturnServicesFbo = useOzonReturn
    ? ((oc?.fbo_return_flow_amount ?? 0) * returnPercentInt) / 100
    : ((baseDelivery + 15) * returnPercentInt) / 100;
  const ozonReturnServicesFbs = useOzonReturn
    ? ((oc?.fbs_return_flow_amount ?? 0) * returnPercentInt) / 100
    : ((baseDelivery + 15) * returnPercentInt) / 100;

  // потери возврата
  const earningFbo = promoPrice - cFboRub - acquiringRub - logisticsFbo - lastMileFbo;
  const returnFbo = -promoPrice - baseDelivery - 15 + cFboRub + acquiringRub;
  const maxLossFbo = ((-returnFbo - earningFbo) * returnPercentInt) / 100;

  const earningFbs = promoPrice - cFbsRub - acquiringRub - logisticsFbs - lastMileFbs;
  const returnFbs = -promoPrice - baseDelivery - 15 + cFbsRub + acquiringRub;
  const maxLossFbs = ((-returnFbs - earningFbs) * returnPercentInt) / 100;

  // realFBS delivery — seller-supplied costs, unchanged by Ozon override
  const deliveryRealFbs = (input.realFbsDeliveryCost * (100 + returnPercentInt)) / 100;
  const returnDeliveryRealFbs = (input.realFbsReturnCost * returnPercentInt) / 100;

  // damage
  const damageRub = promoPrice * taxSettings.damageRate;

  // acceptance
  const acceptanceFboFee = acceptanceFboFeeOf(input.acceptanceTariff, input.volumeL);

  // storage FBO — Ozon API doesn't expose per-SKU storage rates, keep table path
  const sRow = findStorage(refs.storage, input.category, input.productType);
  const freeDays = freeStorageDaysOf(sRow, input.isFireHazard, input.isKgt, input.isKazakhstan);
  const storageFbo = storageFboOf(
    input.plannedStorageDays,
    freeDays,
    input.volumeL,
    input.isFireHazard,
    input.isKgt,
    input.isKazakhstan,
  );

  // delivery cost summary
  const deliveryCostFboRub = logisticsFbo + maxLossFbo + lastMileFbo;
  const deliveryCostFbsRub = logisticsFbs + maxLossFbs + lastMileFbs;
  const deliveryCostRealFbsRub = deliveryRealFbs + returnDeliveryRealFbs + damageRub;

  // ozon shares
  const ozonShareFbo =
    (cFboRub +
      acquiringRub +
      marketingRub +
      logisticsFbo +
      ozonReturnServicesFbo +
      lastMileFbo +
      CROSS_DOCKING +
      storageFbo) /
    promoPrice;

  const ozonShareFbs =
    (cFbsRub +
      acquiringRub +
      marketingRub +
      firstMileFbsRub +
      logisticsFbs +
      ozonReturnServicesFbs +
      lastMileFbs) /
    promoPrice;

  const ozonShareRealFbs =
    (cRealFbsRub +
      acquiringRub +
      marketingRub +
      deliveryRealFbs +
      returnDeliveryRealFbs) /
    promoPrice;

  // shares
  const costShare = promoPrice > 0 ? input.costPrice / promoPrice : 0;
  const extraShare =
    promoPrice > 0
      ? (input.extraExpensesPerUnit + (input.salesPlan > 0 ? taxSettings.partyExtraExpenses / input.salesPlan : 0)) /
        promoPrice
      : 0;

  // vat — on USN we use the global `usnVatRate` (one rate for the whole shop,
  // determined by previous-year revenue). On OSNO the per-product rate stays
  // (mixed-rate categories: 10% books, 20% general, etc.).
  const isUsn =
    taxSettings.taxSystem === "УСН Доходы" ||
    taxSettings.taxSystem === "УСН Доходы минус расходы";
  const effectiveVatRate = isUsn
    ? (taxSettings.usnVatRate ?? "Не облагается")
    : input.vatRate;
  // null в товаре → берём глобальный дефолт. Явный true/false в товаре —
  // пользователь переопределил, не наследуем.
  const effectiveWhitePurchase =
    input.whitePurchase ?? taxSettings.defaultWhitePurchase ?? false;

  const vatOut = vatOutOf(promoPrice, taxSettings.taxSystem, effectiveVatRate);

  const vatInFbo = vatInOf(
    promoPrice,
    ozonShareFbo,
    costShare,
    taxSettings.taxSystem,
    effectiveVatRate,
    effectiveWhitePurchase,
    input.incomingVatPurchase,
    input.incomingVatRate,
  );
  const vatInFbs = vatInOf(
    promoPrice,
    ozonShareFbs,
    costShare,
    taxSettings.taxSystem,
    effectiveVatRate,
    effectiveWhitePurchase,
    input.incomingVatPurchase,
    input.incomingVatRate,
  );
  const vatInRealFbs = vatInOf(
    promoPrice,
    ozonShareRealFbs,
    costShare,
    taxSettings.taxSystem,
    effectiveVatRate,
    effectiveWhitePurchase,
    input.incomingVatPurchase,
    input.incomingVatRate,
  );

  const vatPayableFbo = vatPayableOf(vatOut, vatInFbo, taxSettings.taxSystem, effectiveVatRate);
  const vatPayableFbs = vatPayableOf(vatOut, vatInFbs, taxSettings.taxSystem, effectiveVatRate);
  const vatPayableRealFbs = vatPayableOf(vatOut, vatInRealFbs, taxSettings.taxSystem, effectiveVatRate);

  // ndfl (OSNO IP)
  const partyExtraPerUnit =
    input.salesPlan > 0 ? taxSettings.partyExtraExpenses / input.salesPlan : 0;

  const expensesNdflFbo =
    cFboRub +
    acquiringRub +
    marketingRub +
    CROSS_DOCKING +
    storageFbo +
    deliveryCostFboRub +
    input.costPrice +
    input.extraExpensesPerUnit +
    partyExtraPerUnit;

  const expensesNdflFbs =
    cFbsRub +
    acquiringRub +
    marketingRub +
    deliveryCostFbsRub +
    input.costPrice +
    input.extraExpensesPerUnit +
    partyExtraPerUnit;

  const expensesNdflRealFbs =
    cRealFbsRub +
    acquiringRub +
    marketingRub +
    deliveryCostRealFbsRub +
    input.costPrice +
    input.extraExpensesPerUnit +
    partyExtraPerUnit;

  const ndflFbo = ndflOsnoIp(promoPrice, expensesNdflFbo, taxSettings.osnoIpAnnualIncome);
  const ndflFbs = ndflOsnoIp(promoPrice, expensesNdflFbs, taxSettings.osnoIpAnnualIncome);
  const ndflRealFbs = ndflOsnoIp(promoPrice, expensesNdflRealFbs, taxSettings.osnoIpAnnualIncome);

  // total tax per schema
  const taxFbo = totalTaxOf({
    promoPrice,
    ozonShare: ozonShareFbo,
    costShare,
    extraShare,
    ndfl: ndflFbo,
    vatPayable: vatPayableFbo,
    vatRate: effectiveVatRate,
    whitePurchase: effectiveWhitePurchase,
    incomingVatPurchase: input.incomingVatPurchase,
    incomingVatRate: input.incomingVatRate,
    taxSettings,
  });
  const taxFbs = totalTaxOf({
    promoPrice,
    ozonShare: ozonShareFbs,
    costShare,
    extraShare,
    ndfl: ndflFbs,
    vatPayable: vatPayableFbs,
    vatRate: effectiveVatRate,
    whitePurchase: effectiveWhitePurchase,
    incomingVatPurchase: input.incomingVatPurchase,
    incomingVatRate: input.incomingVatRate,
    taxSettings,
  });
  const taxRealFbs = totalTaxOf({
    promoPrice,
    ozonShare: ozonShareRealFbs,
    costShare,
    extraShare,
    ndfl: ndflRealFbs,
    vatPayable: vatPayableRealFbs,
    vatRate: effectiveVatRate,
    whitePurchase: effectiveWhitePurchase,
    incomingVatPurchase: input.incomingVatPurchase,
    incomingVatRate: input.incomingVatRate,
    taxSettings,
  });

  // expenses & margin
  const expensesFbo =
    cFboRub +
    acquiringRub +
    CROSS_DOCKING +
    storageFbo +
    deliveryCostFboRub +
    input.costPrice +
    acceptanceFboFee +
    input.extraExpensesPerUnit +
    taxFbo +
    partyExtraPerUnit +
    marketingRub;

  const expensesFbs =
    cFbsRub +
    acquiringRub +
    firstMileFbsRub +
    deliveryCostFbsRub +
    input.costPrice +
    input.extraExpensesPerUnit +
    taxFbs +
    partyExtraPerUnit +
    marketingRub;

  const expensesRealFbs =
    cRealFbsRub +
    acquiringRub +
    deliveryCostRealFbsRub +
    input.costPrice +
    input.extraExpensesPerUnit +
    taxRealFbs +
    partyExtraPerUnit +
    marketingRub;

  const buildResult = (
    commissionRub: number,
    logisticsRub: number,
    lastMileRub: number,
    storageRub: number,
    acceptanceRub: number,
    ozonReturnServicesRub: number,
    vatPayable: number,
    totalTax: number,
    totalExpenses: number,
  ): SchemaResult => {
    const marginRub = promoPrice - totalExpenses;
    const marginPercent = promoPrice > 0 ? marginRub / promoPrice : 0;
    const profitability = input.costPrice > 0 ? marginRub / input.costPrice : 0;
    // Mirror Ozon online calculator's "К начислению за товар": price minus
    // every Ozon-side fee, BEFORE taxes/cost/marketing. Marketing is treated
    // as a seller's spend (not an Ozon deduction) — same as in the online calc
    // toggle "Доля выкупа, налог, себестоимость и прочее".
    const ozonNetPayout =
      promoPrice -
      (commissionRub +
        acquiringRub +
        logisticsRub +
        lastMileRub +
        storageRub +
        acceptanceRub +
        ozonReturnServicesRub);
    return {
      commissionRub,
      acquiringRub,
      marketingRub,
      logisticsRub,
      lastMileRub,
      storageRub,
      acceptanceRub,
      damageRub,
      ozonReturnServicesRub,
      vatPayable,
      totalTax,
      totalExpenses,
      ozonNetPayout,
      marginRub,
      marginPercent,
      profitability,
      totalProfit: marginRub * input.salesPlan,
    };
  };

  const fbo = buildResult(
    cFboRub,
    logisticsFbo,
    lastMileFbo,
    storageFbo,
    acceptanceFboFee,
    ozonReturnServicesFbo,
    vatPayableFbo,
    taxFbo,
    expensesFbo,
  );
  const fbs = buildResult(
    cFbsRub,
    logisticsFbs,
    lastMileFbs,
    0,
    firstMileFbsRub,
    ozonReturnServicesFbs,
    vatPayableFbs,
    taxFbs,
    expensesFbs,
  );
  const realFbs = buildResult(
    cRealFbsRub,
    deliveryRealFbs + returnDeliveryRealFbs,
    0,
    0,
    0,
    0,
    vatPayableRealFbs,
    taxRealFbs,
    expensesRealFbs,
  );

  return { fbo, fbs, realFbs, promoPrice, returnPercent, usedOzonCommissions };
};

export * from "./pricing";
export * from "./commission";
export * from "./logistics";
export * from "./storage";
export * from "./vat";
export * from "./tax";
