import { useEffect, useState } from "react";
import { LogOut, Users } from "lucide-react";
import { useAuth } from "../contexts/useAuth";
import { api } from "../api";

interface Props {
  accent: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

export default function AppHeader({ accent }: Props) {
  const { user, logout } = useAuth();
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !user.workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWorkspaceName(null);
      return;
    }
    let cancelled = false;
    void api.workspace
      .me()
      .then((info) => {
        if (!cancelled) setWorkspaceName(info.name);
      })
      .catch(() => {
        /* best-effort — header is non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect width="32" height="32" rx="8" fill={accent} />
          <text
            x="16"
            y="22"
            textAnchor="middle"
            fill="white"
            fontFamily="Inter, sans-serif"
            fontWeight="800"
            fontSize="14"
          >
            Oz
          </text>
        </svg>
        <div className="app-header-text">
          <div className="app-title">
            <span className="app-title-full">Калькулятор прибыли продавца Ozon</span>
            <span className="app-title-short">Калькулятор Ozon</span>
          </div>
          <div className="app-subtitle">
            Сравнение{" "}
            <span style={{ color: "var(--ch-fbo-text)", fontWeight: 600 }}>FBO</span>
            {" / "}
            <span style={{ color: "var(--ch-fbs-text)", fontWeight: 600 }}>FBS</span>
            {" / "}
            <span style={{ color: "var(--ch-real-text)", fontWeight: 600 }}>realFBS</span>
            {" "}по марже и налогам
          </div>
        </div>
        {user && (
          <div className="app-header-user">
            {workspaceName && (
              <div
                className="app-header-workspace"
                title={`Команда: ${workspaceName}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                  color: "var(--accent)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <Users size={14} />
                <span>{workspaceName}</span>
              </div>
            )}
            <div className="app-header-user-text" style={{ textAlign: "right", lineHeight: 1.2 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user.email}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {user.isSysadmin
                  ? "sysadmin"
                  : ROLE_LABEL[user.workspaceRole] ?? "пользователь"}
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
        )}
      </div>
    </header>
  );
}
