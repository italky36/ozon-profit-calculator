interface Props {
  code: string;
  color: string | null;
  /** Tooltip / aria-label, обычно — название магазина. */
  title?: string;
  size?: "sm" | "md";
  /** Когда true — маленький значок «общий магазин» в верхнем правом углу. */
  shared?: boolean;
}

/** Двухсимвольный бейдж магазина. Заменяет «Oz»-иконку в таблице товаров. */
export default function ShopBadge({
  code,
  color,
  title,
  size = "sm",
  shared = false,
}: Props) {
  const dims =
    size === "md"
      ? { padding: "3px 8px", fontSize: 12, minWidth: 28 }
      : { padding: "2px 6px", fontSize: 11, minWidth: 24 };
  return (
    <span
      className="shop-badge"
      title={
        shared && title ? `${title} (общий магазин)` : (title ?? undefined)
      }
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...dims,
        height: "fit-content",
        borderRadius: 5,
        fontWeight: 700,
        letterSpacing: 0.5,
        lineHeight: 1.2,
        color: color ? "#fff" : "var(--accent)",
        background:
          color ?? "color-mix(in srgb, var(--accent) 18%, transparent)",
        border: color
          ? `1px solid ${color}`
          : "1px solid color-mix(in srgb, var(--accent) 32%, transparent)",
        userSelect: "none",
      }}
    >
      {code}
      {shared && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -5,
            right: -5,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "1.5px solid var(--bg, #fff)",
          }}
        />
      )}
    </span>
  );
}
