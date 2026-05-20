import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createUserDirect,
  loginAndGetCookie,
  setupTestEnv,
  teardownTestEnv,
  type TestEnv,
} from "./_helpers";

const WORKSPACE_COOKIE = /ozon_calc_session=/;
const SYSADMIN_COOKIE = /ozon_calc_sysadmin_session=/;

describe("auth scope isolation", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await setupTestEnv();
  });
  afterEach(async () => await teardownTestEnv(env));

  describe("login scope gates", () => {
    it("workspace user logging in via workspace scope sets workspace cookie", async () => {
      await createUserDirect(env.db, "u@x.com", "password123", "user");
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Scope": "workspace",
        },
        body: JSON.stringify({ email: "u@x.com", password: "password123" }),
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(WORKSPACE_COOKIE);
      expect(setCookie).not.toMatch(SYSADMIN_COOKIE);
    });

    it("sysadmin logging in via sysadmin scope sets sysadmin cookie", async () => {
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Scope": "sysadmin",
        },
        body: JSON.stringify({ email: "admin@x.com", password: "password123" }),
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(SYSADMIN_COOKIE);
      expect(setCookie).not.toMatch(WORKSPACE_COOKIE);
    });

    it("sysadmin attempting workspace scope is rejected with 403", async () => {
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Scope": "workspace",
        },
        body: JSON.stringify({ email: "admin@x.com", password: "password123" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/sysadmin/i);
    });

    it("regular user attempting sysadmin scope is rejected with 403", async () => {
      await createUserDirect(env.db, "u@x.com", "password123", "user");
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Scope": "sysadmin",
        },
        body: JSON.stringify({ email: "u@x.com", password: "password123" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/администратор|operator|оператор/i);
    });

    it("default scope (no header) treats request as workspace", async () => {
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      const res = await env.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@x.com", password: "password123" }),
      });
      // No header → defaults to workspace → sysadmin rejected.
      expect(res.status).toBe(403);
    });
  });

  describe("session middleware scope routing", () => {
    it("workspace scope ignores sysadmin cookie (returns 401 for /auth/me)", async () => {
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      const sysadminCookie = await loginAndGetCookie(
        env.app,
        "admin@x.com",
        "password123",
        "sysadmin",
      );

      const res = await env.app.request("/api/auth/me", {
        headers: { Cookie: sysadminCookie, "X-App-Scope": "workspace" },
      });
      expect(res.status).toBe(401);
    });

    it("sysadmin scope ignores workspace cookie (returns 401 for /auth/me)", async () => {
      await createUserDirect(env.db, "u@x.com", "password123", "user");
      const workspaceCookie = await loginAndGetCookie(
        env.app,
        "u@x.com",
        "password123",
      );

      const res = await env.app.request("/api/auth/me", {
        headers: { Cookie: workspaceCookie, "X-App-Scope": "sysadmin" },
      });
      expect(res.status).toBe(401);
    });

    it("workspace scope reads workspace cookie even when sysadmin cookie is also set", async () => {
      // Two distinct accounts; both cookies sent simultaneously (browser
      // scenario where /5173 and /5174 share localhost).
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      await createUserDirect(env.db, "u@x.com", "password123", "user");
      const sysadminCookie = await loginAndGetCookie(
        env.app,
        "admin@x.com",
        "password123",
        "sysadmin",
      );
      const workspaceCookie = await loginAndGetCookie(
        env.app,
        "u@x.com",
        "password123",
      );
      const combined = `${workspaceCookie}; ${sysadminCookie}`;

      const res = await env.app.request("/api/auth/me", {
        headers: { Cookie: combined, "X-App-Scope": "workspace" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe("u@x.com");
      expect(body.user.isSysadmin).toBe(false);
    });

    it("sysadmin scope reads sysadmin cookie even when workspace cookie is also set", async () => {
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      await createUserDirect(env.db, "u@x.com", "password123", "user");
      const sysadminCookie = await loginAndGetCookie(
        env.app,
        "admin@x.com",
        "password123",
        "sysadmin",
      );
      const workspaceCookie = await loginAndGetCookie(
        env.app,
        "u@x.com",
        "password123",
      );
      const combined = `${workspaceCookie}; ${sysadminCookie}`;

      const res = await env.app.request("/api/auth/me", {
        headers: { Cookie: combined, "X-App-Scope": "sysadmin" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.email).toBe("admin@x.com");
      expect(body.user.isSysadmin).toBe(true);
    });
  });

  describe("logout scope routing", () => {
    it("workspace logout clears workspace cookie only", async () => {
      await createUserDirect(env.db, "u@x.com", "password123", "user");
      const cookie = await loginAndGetCookie(env.app, "u@x.com", "password123");

      const res = await env.app.request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie, "X-App-Scope": "workspace" },
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      // Clear directive is on the workspace cookie name.
      expect(setCookie).toMatch(WORKSPACE_COOKIE);
    });

    it("sysadmin logout clears sysadmin cookie only", async () => {
      await createUserDirect(env.db, "admin@x.com", "password123", "admin");
      const cookie = await loginAndGetCookie(
        env.app,
        "admin@x.com",
        "password123",
        "sysadmin",
      );

      const res = await env.app.request("/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookie, "X-App-Scope": "sysadmin" },
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(SYSADMIN_COOKIE);
    });
  });
});
