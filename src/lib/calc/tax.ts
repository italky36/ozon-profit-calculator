import type { TaxSettings, VatRate, IncomingVatRate } from "../../types";

export const ndflOsnoIp = (
  promoPrice: number,
  expensesNdfl: number,
  annualIncome: number,
): number => {
  if (annualIncome <= 0 || promoPrice <= 0 || promoPrice - expensesNdfl <= 0) return 0;
  const scaledIncome = (annualIncome * (promoPrice - expensesNdfl)) / promoPrice;

  const brackets: Array<[number, number]> = [
    [2_400_000, 0.13],
    [5_000_000, 0.15],
    [20_000_000, 0.18],
    [50_000_000, 0.20],
    [Infinity, 0.22],
  ];

  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of brackets) {
    if (scaledIncome <= prev) break;
    const slice = Math.min(scaledIncome, limit) - prev;
    tax += slice * rate;
    prev = limit;
  }
  const effRate = tax / scaledIncome;
  return (promoPrice - expensesNdfl) * effRate;
};

export interface TotalTaxArgs {
  promoPrice: number;
  ozonShare: number;
  costShare: number;
  extraShare: number;
  ndfl: number;
  vatPayable: number;
  vatRate: VatRate;
  whitePurchase: boolean;
  incomingVatPurchase: boolean;
  incomingVatRate: IncomingVatRate;
  taxSettings: TaxSettings;
}

export const totalTaxOf = ({
  promoPrice,
  ozonShare,
  costShare,
  extraShare,
  ndfl,
  vatPayable,
  vatRate,
  whitePurchase,
  incomingVatPurchase,
  incomingVatRate,
  taxSettings,
}: TotalTaxArgs): number => {
  const sys = taxSettings.taxSystem;
  switch (sys) {
    case "УСН Доходы":
      return Math.max(0, promoPrice * taxSettings.usnIncomeRate + vatPayable);
    case "УСН Доходы минус расходы": {
      const inclCost = whitePurchase ? costShare : 0;
      const base = promoPrice - promoPrice * (ozonShare + inclCost + extraShare);
      return Math.max(0, base * taxSettings.usnIncomeMinusRate + vatPayable);
    }
    case "АУСН Доходы":
      return Math.max(0, promoPrice * taxSettings.ausnIncomeRate);
    case "АУСН Доходы минус расходы": {
      const inclCost = whitePurchase ? costShare : 0;
      const base = promoPrice - promoPrice * (ozonShare + inclCost + extraShare);
      return Math.max(0, base * taxSettings.ausnIncomeMinusRate);
    }
    case "ОСНО ИП":
      return Math.max(0, ndfl + vatPayable);
    case "ОСНО ООО": {
      const divisor = vatRate === 0.22 ? 1.22 : vatRate === 0.10 ? 1.10 : 1;
      const incVatDivisor = whitePurchase && incomingVatPurchase ? 1 + incomingVatRate : 1;
      const inclCost = whitePurchase
        ? incomingVatPurchase
          ? costShare / incVatDivisor
          : costShare
        : 0;
      const base =
        promoPrice / divisor -
        ((promoPrice * ozonShare) / 1.22 +
          (promoPrice * extraShare) / 1.22 +
          promoPrice * inclCost);
      return Math.max(0, base * taxSettings.osnoOooRate + vatPayable);
    }
    case "НПД":
      return promoPrice * taxSettings.npdRate;
  }
};
