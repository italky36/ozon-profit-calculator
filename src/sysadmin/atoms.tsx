import { useState, type CSSProperties, type ReactNode } from "react";
import { Check as CheckIcon } from "lucide-react";

export { default as Avatar } from "../components/Avatar";

export type PillTone = "ok" | "warn" | "off" | "bad";

const PILL_TONES: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  ok: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
  warn: { bg: "#fffbeb", fg: "#a16207", dot: "#f59e0b" },
  off: { bg: "#f1f5f9", fg: "#64748b", dot: "#94a3b8" },
  bad: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
};

export function StatusPill({
  tone = "ok",
  children,
  icon,
}: {
  tone?: PillTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const t = PILL_TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px 3px 8px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        fontWeight: 600,
        fontSize: 11.5,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {icon ? (
        icon
      ) : (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 6,
            background: t.dot,
          }}
        />
      )}
      {children}
    </span>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange?.(!on)}
      disabled={disabled}
      aria-label={label}
      aria-checked={on}
      role="switch"
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        padding: 0,
        border: 0,
        background: on ? "var(--accent)" : "#cbd5e1",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background .15s",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 1px 2px rgba(15,23,42,.25)",
          transition: "left .15s",
        }}
      />
    </button>
  );
}

export function RowAction({
  icon,
  title,
  tone = "default",
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title?: string;
  tone?: "default" | "danger";
  onClick?: () => void;
  disabled?: boolean;
}) {
  const tones = {
    default: { fg: "var(--muted)", hoverBg: "#f1f5f9", hoverFg: "#0f172a" },
    danger: { fg: "#b91c1c", hoverBg: "#fef2f2", hoverFg: "#991b1b" },
  };
  const t = tones[tone];
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        padding: 0,
        border:
          "1px solid " +
          (hover
            ? tone === "danger"
              ? "#fecaca"
              : "var(--border)"
            : "transparent"),
        background: hover ? t.hoverBg : "transparent",
        color: hover ? t.hoverFg : t.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .12s",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon}
    </button>
  );
}

export function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  accent: { bg: string; fg: string };
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "14px 16px",
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: accent.bg,
          color: accent.fg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontWeight: 500,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#0f172a",
            letterSpacing: -0.3,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export function Section({
  icon,
  title,
  count,
  action,
  headerRight,
  children,
}: {
  icon?: ReactNode;
  title: string;
  count?: number;
  action?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 1px 0 rgba(15,23,42,0.02)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px 12px",
          borderBottom: "1px solid var(--border-soft)",
          flexWrap: "wrap",
        }}
      >
        {icon}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: -0.1 }}>
          {title}
        </h3>
        {count != null && (
          <span
            style={{
              minWidth: 20,
              height: 20,
              padding: "0 6px",
              borderRadius: 999,
              background: "#f1f5f9",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        )}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {headerRight}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

const TH_STYLE: CSSProperties = {
  textAlign: "left",
  padding: "10px 18px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: "uppercase",
  color: "var(--muted)",
  borderBottom: "1px solid var(--border-soft)",
  whiteSpace: "nowrap",
};

export function Th({
  children,
  align = "left",
  width,
}: {
  children: ReactNode;
  align?: "left" | "center" | "right";
  width?: number;
}) {
  return (
    <th
      style={{
        ...TH_STYLE,
        textAlign: align,
        width,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  style = {},
}: {
  children: ReactNode;
  align?: "left" | "center" | "right";
  style?: CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "14px 18px",
        textAlign: align,
        borderBottom: "1px solid var(--border-soft)",
        color: "#0f172a",
        verticalAlign: "middle",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

export function CheckOk({ size = 11 }: { size?: number }) {
  return <CheckIcon size={size} strokeWidth={2.5} />;
}

export function CheckBox({
  checked,
  indeterminate,
  onChange,
  size = 16,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  size?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        padding: 0,
        border:
          "1.5px solid " +
          (checked || indeterminate ? "var(--accent)" : "var(--border)"),
        background: checked || indeterminate ? "var(--accent)" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.45 : 1,
        flex: "0 0 auto",
        transition: "all .12s",
      }}
    >
      {checked && (
        <CheckIcon size={size - 6} color="#fff" strokeWidth={3} />
      )}
      {indeterminate && !checked && (
        <span
          style={{
            display: "block",
            width: size - 6,
            height: 2,
            background: "#fff",
            borderRadius: 1,
          }}
        />
      )}
    </button>
  );
}
