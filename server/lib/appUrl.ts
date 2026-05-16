import type { Context } from "hono";

const LOCALHOST_FALLBACK = "http://localhost:5173";

/** Build the public base URL for links sent in outbound emails (verification,
 * invite, password reset). Resolution order:
 *
 *  1. `process.env.APP_URL` — explicit override, used in production.
 *  2. The incoming request's `Origin` header — what the browser actually used
 *     to reach the SPA. Lets dev across LAN (`http://192.168.1.50:5173`) work
 *     without env tweaks. **Gated to non-production** to keep Origin out of
 *     the trust chain in prod (a hostile client could otherwise generate
 *     phishing-grade links by spoofing the header).
 *  3. `http://localhost:5173` — last-ditch fallback.
 *
 * Origin is sanitised: only `http`/`https` schemes accepted, and the value
 * is trimmed of trailing slashes for clean concatenation.
 */
export function resolveAppUrl(c: Context): string {
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl.trim()) return stripTrailingSlash(envUrl.trim());

  if (process.env.NODE_ENV !== "production") {
    const origin = c.req.header("Origin");
    if (origin && /^https?:\/\//i.test(origin)) {
      return stripTrailingSlash(origin);
    }
  }
  return LOCALHOST_FALLBACK;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}
