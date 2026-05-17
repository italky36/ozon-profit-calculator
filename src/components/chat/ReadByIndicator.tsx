import type { WorkspaceMember } from "../../api";
import Avatar from "../Avatar";

interface Props {
  /** UserIds (without the author) whose read pointer covers this message. */
  readerUserIds: number[];
  /** Workspace member roster, for resolving names + avatars. */
  members: WorkspaceMember[];
}

const MAX_AVATARS = 3;

/** Compact «who-read-this» strip — up to N tiny avatars, then «+M». Full
 * names live in the `title` tooltip. No leading text: the meaning is set by
 * the adjacent ReadStatusTicks (✓✓ ⟶ «эти прочитали»). */
export default function ReadByIndicator({ readerUserIds, members }: Props) {
  if (readerUserIds.length === 0) return null;
  const roster = new Map(members.map((m) => [m.userId, m]));
  const resolved = readerUserIds
    .map((id) => roster.get(id))
    .filter((m): m is WorkspaceMember => m != null);
  if (resolved.length === 0) return null;

  const head = resolved.slice(0, MAX_AVATARS);
  const tail = resolved.length - head.length;
  const allNames = resolved
    .map((m) => m.fullName || m.email.split("@")[0] || `user${m.userId}`)
    .join(", ");

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        cursor: "default",
        flex: "0 0 auto",
      }}
      title={`Прочитали: ${allNames}`}
    >
      {head.map((m) => (
        <Avatar
          key={m.userId}
          name={m.fullName}
          email={m.email}
          avatarDataUrl={m.avatarDataUrl}
          size={16}
        />
      ))}
      {tail > 0 && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: "0 4px",
            borderRadius: 8,
            background: "var(--bg-soft, #f0f0f0)",
            color: "var(--muted, #666)",
          }}
        >
          +{tail}
        </span>
      )}
    </span>
  );
}
