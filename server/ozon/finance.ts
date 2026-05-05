import type { OzonClient } from "./client";
import type {
  OzonFinanceTransactionItem,
  OzonFinanceTransactionListResp,
} from "./types";

const PAGE_SIZE = 1000;

export interface TransactionFilter {
  /** ISO date-time, e.g. "2026-04-01T00:00:00.000Z" */
  from: string;
  /** ISO date-time, e.g. "2026-04-30T23:59:59.999Z" */
  to: string;
  /** "all" by default; "orders" | "returns" | "services" if narrowing. */
  transactionType?: string;
}

/** Iterate /v3/finance/transaction/list pages. Single-tenant, sequential. */
export async function* iterateTransactions(
  client: OzonClient,
  filter: TransactionFilter,
): AsyncGenerator<OzonFinanceTransactionItem[]> {
  let page = 1;
  while (true) {
    const resp = await client.post<OzonFinanceTransactionListResp>(
      "/v3/finance/transaction/list",
      {
        filter: {
          date: { from: filter.from, to: filter.to },
          transaction_type: filter.transactionType ?? "all",
        },
        page,
        page_size: PAGE_SIZE,
      },
    );
    const ops = resp.result.operations ?? [];
    if (ops.length === 0) return;
    yield ops;
    if (page >= resp.result.page_count || ops.length < PAGE_SIZE) return;
    page++;
  }
}
