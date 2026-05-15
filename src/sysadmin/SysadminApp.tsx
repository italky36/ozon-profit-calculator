import { LogOut, ShieldAlert } from "lucide-react";
import LoginPage from "../components/auth/LoginPage";
import { useAuth } from "../contexts/useAuth";
import UsersSection from "./sections/UsersSection";
import WorkspacesSection from "./sections/WorkspacesSection";
import SmtpSection from "./sections/SmtpSection";
import TestSendSection from "./sections/TestSendSection";

const ACCENT = "#005bff";

export default function SysadminApp() {
  const { user, loading, logout } = useAuth();

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

  if (!user) return <LoginPage />;

  if (!user.isSysadmin) {
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
        <div className="card" style={{ maxWidth: 480 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
              color: "var(--err)",
            }}
          >
            <ShieldAlert size={20} />
            <strong>Доступ запрещён</strong>
          </div>
          <p>
            Консоль администратора платформы доступна только пользователям с
            правами <b>sysadmin</b>. Ваш аккаунт <b>{user.email}</b> сюда
            доступа не имеет.
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            Если у вас есть рабочее пространство — откройте основное приложение
            калькулятора.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void logout()}
            style={{ padding: "8px 16px", marginTop: 8 }}
          >
            <LogOut size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Выйти
          </button>
        </div>
      </div>
    );
  }

  document.documentElement.style.setProperty("--accent", ACCENT);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
            <rect width="32" height="32" rx="8" fill={ACCENT} />
            <text
              x="16"
              y="22"
              textAnchor="middle"
              fill="white"
              fontFamily="Inter, sans-serif"
              fontWeight="800"
              fontSize="14"
            >
              Sa
            </text>
          </svg>
          <div className="app-header-text">
            <div className="app-title">
              <span className="app-title-full">Sysadmin Console — Ozon Profit Calculator</span>
              <span className="app-title-short">Sysadmin</span>
            </div>
            <div className="app-subtitle">
              Платформенная консоль · пользователи, команды, SMTP
            </div>
          </div>
          <div className="app-header-user">
            <div
              className="app-header-user-text"
              style={{ textAlign: "right", lineHeight: 1.2 }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user.email}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                sysadmin
              </div>
            </div>
            <button
              type="button"
              className="btn-icon"
              onClick={() => void logout()}
              title="Выйти"
              aria-label="Выйти"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <UsersSection meId={user.id} />
          <WorkspacesSection />
          <SmtpSection />
          <TestSendSection />
        </div>
      </main>
    </div>
  );
}
