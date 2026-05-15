import { eq } from "drizzle-orm";
import { shops } from "../db/schema";
import type { DB } from "../db/client";

export interface OzonCredentials {
  clientId: string;
  apiKey: string;
}

export type CredentialsSource = "shop";

export interface ResolvedCredentials extends OzonCredentials {
  source: CredentialsSource;
}

export class OzonApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly body: string;

  constructor(status: number, endpoint: string, body: string) {
    super(`Ozon API ${status} on ${endpoint}: ${body.slice(0, 300)}`);
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

const BASE_URL = "https://api-seller.ozon.ru";

/**
 * Resolve Ozon credentials for a shop. Only the shop's own keys are accepted —
 * the historical admin-global fallback and env-var fallback were removed in
 * 0018 to prevent unrelated shops from silently sharing one Ozon account.
 */
export async function resolveCredentials(
  db: DB,
  shopId: number,
): Promise<ResolvedCredentials | null> {
  const [shopRow] = await db
    .select({
      clientId: shops.ozonClientId,
      apiKey: shops.ozonApiKey,
    })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (shopRow?.clientId && shopRow?.apiKey) {
    return {
      clientId: shopRow.clientId,
      apiKey: shopRow.apiKey,
      source: "shop",
    };
  }
  return null;
}

export interface OzonClient {
  post<T>(endpoint: string, payload: unknown): Promise<T>;
}

interface OzonClientOptions {
  creds: OzonCredentials;
  /** Min interval between requests (ms). Ozon's seller API rate-limits aggressively. */
  minIntervalMs?: number;
  /** Total retry attempts on 429/5xx (including the first). Default 4. */
  retryAttempts?: number;
  /** For tests — override fetch. */
  fetchImpl?: typeof fetch;
  /** For tests — override base URL. */
  baseUrl?: string;
}

export function createOzonClient(opts: OzonClientOptions): OzonClient {
  const minInterval = opts.minIntervalMs ?? 700;
  const retryAttempts = opts.retryAttempts ?? 4;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl ?? BASE_URL;

  let nextEarliest = 0;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  return {
    async post<T>(endpoint: string, payload: unknown): Promise<T> {
      let attempt = 0;
      // Serialize requests: respect minInterval between successive launches.
      const delay = nextEarliest - Date.now();
      if (delay > 0) await sleep(delay);
      nextEarliest = Date.now() + minInterval;

      while (true) {
        attempt++;
        let res: Response;
        try {
          res = await fetchImpl(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: {
              "Client-Id": opts.creds.clientId,
              "Api-Key": opts.creds.apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload ?? {}),
          });
        } catch (e) {
          if (attempt >= retryAttempts) throw e;
          await sleep(500 * attempt);
          continue;
        }

        if (res.status === 429 || res.status >= 500) {
          if (attempt >= retryAttempts) {
            const body = await res.text().catch(() => "");
            throw new OzonApiError(res.status, endpoint, body);
          }
          await sleep(800 * attempt);
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new OzonApiError(res.status, endpoint, body);
        }

        return (await res.json()) as T;
      }
    },
  };
}
