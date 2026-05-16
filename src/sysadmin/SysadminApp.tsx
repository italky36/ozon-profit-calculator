import { useState } from "react";
import {
  Grid3x3,
  LogOut,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";
import SysadminLoginPage from "./SysadminLoginPage";
import { useAuth } from "../contexts/useAuth";
import { Avatar } from "./atoms";
import { useNarrow } from "./utils";
import UsersSection from "./sections/UsersSection";
import WorkspacesSection from "./sections/WorkspacesSection";
import SmtpSection from "./sections/SmtpSection";

const ACCENT = "#1e293b";

type TabId = "users" | "workspaces" | "smtp";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

export default function SysadminApp() {
  const { user, loading, logout } = useAuth();
  const narrow = useNarrow();
  const [tab, setTab] = useState<TabId>("users");
  const [usersCount, setUsersCount] = useState<number | undefined>(undefined);
  const [workspacesCount, setWorkspacesCount] = useState<number | undefined>(
    undefined,
  );

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

  if (!user) return <SysadminLoginPage />;

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

  const tabs: TabDef[] = [
    {
      id: "users",
      label: "Пользователи",
      icon: <UsersIcon size={15} />,
      count: usersCount,
    },
    {
      id: "workspaces",
      label: "Команды",
      icon: <Grid3x3 size={15} />,
      count: workspacesCount,
    },
    { id: "smtp", label: "SMTP", icon: <Mail size={15} /> },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: narrow ? 10 : 14,
          padding: narrow ? "10px 14px" : "14px 22px",
          background: "#fff",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: narrow ? 34 : 40,
            height: narrow ? 34 : 40,
            borderRadius: narrow ? 9 : 10,
            background: "linear-gradient(135deg, #1e293b, #0f172a)",
            color: "#fff",
            fontWeight: 700,
            fontSize: narrow ? 13 : 15,
            letterSpacing: 0.4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 1px 0 rgba(255,255,255,.06) inset, 0 1px 2px rgba(15,23,42,.18)",
            flex: "0 0 auto",
          }}
        >
          Sa
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: narrow ? 14 : 16,
                fontWeight: 700,
                letterSpacing: -0.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Sysadmin{narrow ? "" : " Console"}
            </h1>
            {!narrow && (
              <>
                <span style={{ color: "#94a3b8", fontSize: 14 }}>—</span>
                <span
                  style={{
                    color: "var(--muted)",
                    fontSize: 14,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Profit Calculator
                </span>
              </>
            )}
          </div>
          {!narrow && (
            <div
              style={{ marginTop: 2, fontSize: 12, color: "var(--muted)" }}
            >
              Платформенная консоль · пользователи, команды, SMTP
            </div>
          )}
          {narrow && (
            <div
              style={{
                marginTop: 1,
                fontSize: 11,
                color: "var(--muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {user.email}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: narrow ? 6 : 10,
            flex: "0 0 auto",
          }}
        >
          {!narrow && (
            <div style={{ textAlign: "right", lineHeight: 1.2 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
                {user.email}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  justifyContent: "flex-end",
                }}
              >
                <ShieldCheck size={11} />
                sysadmin
              </div>
            </div>
          )}
          <Avatar name={user.email} size={narrow ? 32 : 36} />
          {narrow ? (
            <button
              type="button"
              title="Выйти"
              onClick={() => void logout()}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "#fff",
                color: "#0f172a",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LogOut size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void logout()}
              style={{
                height: 36,
                padding: "0 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "#fff",
                color: "#0f172a",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "inherit",
              }}
            >
              <LogOut size={15} />
              Выйти
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: narrow ? "6px 10px 0" : "10px 22px 0",
          background: "transparent",
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((t) => {
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: narrow ? "9px 11px 11px" : "10px 14px 12px",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: narrow ? 13 : 13.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#0f172a" : "var(--muted)",
                borderBottom:
                  "2px solid " + (isActive ? "#0f172a" : "transparent"),
                marginBottom: -1,
                whiteSpace: "nowrap",
                flex: "0 0 auto",
              }}
            >
              {t.icon}
              {t.label}
              {t.count != null && (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 999,
                    background: isActive ? "#0f172a" : "#f1f5f9",
                    color: isActive ? "#fff" : "var(--muted)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: 0.2,
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <main
        style={{
          padding: narrow ? "12px 10px 60px" : "18px 22px 60px",
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        {tab === "users" && (
          <UsersSection
            meId={user.id}
            narrow={narrow}
            onCountChange={setUsersCount}
          />
        )}
        {tab === "workspaces" && (
          <WorkspacesSection
            narrow={narrow}
            onCountChange={setWorkspacesCount}
          />
        )}
        {tab === "smtp" && <SmtpSection narrow={narrow} />}
      </main>
    </div>
  );
}
