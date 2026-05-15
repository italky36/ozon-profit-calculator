import type { CalcResult, ProductRow, TaxSettings } from "../types";

const XLSX_ENDPOINT = "/api/export/xlsx";

const filenameFromHeader = (header: string | null, fallback: string): string => {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to plain filename
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const requestExport = async (
  body: Record<string, unknown>,
  fallbackName: string,
): Promise<void> => {
  const res = await fetch(XLSX_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      // body wasn't JSON — keep status code
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const filename = filenameFromHeader(
    res.headers.get("Content-Disposition"),
    fallbackName,
  );
  triggerDownload(blob, filename);
};

export async function exportShortExcel(
  rows: ProductRow[],
  results: Map<string, CalcResult | { error: string }>,
): Promise<void> {
  await requestExport(
    {
      kind: "short",
      rows,
      results: Object.fromEntries(results),
    },
    "ozon-export.xlsx",
  );
}

export async function exportFullExcel(
  rows: ProductRow[],
  results: Map<string, CalcResult | { error: string }>,
  taxSettings: TaxSettings,
): Promise<void> {
  await requestExport(
    {
      kind: "full",
      rows,
      results: Object.fromEntries(results),
      taxSettings,
    },
    "ozon-export.xlsx",
  );
}
