import { useEffect, useRef } from "react";
import Avatar from "../Avatar";
import type { WorkspaceMember } from "../../api";

interface Props {
  candidates: WorkspaceMember[];
  selectedIdx: number;
  onPick: (member: WorkspaceMember) => void;
  onHoverIdx: (idx: number) => void;
}

export default function MentionAutocomplete({
  candidates,
  selectedIdx,
  onPick,
  onHoverIdx,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the selected item in view when arrow-keys traverse the list.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-idx="${selectedIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (candidates.length === 0) return null;
  return (
    <div
      ref={listRef}
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        marginBottom: 4,
        background: "var(--bg, #fff)",
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        maxHeight: 200,
        overflowY: "auto",
        minWidth: 240,
        zIndex: 12,
      }}
    >
      {candidates.map((c, idx) => {
        const active = idx === selectedIdx;
        const display = c.fullName || c.email.split("@")[0] || "—";
        return (
          <button
            key={c.userId}
            type="button"
            data-idx={idx}
            onMouseDown={(e) => {
              // Use mousedown so we trigger before the textarea's onBlur closes
              // the dropdown.
              e.preventDefault();
              onPick(c);
            }}
            onMouseEnter={() => onHoverIdx(idx)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 10px",
              border: "none",
              background: active ? "var(--accent-soft, #eef)" : "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Avatar
              name={c.fullName}
              email={c.email}
              avatarDataUrl={c.avatarDataUrl}
              size={24}
            />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{display}</span>
              {c.jobTitle && (
                <span style={{ fontSize: 11, color: "var(--muted, #888)" }}>
                  {c.jobTitle}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
