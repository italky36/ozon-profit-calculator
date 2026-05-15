import type {
  ProductInput,
  ProductRow,
  References,
  TaxSettings,
} from "../types";

export interface Shop {
  id: number;
  name: string;
  shortName: string;
  color: string | null;
  taxSettings: TaxSettings;
  autoRefreshEnabled: boolean;
  autoRefreshIntervalMin: number;
  hasOzonCreds: boolean;
  ozonUpdatedAt: number | null;
  /** Selected cluster tariff set (effective for current user). NULL → fall
   * back to latest global. */
  tariffSetId: number | null;
  createdAt: number;
  updatedAt: number;
  /** True when the current user owns this shop. False for shared admin shops. */
  isOwner: boolean;
  /** Email of the shop owner. Null when current user is the owner. */
  ownerEmail: string | null;
  /** True when at least one field is overridden by current user (vs shop defaults). */
  hasOverrides: boolean;
}

export interface TariffSet {
  id: number;
  shopId: number | null;
  scope: "global" | "shop";
  name: string;
  uploadedAt: number;
  rowCount: number;
}

export interface ShopCreateInput {
  name: string;
  shortName?: string;
  color?: string | null;
  taxSettings?: TaxSettings;
}

export interface ShopPatch {
  name?: string;
  shortName?: string;
  color?: string | null;
  taxSettings?: TaxSettings;
  autoRefreshEnabled?: boolean;
  autoRefreshIntervalMin?: number;
  tariffSetId?: number | null;
}

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

export type CredentialsActiveSource = "shop" | null;

export interface CredentialsStatus {
  shopId: number;
  hasCredentials: boolean;
  /** Which source resolveCredentials() will pick for THIS shop. */
  activeSource: CredentialsActiveSource;
  shop: { hasCredentials: boolean };
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
  shopId: number;
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
  shopId: number;
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
  isSysadmin: boolean;
  isVerified: boolean;
  workspaceId: number;
  workspaceRole: "owner" | "manager" | "member";
}

export interface AdminUser extends AuthUser {
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface AdminWorkspace {
  id: number;
  name: string;
  slug: string;
  memberCount: number;
  shopCount: number;
  ownerEmail: string | null;
  createdAt: number;
}

export type WorkspaceRole = "owner" | "manager" | "member";

export interface WorkspaceMember {
  userId: number;
  email: string;
  role: WorkspaceRole;
  status: "active" | "suspended";
  isYou: boolean;
  createdAt: number;
}

export interface WorkspaceInfo {
  id: number;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  role: WorkspaceRole;
  members: WorkspaceMember[];
}

export interface WorkspaceInviteRow {
  token: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: { id: number; email: string };
  expiresAt: number;
  createdAt: number;
}

export interface PublicInviteInfo {
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  inviterEmail: string;
  expiresAt: number;
}

export const api = {
  auth: {
    me: () => apiFetch<{ user: AuthUser }>("/auth/me"),
    login: (email: string, password: string) =>
      apiFetch<{ user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (
      email: string,
      password: string,
      workspaceName: string,
      inviteToken?: string,
    ) =>
      apiFetch<{ message: string }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(
          inviteToken
            ? { email, password, inviteToken }
            : { email, password, workspaceName },
        ),
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
    listWorkspaces: () => apiFetch<AdminWorkspace[]>("/admin/workspaces"),
    deleteWorkspace: (id: number) =>
      apiFetch<{ ok: true }>(`/admin/workspaces/${id}`, { method: "DELETE" }),
  },
  refs: {
    get: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<RefsResponse>(`/refs${qs}`);
    },
    clusterLogisticsStats: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<{
        count: number;
        fromClusters: string[];
        toClusters: string[];
      }>(`/refs/cluster-logistics${qs}`);
    },
    // Legacy: admin-only global overwrite. Use tariffSets.upload for the
    // versioned flow.
    uploadClusterLogistics: (file: File) =>
      apiUpload<{
        inserted: number;
        fromClusters: string[];
        toClusters: string[];
      }>("/refs/cluster-logistics/upload", file),
    tariffSets: {
      list: () => apiFetch<TariffSet[]>("/refs/cluster-logistics/sets"),
      upload: async (input: {
        file: File;
        name: string;
        scope: "global" | "shop";
        shopId?: number;
      }): Promise<TariffSet & { fromClusters: string[]; toClusters: string[] }> => {
        const fd = new FormData();
        fd.append("file", input.file);
        fd.append("name", input.name);
        fd.append("scope", input.scope);
        if (input.scope === "shop" && input.shopId != null) {
          fd.append("shopId", String(input.shopId));
        }
        const res = await fetch(`${BASE}/refs/cluster-logistics/sets`, {
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
        return body as TariffSet & {
          fromClusters: string[];
          toClusters: string[];
        };
      },
      remove: (id: number) =>
        apiFetch<void>(`/refs/cluster-logistics/sets/${id}`, {
          method: "DELETE",
        }),
    },
  },
  shops: {
    list: () => apiFetch<Shop[]>("/shops"),
    create: (input: ShopCreateInput) =>
      apiFetch<Shop>("/shops", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: number, patch: ShopPatch) =>
      apiFetch<Shop>(`/shops/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    remove: (id: number) =>
      apiFetch<void>(`/shops/${id}`, { method: "DELETE" }),
    setActive: (shopId: number) =>
      apiFetch<{ activeShopId: number }>("/shops/active", {
        method: "PUT",
        body: JSON.stringify({ shopId }),
      }),
    /** Clear per-user overrides for this shop (revert to shop defaults). */
    resetOverrides: (id: number) =>
      apiFetch<Shop>(`/shops/${id}/reset-overrides`, { method: "POST" }),
  },
  products: {
    /** When shopId is provided — returns products of that shop only.
     *  When omitted — products of all user's shops (for «Все» filter). */
    list: (shopId?: number | null) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<ProductRow[]>(`/products${qs}`);
    },
    create: (shopId: number, input: ProductInput) =>
      apiFetch<ProductRow>("/products", {
        method: "POST",
        body: JSON.stringify({ ...input, shopId }),
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
    bulkResetWhitePurchase: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<{ updated: number }>(
        `/products/bulk/white-purchase-reset${qs}`,
        { method: "POST" },
      );
    },
    bulkUpdate: (
      ids: string[],
      patch: { whitePurchase?: boolean | null; vatRate?: string | number },
    ) =>
      apiFetch<{ updated: number }>("/products/bulk/update", {
        method: "POST",
        body: JSON.stringify({ ids, patch }),
      }),
    bulkDelete: (ids: string[]) =>
      apiFetch<{ deleted: number }>("/products/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
  },
  settings: {
    get: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<TaxSettings>(`/settings${qs}`);
    },
    put: (next: TaxSettings, shopId?: number) =>
      apiFetch<TaxSettings>("/settings", {
        method: "PUT",
        body: JSON.stringify(shopId != null ? { ...next, shopId } : next),
      }),
    getAutoRefresh: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<{ shopId: number; enabled: boolean; intervalMin: number }>(
        `/settings/auto-refresh${qs}`,
      );
    },
    putAutoRefresh: (
      next: { enabled: boolean; intervalMin: number },
      shopId?: number,
    ) =>
      apiFetch<{ shopId: number; enabled: boolean; intervalMin: number }>(
        "/settings/auto-refresh",
        {
          method: "PUT",
          body: JSON.stringify(shopId != null ? { ...next, shopId } : next),
        },
      ),
  },
  credentials: {
    status: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<CredentialsStatus>(`/credentials/status${qs}`);
    },
    statusAll: () =>
      apiFetch<{ shops: CredentialsStatus[] }>("/credentials/status/all"),
    put: (creds: { clientId: string; apiKey: string }, shopId?: number) =>
      apiFetch<{ ok: true }>("/credentials", {
        method: "PUT",
        body: JSON.stringify(shopId != null ? { ...creds, shopId } : creds),
      }),
    remove: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<{ ok: true; cleared: number }>(`/credentials${qs}`, {
        method: "DELETE",
      });
    },
  },
  import: {
    startCatalog: (shopId?: number) =>
      apiFetch<{ runId: number }>("/import/catalog", {
        method: "POST",
        body: JSON.stringify(shopId != null ? { shopId } : {}),
      }),
    startFinance: (body: { from: string; to: string; shopId?: number }) =>
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
    listTransactions: (q: FinanceListQuery & { shopId?: number } = {}) => {
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
    summary: (q: { from?: string; to?: string; shopId?: number } = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v !== undefined && v !== null && v !== "")
          params.set(k, String(v));
      }
      const qs = params.toString();
      return apiFetch<FinanceSummaryRow[]>(
        `/finance/summary${qs ? `?${qs}` : ""}`,
      );
    },
    clearAll: (shopId?: number) => {
      const qs = shopId != null ? `?shopId=${shopId}` : "";
      return apiFetch<{ deleted: number }>(
        `/finance/transactions/all${qs}`,
        { method: "DELETE" },
      );
    },
  },
  analytics: {
    realizedMargin: (
      q: { from?: string; to?: string; shopId?: number } = {},
    ) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v !== undefined && v !== null && v !== "")
          params.set(k, String(v));
      }
      const qs = params.toString();
      return apiFetch<RealizedMarginResponse>(
        `/analytics/realized-margin${qs ? `?${qs}` : ""}`,
      );
    },
  },
  workspace: {
    me: () => apiFetch<WorkspaceInfo>("/workspace/me"),
    update: (patch: { name?: string; slug?: string }) =>
      apiFetch<{ id: number; name: string; slug: string }>("/workspace/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    listInvites: () =>
      apiFetch<WorkspaceInviteRow[]>("/workspace/me/invites"),
    createInvite: (email: string, role: WorkspaceRole) =>
      apiFetch<WorkspaceInviteRow>("/workspace/me/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    revokeInvite: (token: string) =>
      apiFetch<{ ok: true }>(
        `/workspace/me/invites/${encodeURIComponent(token)}`,
        { method: "DELETE" },
      ),
    setMemberRole: (userId: number, role: WorkspaceRole) =>
      apiFetch<{ ok: true; userId: number; role: WorkspaceRole }>(
        `/workspace/me/members/${userId}`,
        { method: "PATCH", body: JSON.stringify({ role }) },
      ),
    removeMember: (userId: number) =>
      apiFetch<{ ok: true }>(`/workspace/me/members/${userId}`, {
        method: "DELETE",
      }),
  },
  invites: {
    lookup: (token: string) =>
      apiFetch<PublicInviteInfo>(`/invites/${encodeURIComponent(token)}`),
    accept: (token: string) =>
      apiFetch<{ ok: true; workspaceId: number; role: WorkspaceRole }>(
        `/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      ),
  },
};

export type { RefsResponse };
