import { useEffect, useRef, useState } from "react";
import { LogOut, Users } from "lucide-react";
import { useAuth } from "../contexts/useAuth";
import { api } from "../api";
import WorkspaceBrandingPopover from "./WorkspaceBrandingPopover";

interface Props {
  accent: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

interface WorkspaceState {
  name: string;
  color: string | null;
  logoDataUrl: string | null;
}

export default function AppHeader({ accent }: Props) {
  const { user, logout } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number } | null>(
    null,
  );
  const badgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!user || !user.workspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    void api.workspace
      .me()
      .then((info) => {
        if (!cancelled)
          setWorkspace({
            name: info.name,
            color: info.color,
            logoDataUrl: info.logoDataUrl,
          });
      })
      .catch(() => {
        /* best-effort — header is non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const openPopover = () => {
    const rect = badgeRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchorRect({ left: rect.left, top: rect.bottom });
    setPopoverOpen(true);
  };

  const badgeColor = workspace?.color ?? accent;
  const badgeBg = `color-mix(in srgb, ${badgeColor} 12%, transparent)`;

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
            {workspace && (
              <button
                ref={badgeRef}
                type="button"
                className="app-header-workspace"
                title={`Команда: ${workspace.name} — нажмите, чтобы настроить брендинг`}
                onClick={openPopover}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: badgeBg,
                  color: badgeColor,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid transparent",
                  cursor: "pointer",
                  font: "inherit",
                  fontFamily: "inherit",
                  lineHeight: 1.4,
                }}
              >
                {workspace.logoDataUrl ? (
                  <img
                    src={workspace.logoDataUrl}
                    alt=""
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <Users size={14} />
                )}
                <span>{workspace.name}</span>
              </button>
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
      {popoverOpen && workspace && anchorRect && (
        <WorkspaceBrandingPopover
          workspaceName={workspace.name}
          initialColor={workspace.color}
          initialLogo={workspace.logoDataUrl}
          canEdit={user?.workspaceRole === "owner"}
          anchorRect={anchorRect}
          onClose={() => setPopoverOpen(false)}
          onUpdated={(next) =>
            setWorkspace((prev) =>
              prev ? { ...prev, color: next.color, logoDataUrl: next.logoDataUrl } : prev,
            )
          }
        />
      )}
    </header>
  );
}
