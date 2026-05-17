import { useEffect, useRef, useState } from "react";

/** Curated emoji set grouped by category. Not full unicode — just the ~50
 * most-used in team chat. Future enhancement (Stage 6+): swap for a real
 * picker library. */
const EMOJI_GROUPS: Array<{ label: string; items: string[] }> = [
  {
    label: "Лица",
    items: [
      "😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤔",
      "😅", "😇", "🙃", "😉", "😴", "🤯", "😱", "🥳",
    ],
  },
  {
    label: "Жесты",
    items: ["👍", "👎", "👌", "✌️", "🤝", "🙏", "👏", "🙌", "💪", "🤞"],
  },
  {
    label: "Сердца",
    items: ["❤️", "💔", "💕", "💯", "💥", "✨", "🔥"],
  },
  {
    label: "Знаки",
    items: ["✅", "❌", "⚠️", "❓", "❗", "⭐", "💡", "📌", "🚀", "🎉", "🎊"],
  },
  {
    label: "Еда",
    items: ["☕", "🍕", "🍔", "🍣", "🍩", "🍺", "🍷", "🥤"],
  },
];

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Where to anchor the popover relative to parent. Default: above-left. */
  anchor?: "above-left" | "above-right";
}

export default function EmojiPicker({
  onPick,
  onClose,
  anchor = "above-left",
}: Props) {
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on click outside.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    // Defer registration so the opening click doesn't immediately close us.
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  const groups = filter.trim()
    ? EMOJI_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter(() =>
          // Crude — actual emoji search by name needs a name table. Filter is
          // mostly a no-op until we ship that; left as a hook for users who
          // want to clear quickly via the X.
          true,
        ),
      }))
    : EMOJI_GROUPS;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        bottom: "100%",
        ...(anchor === "above-right" ? { right: 4 } : { left: 4 }),
        marginBottom: 8,
        background: "var(--bg, #fff)",
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 8,
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
        padding: 8,
        width: 340,
        maxHeight: 260,
        overflowY: "auto",
        overflowX: "hidden",
        zIndex: 20,
      }}
      role="dialog"
    >
      {filter !== "" && (
        <div
          style={{
            fontSize: 11,
            color: "var(--muted, #888)",
            marginBottom: 6,
          }}
        >
          Очистите поиск, чтобы увидеть все эмодзи.
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted, #888)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            {g.label}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 2,
            }}
          >
            {g.items.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onPick(emoji)}
                title={emoji}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 20,
                  lineHeight: 1,
                  padding: 4,
                  borderRadius: 4,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--accent-soft, #eef)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "transparent";
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* Hidden filter input — placeholder for future search-by-name. */}
      <input
        type="hidden"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
    </div>
  );
}
