import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loginAs,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

/** Email-link base URL resolution: env > Origin (dev) > localhost fallback.
 * Verifies that emails sent from the API contain links that match the URL the
 * user actually accessed (so LAN dev across machines doesn't ship localhost
 * links), while keeping production strict against Origin spoofing. */
describe("email link base URL", () => {
  let env: TestEnv;
  let savedAppUrl: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(async () => {
    env = await setupTestEnv();
    savedAppUrl = process.env.APP_URL;
    savedNodeEnv = process.env.NODE_ENV;
    delete process.env.APP_URL;
    // Default to dev for these tests; one case below flips to production.
    process.env.NODE_ENV = "test";
  });
  afterEach(async () => {
    await teardownTestEnv(env);
    if (savedAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = savedAppUrl;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  /** Trigger a verification email by registering. The captured message is the
   * latest entry in `env.emails`. Returns the link extracted from the text body. */
  async function registerAndExtractLink(
    email: string,
    headers: Record<string, string> = {},
  ): Promise<string> {
    env.emails.length = 0;
    const res = await env.app.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        email,
        password: "password123",
        workspaceName: "T",
      }),
    });
    expect(res.status).toBe(200);
    expect(env.emails).toHaveLength(1);
    const text = env.emails[0]!.text;
    const m = text.match(/https?:\/\/[^\s]+\/verify-email\?token=[^\s]+/);
    if (!m) throw new Error(`no verify link in email: ${text}`);
    return m[0];
  }

  it("uses Origin header when no APP_URL set (dev)", async () => {
    const link = await registerAndExtractLink("a@test.local", {
      Origin: "http://192.168.1.50:5173",
    });
    expect(link.startsWith("http://192.168.1.50:5173/verify-email")).toBe(true);
  });

  it("falls back to localhost when neither Origin nor APP_URL is present", async () => {
    const link = await registerAndExtractLink("b@test.local");
    expect(link.startsWith("http://localhost:5173/verify-email")).toBe(true);
  });

  it("APP_URL wins over Origin", async () => {
    process.env.APP_URL = "https://app.example.com";
    const link = await registerAndExtractLink("c@test.local", {
      Origin: "http://attacker.example.com",
    });
    expect(link.startsWith("https://app.example.com/verify-email")).toBe(true);
  });

  it("production ignores Origin without APP_URL — falls back to localhost", async () => {
    process.env.NODE_ENV = "production";
    const link = await registerAndExtractLink("d@test.local", {
      Origin: "http://attacker.example.com",
    });
    expect(link.startsWith("http://localhost:5173/verify-email")).toBe(true);
  });

  it("invite emails (workspace) also adapt to Origin", async () => {
    const owner = await loginAs(env, "owner@test.local", "password123");
    env.emails.length = 0;
    const res = await env.app.request("/api/workspace/me/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: owner.cookie,
        Origin: "http://10.0.0.7:5173",
      },
      body: JSON.stringify({ email: "newcomer@test.local", role: "member" }),
    });
    expect(res.status).toBe(201);
    expect(env.emails.length).toBeGreaterThan(0);
    const inviteMail = env.emails[env.emails.length - 1]!;
    const m = inviteMail.text.match(/https?:\/\/[^\s]+\/invite\/[^\s]+/);
    expect(m).not.toBeNull();
    expect(m![0].startsWith("http://10.0.0.7:5173/invite/")).toBe(true);
  });
});
