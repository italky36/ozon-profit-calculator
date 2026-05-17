import { useState } from "react";
import { SmilePlus } from "lucide-react";
import type { ChatReactionAggregate } from "../../api";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "🤔", "👀", "🔥", "✅"];

interface Props {
  reactions: ChatReactionAggregate[];
  currentUserId: number;
  onToggle: (emoji: string, mine: boolean) => void;
}

export default function ReactionsBar({
  reactions,
  currentUserId,
  onToggle,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasAny = reactions.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginTop: hasAny ? 6 : 2,
        alignItems: "center",
      }}
    >
      {reactions.map((r) => {
        const mine = r.userIds.includes(currentUserId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji, mine)}
            title={mine ? "Убрать вашу реакцию" : "Добавить реакцию"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 12,
              border: `1px solid ${mine ? "var(--accent)" : "var(--border, #e2e2e2)"}`,
              background: mine ? "var(--accent-soft, #eef)" : "var(--bg-soft, #fafafa)",
              cursor: "pointer",
              fontSize: 12,
              lineHeight: 1.2,
            }}
          >
            <span style={{ fontSize: 14 }}>{r.emoji}</span>
            <span style={{ fontWeight: mine ? 600 : 400 }}>{r.count}</span>
          </button>
        );
      })}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn-icon"
          onClick={() => setPickerOpen((v) => !v)}
          title="Добавить реакцию"
          style={{ padding: 2, opacity: 0.6 }}
        >
          <SmilePlus size={14} />
        </button>
        {pickerOpen && (
          <>
            <div
              onClick={() => setPickerOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 10,
              }}
            />
            <div
              role="menu"
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                marginBottom: 4,
                background: "var(--bg, #fff)",
                border: "1px solid var(--border, #e2e2e2)",
                borderRadius: 8,
                padding: 4,
                display: "flex",
                gap: 2,
                zIndex: 11,
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              }}
            >
              {QUICK_EMOJI.map((e) => {
                const existing = reactions.find((r) => r.emoji === e);
                const mine = existing?.userIds.includes(currentUserId) ?? false;
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onToggle(e, mine);
                      setPickerOpen(false);
                    }}
                    title={e}
                    style={{
                      border: "none",
                      background: mine ? "var(--accent-soft, #eef)" : "transparent",
                      cursor: "pointer",
                      fontSize: 18,
                      padding: "4px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
