import { LogOut } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  accent: string;
}

export default function AppHeader({ accent }: Props) {
  const { user, logout } = useAuth();
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
        <div>
          <div className="app-title">Калькулятор прибыли продавца Ozon</div>
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
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ textAlign: "right", lineHeight: 1.2 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user.email}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {user.role === "admin" ? "администратор" : "пользователь"}
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
