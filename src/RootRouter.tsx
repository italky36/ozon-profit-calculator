import { useEffect } from "react";
import App from "./App";
import InvitePage from "./components/auth/InvitePage";
import LoginPage from "./components/auth/LoginPage";
import RegisterPage from "./components/auth/RegisterPage";
import VerifyEmailPage from "./components/auth/VerifyEmailPage";
import { useAuth } from "./contexts/useAuth";
import { navigate, usePathname } from "./lib/router";

const PUBLIC_PATHS = new Set(["/login", "/register", "/verify-email"]);
const INVITE_PREFIX = "/invite/";

export default function RootRouter() {
  const { user, loading, logout } = useAuth();
  const path = usePathname();
  const inviteToken = path.startsWith(INVITE_PREFIX)
    ? decodeURIComponent(path.slice(INVITE_PREFIX.length))
    : null;

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_PATHS.has(path) || inviteToken !== null;
    if (!user && !isPublic) {
      navigate("/login");
      return;
    }
    if (user && (path === "/login" || path === "/register")) {
      navigate("/");
    }
  }, [user, loading, path, inviteToken]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  if (inviteToken) return <InvitePage token={inviteToken} />;
  if (path === "/verify-email") return <VerifyEmailPage />;
  if (path === "/login") return <LoginPage />;
  if (path === "/register") return <RegisterPage />;

  if (!user) {
    // Effect above will navigate; render nothing while redirect resolves.
    return null;
  }

  // Sysadmin doesn't belong in the workspace SPA — they have no team and
  // their tools live in the separate sysadmin console.
  if (user.isSysadmin) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h2 style={{ marginBottom: 12 }}>Sysadmin-аккаунт</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            У платформенных администраторов нет рабочей команды.
            Используйте отдельную консоль администратора.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <a
              className="btn-primary"
              href={
                window.location.hostname === "localhost"
                  ? "http://localhost:5174/"
                  : "/sysadmin/"
              }
              style={{ padding: "8px 16px" }}
            >
              Открыть консоль админа
            </a>
            <button
              className="btn-secondary"
              onClick={() => {
                void logout();
              }}
              style={{ padding: "8px 16px" }}
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Non-sysadmin without a workspace = corrupt/legacy state. Should be
  // impossible after Stage 1 backfill + Stage 3 transactional registration,
  // but render a recovery message instead of dropping into a broken App.
  if (user.workspaceId === 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h2 style={{ marginBottom: 12 }}>Учётная запись без команды</h2>
          <p className="muted" style={{ marginBottom: 16 }}>
            К вашей учётной записи не привязана команда (workspace).
            Обратитесь к администратору сервиса для восстановления доступа.
          </p>
          <button
            className="btn-secondary"
            onClick={() => {
              void logout();
            }}
            style={{ padding: "8px 16px" }}
          >
            Выйти
          </button>
        </div>
      </div>
    );
  }

  return <App />;
}
