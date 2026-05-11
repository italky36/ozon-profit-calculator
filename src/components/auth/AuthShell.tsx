import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthShell({ title, subtitle, children, footer }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg, #f7f8fa)",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <svg width="36" height="36" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
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
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {subtitle && <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>}
          </div>
        </div>
        {children}
        {footer && (
          <div style={{ marginTop: 16, fontSize: 13, textAlign: "center" }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        background: "#FEEFEF",
        border: "1px solid #FFB3B3",
        color: "#a01313",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      {message}
    </div>
  );
}

export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      style={{
        background: "#EAF6EC",
        border: "1px solid #B7DFC0",
        color: "#1f6b34",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      {message}
    </div>
  );
}

interface FieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}

export function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required,
  minLength,
}: FieldProps) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const effectiveType = isPassword && revealed ? "text" : type;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
        {label}
      </span>
      <div style={{ position: "relative" }}>
        <input
          type={effectiveType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          style={{
            padding: "8px 12px",
            paddingRight: isPassword ? 40 : 12,
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 14,
            fontFamily: "inherit",
            background: "#fff",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Скрыть пароль" : "Показать пароль"}
            title={revealed ? "Скрыть пароль" : "Показать пароль"}
            tabIndex={-1}
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              borderRadius: 6,
            }}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </label>
  );
}

/** Convenience submit handler that runs an async fn, surfacing errors via setError. */
export function useSubmit(
  fn: () => Promise<void>,
  setError: (e: string | null) => void,
): { submitting: boolean; onSubmit: (e: FormEvent) => void } {
  const [submitting, setSubmitting] = useState(false);
  return {
    submitting,
    onSubmit: (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setSubmitting(true);
      fn()
        .catch((err: Error) => setError(err.message))
        .finally(() => setSubmitting(false));
    },
  };
}
