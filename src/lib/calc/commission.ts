import type { CommissionRow } from "../../types";

export type Bucket = "upTo100" | "upTo300" | "upTo1500" | "upTo5000" | "upTo10000" | "over10000";
export type RealFbsBucket = "upTo1500" | "upTo5000" | "upTo10000" | "over10000";

export const bucketOf = (price: number): Bucket => {
  if (price <= 100) return "upTo100";
  if (price <= 300) return "upTo300";
  if (price <= 1500) return "upTo1500";
  if (price <= 5000) return "upTo5000";
  if (price <= 10000) return "upTo10000";
  return "over10000";
};

export const realFbsBucketOf = (price: number): RealFbsBucket => {
  if (price <= 1500) return "upTo1500";
  if (price <= 5000) return "upTo5000";
  if (price <= 10000) return "upTo10000";
  return "over10000";
};

export const findCommission = (
  rows: CommissionRow[],
  category: string,
  productType: string,
): CommissionRow | undefined => {
  const key = `${category}-${productType}`;
  return rows.find((r) => r.key === key);
};

export interface CommissionRubResult {
  fboPercent: number;
  fboRub: number;
  fbsRub: number;
  realFbsRub: number;
}

export const commissionsRub = (
  row: CommissionRow,
  promoPrice: number,
): CommissionRubResult => {
  const b = bucketOf(promoPrice);
  const rb = realFbsBucketOf(promoPrice);
  const fboPercent = row.fbo[b] ?? 0;
  const fbsPercent = row.fbs[b] ?? 0;
  const realPercent = row.realFbs[rb] ?? 0;
  return {
    fboPercent,
    fboRub: promoPrice * fboPercent,
    fbsRub: promoPrice * fbsPercent,
    realFbsRub: promoPrice * realPercent,
  };
};
