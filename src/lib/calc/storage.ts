import type { StorageRow, AcceptanceTariff } from "../../types";

export const findStorage = (
  rows: StorageRow[],
  category: string,
  productType: string,
): StorageRow | undefined => {
  const key = `${category}-${productType}`;
  return rows.find((r) => r.key === key);
};

export const freeStorageDaysOf = (
  row: StorageRow | undefined,
  isFireHazard: boolean,
  isKgt: boolean,
  isKazakhstan: boolean,
): number => {
  if (isFireHazard) return 60;
  if (!row) return 0;
  if (isKgt) return row.freeStorageDaysKgt;
  if (isKazakhstan) return row.freeStorageDaysKz;
  return row.freeStorageDays;
};

export const ratePerLPerDayOf = (
  isFireHazard: boolean,
  isKgt: boolean,
  isKazakhstan: boolean,
): number => {
  if (isFireHazard) return 0.6;
  if (isKgt) return 0.1;
  if (isKazakhstan) return 0.35;
  return 2.5;
};

export const storageFboOf = (
  plannedStorageDays: number,
  freeStorageDays: number,
  volumeL: number,
  isFireHazard: boolean,
  isKgt: boolean,
  isKazakhstan: boolean,
): number => {
  const overdue = Math.max(plannedStorageDays - freeStorageDays, 0);
  const rate = ratePerLPerDayOf(isFireHazard, isKgt, isKazakhstan);
  return overdue * volumeL * rate;
};

export const acceptanceFboFeeOf = (
  tariff: AcceptanceTariff,
  volumeL: number,
): number => {
  const v = Math.ceil(volumeL);
  switch (tariff) {
    case "Доверительная приемка":
      return 0;
    case "Поштучная приемка":
      return Math.min(60, v <= 1 ? 5 : 5 + (v - 1));
    case "Сортировка по зонам размещения":
      return Math.min(200, 5 * v);
    case "Корректировка состава":
      return Math.min(200, 10 * v);
  }
};

export const ACCEPTANCE_FBS_FEE = 30;
