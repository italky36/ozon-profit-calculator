/** Рентабельность по фактическим поступлениям из Ozon, не по прогнозу.
 *
 *  actualRevenue — сумма sale-операций (gross, до удержаний Ozon).
 *  actualMargin  — sum(amount) по всем finance_transactions: уже включает
 *                  выручку минус комиссию / логистику / last_mile / хранение
 *                  / возвраты / прочее (то что Ozon реально удержал).
 *                  Это net-выручка ДО учёта себестоимости и налогов продавца.
 *
 *  В коде калькулятора FBO/FBS/realFBS рентабельность считается как
 *  marginRub / costPrice (после налога и costPrice). Здесь — то же самое,
 *  но с фактическими данными. Налог считается упрощённо: для УСН/НПД
 *  по доходу или прибыли, для ОСНО без полной механики НДС (которую
 *  применить к агрегату из finance_transactions невозможно без
 *  per-операционного НДС-разбора). */
import type { TaxSettings } from "../../types";

export interface ActualEconomics {
  /** Средняя маржа на одну продажу после costPrice + налогов. Знак: + или -. */
  marginPerSale: number;
  /** Налог на одну продажу. */
  taxPerSale: number;
  /** Рентабельность к себестоимости: finalProfit / (costPrice × salesCount).
   *  null когда costPrice = 0 или whitePurchase = false (нет базы для отношения). */
  profitability: number | null;
}

function calculateActualTax(
  revenue: number,
  profitBeforeTax: number,
  taxSettings: TaxSettings,
): number {
  switch (taxSettings.taxSystem) {
    case "УСН Доходы":
      return Math.max(0, revenue * taxSettings.usnIncomeRate);
    case "УСН Доходы минус расходы":
      return Math.max(0, profitBeforeTax * taxSettings.usnIncomeMinusRate);
    case "АУСН Доходы":
      return Math.max(0, revenue * taxSettings.ausnIncomeRate);
    case "АУСН Доходы минус расходы":
      return Math.max(0, profitBeforeTax * taxSettings.ausnIncomeMinusRate);
    case "ОСНО ИП":
      // Упрощение: 13% от прибыли без полной шкалы НДФЛ и без НДС
      // (для фактических данных НДС уже частично растворён в actualMargin).
      return Math.max(0, profitBeforeTax * 0.13);
    case "ОСНО ООО":
      return Math.max(0, profitBeforeTax * taxSettings.osnoOooRate);
    case "НПД":
      return Math.max(0, revenue * taxSettings.npdRate);
  }
}

export function calculateActualEconomics(
  actualRevenue: number,
  actualMargin: number,
  salesCount: number,
  costPrice: number,
  whitePurchase: boolean,
  taxSettings: TaxSettings,
): ActualEconomics | null {
  if (salesCount <= 0) return null;

  // costPrice вычитается только при белой поставке (для серых закупок
  // юзер всё равно её платит, но для бухгалтерии её нет — налог не
  // снижается на её сумму).
  const costPriceTotal = whitePurchase ? costPrice * salesCount : 0;
  const profitBeforeTax = actualMargin - costPriceTotal;
  const tax = calculateActualTax(actualRevenue, profitBeforeTax, taxSettings);
  const finalProfit = profitBeforeTax - tax;
  const marginPerSale = finalProfit / salesCount;

  // Рентабельность к себестоимости имеет смысл только когда costPrice
  // фактически вычитается из прибыли (whitePurchase + cost > 0).
  // Иначе показываем null — UI рендерит «—».
  const profitability =
    whitePurchase && costPrice > 0
      ? finalProfit / costPriceTotal
      : null;

  return {
    marginPerSale,
    taxPerSale: tax / salesCount,
    profitability,
  };
}
