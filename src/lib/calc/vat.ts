import type { TaxSystem, VatRate, IncomingVatRate } from "../../types";

const isUsn = (sys: TaxSystem) => sys.startsWith("УСН");
const isOsno = (sys: TaxSystem) => sys === "ОСНО ИП" || sys === "ОСНО ООО";

export const vatOutOf = (
  promoPrice: number,
  taxSystem: TaxSystem,
  vatRate: VatRate,
): number => {
  if (vatRate === "Не облагается") return 0;
  if (isUsn(taxSystem) && (vatRate === 0.05 || vatRate === 0.07 || vatRate === 0.10 || vatRate === 0.22)) {
    return (promoPrice * vatRate) / (1 + vatRate);
  }
  if (isOsno(taxSystem) && (vatRate === 0.10 || vatRate === 0.22)) {
    return (promoPrice * vatRate) / (1 + vatRate);
  }
  return 0;
};

const incomingVatApplies = (
  taxSystem: TaxSystem,
  vatRate: VatRate,
): boolean => {
  if (isOsno(taxSystem)) return true;
  if (isUsn(taxSystem)) {
    if (vatRate === "Не облагается") return false; // 0 == "Не облагается" в смысле УСН: входящий не учитывается
    if (vatRate === 0.10 || vatRate === 0.22) return true;
    return false;
  }
  return false;
};

export const vatInOf = (
  promoPrice: number,
  ozonShareSchema: number,
  costShare: number,
  taxSystem: TaxSystem,
  vatRate: VatRate,
  whitePurchase: boolean,
  incomingVatPurchase: boolean,
  incomingVatRate: IncomingVatRate,
): number => {
  if (!incomingVatApplies(taxSystem, vatRate)) return 0;
  const inclCost = whitePurchase && incomingVatPurchase ? costShare : 0;
  const base = ozonShareSchema + inclCost;
  if (incomingVatRate === 0.05 || incomingVatRate === 0.07 || incomingVatRate === 0.10 || incomingVatRate === 0.22) {
    return (promoPrice * base * incomingVatRate) / (1 + incomingVatRate);
  }
  return 0;
};

export const vatPayableOf = (
  vatOut: number,
  vatIn: number,
  taxSystem: TaxSystem,
  vatRate: VatRate,
): number => {
  if (isOsno(taxSystem)) {
    return vatRate === 0.10 || vatRate === 0.22 ? vatOut - vatIn : 0;
  }
  if (isUsn(taxSystem)) {
    if (vatRate === 0.05 || vatRate === 0.07 || vatRate === "Не облагается") return vatOut;
    return vatOut - vatIn;
  }
  return 0;
};
