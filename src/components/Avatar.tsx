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
}

export default function Avatar({
  name,
  avatarDataUrl,
  email,
  size = 32,
}: AvatarProps) {
  if (avatarDataUrl) {
    return (
      <img
        src={avatarDataUrl}
        alt=""
        aria-hidden
        style={{
          width: size,
          height: size,
          borderRadius: size,
          objectFit: "cover",
          flex: "0 0 auto",
          display: "inline-block",
        }}
      />
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
    <div
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
        flex: "0 0 auto",
        letterSpacing: 0.2,
        userSelect: "none",
      }}
    >
      {letters}
    </div>
  );
}
