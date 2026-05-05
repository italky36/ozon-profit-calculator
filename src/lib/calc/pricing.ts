export const promoPriceOf = (currentPrice: number, discountPercent: number): number =>
  currentPrice * (1 - discountPercent);

export const returnPercentOf = (redemptionPercent: number): number =>
  1 - redemptionPercent / 100;

export const returnPercentIntOf = (redemptionPercent: number): number =>
  100 - redemptionPercent;

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));
