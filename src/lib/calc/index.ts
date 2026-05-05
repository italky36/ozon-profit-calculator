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
import { calcLogistics, lastMileOf } from "./logistics";
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
  let usedOzonCommissions = false;

  if (perSku.ozonCommissions) {
    const oc = perSku.ozonCommissions;
    cFboRub = promoPrice * ozonPercentOf(oc.sales_percent_fbo);
    cFbsRub = promoPrice * ozonPercentOf(oc.sales_percent_fbs);
    // Ozon doesn't return a separate realFBS commission — realFBS uses FBS rate.
    cRealFbsRub = cFbsRub;
    logisticsFbo = oc.fbo_direct_flow_trans_max_amount ?? 0;
    logisticsFbs = oc.fbs_direct_flow_trans_max_amount ?? 0;
    // FBS direct-flow is a clean proxy for "base delivery" used in return-services
    // formulas; FBO additionally bundles its own markup.
    baseDelivery = logisticsFbs;
    lastMileFbo = oc.fbo_deliv_to_customer_amount ?? 0;
    lastMileFbs = oc.fbs_deliv_to_customer_amount ?? 0;
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

  // acquiring & marketing
  const acquiringRub = promoPrice * 0.015;
  const marketingRub = promoPrice * input.marketingPercent;

  // ozon return services — proxy "base delivery" with FBS direct-flow value
  const ozonReturnServices = ((baseDelivery + 15) * returnPercentInt) / 100;
  const ozonReturnServicesFbo = ozonReturnServices;
  const ozonReturnServicesFbs = ozonReturnServices;

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
      ACCEPTANCE_FBS_FEE +
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

  // vat
  const vatOut = vatOutOf(promoPrice, taxSettings.taxSystem, input.vatRate);

  const vatInFbo = vatInOf(
    promoPrice,
    ozonShareFbo,
    costShare,
    taxSettings.taxSystem,
    input.vatRate,
    input.whitePurchase,
    input.incomingVatPurchase,
    input.incomingVatRate,
  );
  const vatInFbs = vatInOf(
    promoPrice,
    ozonShareFbs,
    costShare,
    taxSettings.taxSystem,
    input.vatRate,
    input.whitePurchase,
    input.incomingVatPurchase,
    input.incomingVatRate,
  );
  const vatInRealFbs = vatInOf(
    promoPrice,
    ozonShareRealFbs,
    costShare,
    taxSettings.taxSystem,
    input.vatRate,
    input.whitePurchase,
    input.incomingVatPurchase,
    input.incomingVatRate,
  );

  const vatPayableFbo = vatPayableOf(vatOut, vatInFbo, taxSettings.taxSystem, input.vatRate);
  const vatPayableFbs = vatPayableOf(vatOut, vatInFbs, taxSettings.taxSystem, input.vatRate);
  const vatPayableRealFbs = vatPayableOf(vatOut, vatInRealFbs, taxSettings.taxSystem, input.vatRate);

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
    vatRate: input.vatRate,
    whitePurchase: input.whitePurchase,
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
    vatRate: input.vatRate,
    whitePurchase: input.whitePurchase,
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
    vatRate: input.vatRate,
    whitePurchase: input.whitePurchase,
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
    ACCEPTANCE_FBS_FEE +
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
    vatPayable: number,
    totalTax: number,
    totalExpenses: number,
  ): SchemaResult => {
    const marginRub = promoPrice - totalExpenses;
    const marginPercent = promoPrice > 0 ? marginRub / promoPrice : 0;
    const profitability = input.costPrice > 0 ? marginRub / input.costPrice : 0;
    return {
      commissionRub,
      acquiringRub,
      marketingRub,
      logisticsRub,
      lastMileRub,
      storageRub,
      acceptanceRub,
      damageRub,
      vatPayable,
      totalTax,
      totalExpenses,
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
    vatPayableFbo,
    taxFbo,
    expensesFbo,
  );
  const fbs = buildResult(
    cFbsRub,
    logisticsFbs,
    lastMileFbs,
    0,
    ACCEPTANCE_FBS_FEE,
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
