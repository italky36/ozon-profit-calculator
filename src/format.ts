const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  maximumFractionDigits: 1,
});

export const fmtRub = (n: number): string => (Number.isFinite(n) ? rub.format(n) : "—");
export const fmtPct = (n: number): string => (Number.isFinite(n) ? pct.format(n) : "—");
