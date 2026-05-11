import type {
  ProductInput,
  ProductRow,
  References,
  TaxSettings,
} from "../types";

interface RefsResponse extends References {
  lists: Record<string, unknown>;
  categories: Record<string, string[]>;
}

export interface ImportRun {
  id: number;
  kind: "catalog" | "finance";
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "ok" | "error";
  itemsProcessed: number;
  errorMessage: string | null;
  params: Record<string, unknown> | null;
}

export interface CredentialsStatus {
  hasCredentials: boolean;
  source: "env" | "db" | null;
}

export type FinanceType =
  | "sale"
  | "refund"
  | "commission"
  | "logistics"
  | "last_mile"
  | "storage"
  | "other";

export interface FinanceTransactionRow {
  operationId: number;
  operationType: string;
  operationDate: number; // ms timestamp
  postingNumber: string | null;
  articleId: string | null;
  amount: number;
  type: FinanceType;
  /** `raw.accruals_for_sale` — сумма, которую Ozon начислил продавцу как
   * выручку до удержаний. Отличается от `amount` (net в этой строке выписки). */
  grossAmount: number | null;
}

export interface FinanceSummaryRow {
  type: FinanceType;
  count: number;
  total: number;
}

export interface FinanceListQuery {
  from?: string;
  to?: string;
  type?: FinanceType;
  articleId?: string;
  limit?: number;
  offset?: number;
}

export interface RealizedMarginRow {
  articleId: string;
  actualRevenue: number;
  actualRefund: number;
  actualCommission: number;
  actualLogistics: number;
  actualLastMile: number;
  actualStorage: number;
  actualOther: number;
  actualMargin: number;
  salesCount: number;
  txCount: number;
}

export interface RealizedMarginResponse {
  period: { from: string | null; to: string | null };
  rows: RealizedMarginRow[];
}

const BASE = "/api";

export type AuthErrorListener = () => void;
const authErrorListeners = new Set<AuthErrorListener>();
export function onAuthError(listener: AuthErrorListener): () => void {
  authErrorListeners.add(listener);
  return () => authErrorListeners.delete(listener);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401 && !path.startsWith("/auth/"))
    for (const l of authErrorListeners) l();
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

async function apiUpload<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  // Не задаём Content-Type вручную — браузер добавит multipart/form-data с
  // правильным boundary.
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (res.status === 401) for (const l of authErrorListeners) l();
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export interface AuthUser {
  id: number;
  email: string;
  role: "admin" | "user";
  isVerified: boolean;
}

export interface AdminUser extends AuthUser {
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOzonCredentials {
  hasCredentials: boolean;
  source: "env" | "db" | null;
  clientId: string | null;
  hasApiKey: boolean;
  updatedAt: string | null;
}

export type SmtpSecureMode = "auto" | "ssl" | "starttls" | "none";

export interface AdminSmtpSettings {
  source: "db" | "env" | "console";
  host: string | null;
  port: number | null;
  user: string | null;
  from: string | null;
  secure: SmtpSecureMode;
  hasPassword: boolean;
  updatedAt: string | null;
}

export const api = {
  auth: {
    me: () => apiFetch<{ user: AuthUser }>("/auth/me"),
    login: (email: string, password: string) =>
      apiFetch<{ user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string) =>
      apiFetch<{ message: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    verifyEmail: (token: string) =>
      apiFetch<{ user: AuthUser }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    logout: () =>
      apiFetch<{ message: string }>("/auth/logout", { method: "POST" }),
  },
  admin: {
    listUsers: () => apiFetch<AdminUser[]>("/admin/users"),
    setRole: (id: number, role: "admin" | "user") =>
      apiFetch<AdminUser>(`/admin/users/${id}/role`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      }),
    setBlocked: (id: number, blocked: boolean) =>
      apiFetch<AdminUser>(`/admin/users/${id}/blocked`, {
        method: "PUT",
        body: JSON.stringify({ blocked }),
      }),
    deleteUser: (id: number) =>
      apiFetch<{ message: string }>(`/admin/users/${id}`, { method: "DELETE" }),
    resendVerification: (id: number) =>
      apiFetch<{ message: string }>(
        `/admin/users/${id}/resend-verification`,
        { method: "POST" },
      ),
    revokeSessions: (id: number) =>
      apiFetch<{ message: string }>(
        `/admin/users/${id}/revoke-sessions`,
        { method: "POST" },
      ),
    getOzonCredentials: () =>
      apiFetch<AdminOzonCredentials>("/admin/ozon-credentials"),
    putOzonCredentials: (creds: { clientId: string; apiKey?: string }) =>
      apiFetch<{ ok: true }>("/admin/ozon-credentials", {
        method: "PUT",
        body: JSON.stringify(creds),
      }),
    getSmtp: () => apiFetch<AdminSmtpSettings>("/admin/smtp"),
    putSmtp: (cfg: {
      host: string;
      port: number;
      user: string;
      pass?: string;
      from: string;
      secure: SmtpSecureMode;
    }) =>
      apiFetch<{ ok: true }>("/admin/smtp", {
        method: "PUT",
        body: JSON.stringify(cfg),
      }),
    deleteSmtp: () =>
      apiFetch<{ ok: true }>("/admin/smtp", { method: "DELETE" }),
    testSmtp: (to: string, subject?: string) =>
      apiFetch<{ ok: true; source: string }>("/admin/smtp/test", {
        method: "POST",
        body: JSON.stringify({ to, subject }),
      }),
  },
  refs: {
    get: () => apiFetch<RefsResponse>("/refs"),
    clusterLogisticsStats: () =>
      apiFetch<{
        count: number;
        fromClusters: string[];
        toClusters: string[];
      }>("/refs/cluster-logistics"),
    uploadClusterLogistics: (file: File) =>
      apiUpload<{
        inserted: number;
        fromClusters: string[];
        toClusters: string[];
      }>("/refs/cluster-logistics/upload", file),
  },
  products: {
    list: () => apiFetch<ProductRow[]>("/products"),
    create: (input: ProductInput) =>
      apiFetch<ProductRow>("/products", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: string, input: ProductInput) =>
      apiFetch<ProductRow>(`/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      apiFetch<void>(`/products/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    bulkResetWhitePurchase: () =>
      apiFetch<{ updated: number }>("/products/bulk/white-purchase-reset", {
        method: "POST",
      }),
  },
  settings: {
    get: () => apiFetch<TaxSettings>("/settings"),
    put: (next: TaxSettings) =>
      apiFetch<TaxSettings>("/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      }),
    getAutoRefresh: () =>
      apiFetch<{ enabled: boolean; intervalMin: number }>(
        "/settings/auto-refresh",
      ),
    putAutoRefresh: (next: { enabled: boolean; intervalMin: number }) =>
      apiFetch<{ enabled: boolean; intervalMin: number }>(
        "/settings/auto-refresh",
        { method: "PUT", body: JSON.stringify(next) },
      ),
  },
  credentials: {
    status: () => apiFetch<CredentialsStatus>("/credentials/status"),
    put: (creds: { clientId: string; apiKey: string }) =>
      apiFetch<{ ok: true }>("/credentials", {
        method: "PUT",
        body: JSON.stringify(creds),
      }),
  },
  import: {
    startCatalog: () =>
      apiFetch<{ runId: number }>("/import/catalog", { method: "POST" }),
    startFinance: (body: { from: string; to: string }) =>
      apiFetch<{ runId: number }>("/import/finance", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getRun: (id: number) => apiFetch<ImportRun>(`/import/runs/${id}`),
    listRuns: () => apiFetch<ImportRun[]>("/import/runs"),
    debugPrices: (articleId: string) =>
      apiFetch<{
        endpoint: string;
        request: unknown;
        response: unknown;
      }>(`/import/debug/prices/${encodeURIComponent(articleId)}`),
    debugInfo: (articleId: string) =>
      apiFetch<{
        endpoint: string;
        request: unknown;
        response: unknown;
      }>(`/import/debug/info/${encodeURIComponent(articleId)}`),
    refreshArticle: (articleId: string) =>
      apiFetch<{
        ok: true;
        articleId: string;
        currentPrice: number;
        discountPercent: number;
        ozonCommissions: unknown;
      }>(`/import/catalog/refresh/${encodeURIComponent(articleId)}`, {
        method: "POST",
      }),
    relinkFinance: () =>
      apiFetch<{ ok: true; scanned: number; linked: number; note?: string }>(
        "/import/finance/relink",
        { method: "POST" },
      ),
    debugFinance: (articleId: string) =>
      apiFetch<{
        articleId: string;
        period: { from: number | null; to: number | null };
        sale: {
          operations: number;
          units: number;
          grossSum: number;
          netSum: number;
          avgPerUnitGross: number | null;
          avgPerUnitNet: number | null;
        };
        refund: {
          operations: number;
          units: number;
          grossSum: number;
          netSum: number;
        };
        recent: Array<{
          operationId: number;
          operationType: string;
          operationDate: number;
          type: string;
          amount: number;
          accrualsForSale: number | null;
          postingNumber: string | null;
        }>;
      }>(`/import/debug/finance/${encodeURIComponent(articleId)}`),
  },
  finance: {
    listTransactions: (q: FinanceListQuery = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v !== undefined && v !== null && v !== "")
          params.set(k, String(v));
      }
      const qs = params.toString();
      return apiFetch<FinanceTransactionRow[]>(
        `/finance/transactions${qs ? `?${qs}` : ""}`,
      );
    },
    summary: (q: { from?: string; to?: string } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v) params.set(k, v);
      }
      const qs = params.toString();
      return apiFetch<FinanceSummaryRow[]>(
        `/finance/summary${qs ? `?${qs}` : ""}`,
      );
    },
    clearAll: () =>
      apiFetch<{ deleted: number }>("/finance/transactions/all", {
        method: "DELETE",
      }),
  },
  analytics: {
    realizedMargin: (q: { from?: string; to?: string } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v) params.set(k, v);
      }
      const qs = params.toString();
      return apiFetch<RealizedMarginResponse>(
        `/analytics/realized-margin${qs ? `?${qs}` : ""}`,
      );
    },
  },
};

export type { RefsResponse };
