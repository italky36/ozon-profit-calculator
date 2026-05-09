import { Archive, CircleSlash, EyeOff } from "lucide-react";
import type { Inactivity } from "../lib/ozonStatus";

interface Props {
  inactivity: Inactivity;
}

export default function InactivityBadge({ inactivity }: Props) {
  if (!inactivity.kind) return null;
  const { kind, reason } = inactivity;
  const Icon =
    kind === "archived" ? Archive : kind === "hidden" ? EyeOff : CircleSlash;
  const cls =
    kind === "archived"
      ? "inactive-archive"
      : kind === "hidden"
        ? "inactive-hidden"
        : "inactive-warn";
  return (
    <span
      className={`inactive-badge ${cls}`}
      title={reason}
      aria-label={reason}
    >
      <Icon size={12} />
    </span>
  );
}
