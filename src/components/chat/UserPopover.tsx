import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare } from "lucide-react";
import Avatar from "../Avatar";

interface PopoverUser {
  userId: number;
  email: string;
  fullName: string;
  jobTitle?: string | null;
  avatarDataUrl?: string | null;
}

interface Props {
  user: PopoverUser;
  /** Bounding rect of the trigger element (avatar/mention span). Popover
   *  is positioned just below or above this rect depending on viewport
   *  space. Pass null while closed. */
  anchor: DOMRect | null;
  open: boolean;
  /** True when this popover represents the current user — hides the DM
   *  button («нельзя написать самому себе»). */
  isSelf?: boolean;
  /** When non-null, presence dot is shown on the avatar. */
  isOnline?: boolean;
  onClose: () => void;
  onOpenDm: (userId: number) => void;
}

const POPOVER_W = 240;
const POPOVER_GAP = 6;

/** Lightweight portal popover for a workspace member: avatar + name +
 * optional job title + «Написать в личку» button. Positioned right under
 * (or above, if near bottom of viewport) the anchor element. Click
 * outside / Esc / scroll closes it.
 *
 * Why portal + anchor rect, not parent-relative positioning: avatars and
 * @mentions sit inside scrollable message feeds — a relative-positioned
 * popover would either clip at the feed edge or get cut by `overflow:
 * auto`. Portal escapes both and lets us compute viewport-aware position
 * once at open time. */
export default function UserPopover({
  user,
  anchor,
  open,
  isSelf,
  isOnline,
  onClose,
  onOpenDm,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Compute position whenever the anchor rect changes (or the popover
  // opens). useLayoutEffect ensures we read the rect after the DOM commits
  // but before paint, so there's no «flash at 0,0» on first frame.
  useLayoutEffect(() => {
    if (!open || !anchor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos(null);
      return;
    }
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    // Default: just below the anchor, left-aligned with it. Flip up if
    // there's not enough space below; clamp inside viewport horizontally.
    let left = anchor.left;
    let top = anchor.bottom + POPOVER_GAP;
    // Estimate height = 120px before we measure; final position settles
    // after layout. For a tooltip this is enough.
    const estH = ref.current?.offsetHeight ?? 130;
    if (top + estH > viewportH - 8 && anchor.top - estH - POPOVER_GAP > 8) {
      top = anchor.top - estH - POPOVER_GAP;
    }
    left = Math.max(8, Math.min(left, viewportW - POPOVER_W - 8));
    top = Math.max(8, top);
    setPos({ left, top });
  }, [open, anchor]);

  // Click outside / Esc close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    // Close on scroll — anchor moves, position would be stale. Cheaper to
    // dismiss than recompute.
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  const displayName = user.fullName || user.email.split("@")[0] || "—";
  const role = user.jobTitle?.trim() || null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Профиль ${displayName}`}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 1100,
        width: POPOVER_W,
        background: "var(--bg, #fff)",
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar
          name={user.fullName}
          email={user.email}
          avatarDataUrl={user.avatarDataUrl}
          size={40}
          isOnline={isOnline}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </div>
          {role && (
            <div
              style={{
                fontSize: 12,
                color: "var(--muted, #888)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {role}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: "var(--muted, #aaa)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.email}
          </div>
        </div>
      </div>
      {!isSelf && (
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenDm(user.userId);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <MessageSquare size={14} />
          Написать в личку
        </button>
      )}
    </div>,
    document.body,
  );
}
