/** Shared avatar: renders an uploaded image when `avatarDataUrl` is present,
 * otherwise initials derived from `name` (or `email` fallback) on a deterministic
 * pastel background. Used by both the workspace SPA and the sysadmin SPA. */
export interface AvatarProps {
  /** Display name — drives initials + color when no avatar is uploaded. */
  name: string;
  /** Optional inline base64 image. ≤200 KB by upload policy. */
  avatarDataUrl?: string | null;
  /** Fallback identifier when `name` is empty — typically the user's email. */
  email?: string;
  size?: number;
  /** When true, renders a green presence dot in the bottom-right corner. */
  isOnline?: boolean;
}

function PresenceDot({ size }: { size: number }) {
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <span
      aria-hidden
      title="онлайн"
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: dot,
        height: dot,
        borderRadius: dot,
        background: "#22c55e",
        border: "2px solid var(--bg, #fff)",
        boxSizing: "border-box",
      }}
    />
  );
}

export default function Avatar({
  name,
  avatarDataUrl,
  email,
  size = 32,
  isOnline,
}: AvatarProps) {
  if (avatarDataUrl) {
    return (
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: size,
          height: size,
          flex: "0 0 auto",
        }}
      >
        <img
          src={avatarDataUrl}
          alt=""
          aria-hidden
          style={{
            width: size,
            height: size,
            borderRadius: size,
            objectFit: "cover",
            display: "block",
          }}
        />
        {isOnline && <PresenceDot size={size} />}
      </span>
    );
  }
  const source = (name || email || "?").trim();
  const letters = source
    .split(/[\s@.+_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  let h = 0;
  for (const ch of source) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const bg = `hsl(${h} 60% 92%)`;
  const fg = `hsl(${h} 45% 30%)`;
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "0 0 auto",
        verticalAlign: "middle",
        // Suppress text-baseline contribution from inner inline-flex/text
        // content — keeps the avatar's baseline at bottom-edge so it lines
        // up identically with photo-variant (which has no text).
        lineHeight: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: size,
          background: bg,
          color: fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600,
          fontSize: Math.round(size * 0.4),
          letterSpacing: 0.2,
          userSelect: "none",
        }}
      >
        {letters}
      </span>
      {isOnline && <PresenceDot size={size} />}
    </span>
  );
}
