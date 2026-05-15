import type { CSSProperties } from "react";

export const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
  fontWeight: 600,
};

export const td: CSSProperties = {
  padding: "10px",
  verticalAlign: "middle",
};

export const fieldRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 200px) 1fr",
  gap: 10,
  alignItems: "center",
  marginBottom: 8,
};

export const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  fontWeight: 500,
};

export const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontFamily: "inherit",
  fontSize: 13,
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};

export const errBox: CSSProperties = {
  background: "#FEEFEF",
  border: "1px solid #FFB3B3",
  color: "#a01313",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 12,
};

export const okBox: CSSProperties = {
  background: "#EAF6EC",
  border: "1px solid #B7DFC0",
  color: "#1f6b34",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 13,
  marginBottom: 12,
};

export const badge: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--border-soft)",
  color: "var(--muted)",
  fontWeight: 600,
};
