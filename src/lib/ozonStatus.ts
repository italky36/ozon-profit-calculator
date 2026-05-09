import type { ProductRow } from "../types";

export type InactivityKind = "archived" | "hidden" | "warning" | null;

export interface Inactivity {
  kind: InactivityKind;
  /** Tooltip — what to show on hover. */
  reason: string;
}

/** Derive a UI-friendly inactivity classification from per-row Ozon status. */
export const inactivityOf = (row: ProductRow): Inactivity => {
  if (row.ozonProductId == null) return { kind: null, reason: "" };
  if (row.ozonArchived) {
    return {
      kind: "archived",
      reason: row.ozonStatusDescription
        ? `Архив · ${row.ozonStatusDescription}`
        : "В архиве на Ozon",
    };
  }
  if (row.ozonVisible === false) {
    const desc =
      row.ozonStatusDescription || row.ozonStatusName || "Скрыт на витрине";
    return { kind: "hidden", reason: desc };
  }
  if (row.ozonStatusDescription) {
    return { kind: "warning", reason: row.ozonStatusDescription };
  }
  return { kind: null, reason: "" };
};

export const isActiveOzon = (row: ProductRow): boolean => {
  if (row.ozonProductId == null) return true;
  const k = inactivityOf(row).kind;
  return k !== "archived" && k !== "hidden";
};
