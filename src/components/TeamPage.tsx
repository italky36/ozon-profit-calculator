import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Ban,
  Check as CheckIcon,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Crown,
  Info,
  Lock,
  Mail,
  MailPlus,
  Minus,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Store as StoreIcon,
  Trash2,
  Unlock,
  UserPlus,
  UserX,
  Users,
  X,
} from "lucide-react";
import {
  api,
  type ShopAccessMatrix,
  type WorkspaceInfo,
  type WorkspaceInviteRow,
  type WorkspaceMember,
  type WorkspaceRole,
} from "../api";
import Avatar from "./Avatar";
import ProfileEditor from "./ProfileEditor";

// ===================================================================
// Types & helpers
// ===================================================================

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

const MOBILE_BREAKPOINT = 760;

interface ShopMeta {
  id: number;
  name: string;
  shortName: string;
  color: string | null;
  createdByUserId: number | null;
  createdByEmail: string | null;
  /** true if the current viewer can manage assignments to this shop. */
  canEdit: boolean;
}


/** Unified row type for the «people» list — real members and pending
 * invites share the same column shape. */
type PersonRow =
  | {
      kind: "member";
      key: string; // "u-{userId}"
      userId: number;
      email: string;
      fullName: string;
      jobTitle: string | null;
      avatarDataUrl: string | null;
      role: WorkspaceRole;
      isBlocked: boolean;
      createdAt: number;
      isYou: boolean;
      assignedShopIds: Set<number>;
    }
  | {
      kind: "invite";
      key: string; // "i-{token}"
      token: string;
      email: string;
      role: WorkspaceRole;
      expiresAt: number;
      invitedByEmail: string;
    };

const canManage = (role: WorkspaceRole | undefined) =>
  role === "owner" || role === "manager";

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtDateShort(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("ru-RU", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps every case-insensitive occurrence of `query` inside `text` in a
 * highlighted `<mark>`. Returns the raw string when query is empty so callers
 * stay text-only in the no-search path. */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const re = new RegExp(`(${escapeRegex(q)})`, "ig");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        style={{
          background: "color-mix(in srgb, var(--accent) 28%, transparent)",
          color: "inherit",
          padding: "0 1px",
          borderRadius: 2,
        }}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** Returns true if `query` viewport media-query is currently matched. */
function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// ===================================================================
// Atoms
// ===================================================================


const ROLE_PALETTE: Record<
  WorkspaceRole,
  { bg: string; fg: string; icon: ReactNode }
> = {
  owner: {
    bg: "rgba(180,83,9,0.12)",
    fg: "#b45309",
    icon: <Crown size={11} strokeWidth={2.2} />,
  },
  manager: {
    bg: "rgba(3,105,161,0.10)",
    fg: "#0369a1",
    icon: <ShieldCheck size={11} strokeWidth={2.2} />,
  },
  member: {
    bg: "rgba(15,23,42,0.06)",
    fg: "#1e293b",
    icon: <Users size={11} strokeWidth={2.2} />,
  },
};

function RoleBadge({ role }: { role: WorkspaceRole }) {
  const p = ROLE_PALETTE[role];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px 3px 7px",
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        fontWeight: 600,
        fontSize: 11.5,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {p.icon}
      {ROLE_LABEL[role]}
    </span>
  );
}

/** Clickable role badge with an accordion-style dropdown below. Replaces the
 * old `<select>` element — looks like a plain RoleBadge with a chevron and
 * expands to a list of role options on click. */
function RolePicker({
  value,
  options,
  onChange,
  disabled,
}: {
  value: WorkspaceRole;
  options: readonly WorkspaceRole[];
  onChange: (next: WorkspaceRole) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{
    left: number;
    top: number;
    bottom: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Scroll/resize invalidate the anchor position; cheaper to just close than
    // to chase the button around the viewport.
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const p = ROLE_PALETTE[value];

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r)
      setAnchorRect({ left: r.left, top: r.top, bottom: r.bottom });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 6px 3px 7px",
          borderRadius: 999,
          background: p.bg,
          color: p.fg,
          fontWeight: 600,
          fontSize: 11.5,
          lineHeight: 1,
          whiteSpace: "nowrap",
          border: "1px solid transparent",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          fontFamily: "inherit",
          transition: "border-color .12s, box-shadow .12s",
          boxShadow: open ? `0 0 0 2px ${p.fg}22` : "none",
        }}
      >
        {p.icon}
        {ROLE_LABEL[value]}
        <ChevronDown
          size={11}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
            marginLeft: 1,
          }}
        />
      </button>
      {open && anchorRect && createPortal(
        <div
          ref={popoverRef}
          role="listbox"
          style={{
            position: "fixed",
            top: anchorRect.bottom + 4,
            left: anchorRect.left,
            minWidth: 140,
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(15,23,42,.12)",
            padding: 4,
            zIndex: 1200,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            animation: "tp-popIn .12s ease-out",
          }}
        >
          {options.map((r) => {
            const isCurrent = r === value;
            const op = ROLE_PALETTE[r];
            return (
              <button
                key={r}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) onChange(r);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: isCurrent ? op.bg : "transparent",
                  color: isCurrent ? op.fg : "#0f172a",
                  border: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  fontWeight: isCurrent ? 600 : 500,
                  textAlign: "left",
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.background = "#f1f5f9";
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent)
                    e.currentTarget.style.background = "transparent";
                }}
              >
                {op.icon}
                {ROLE_LABEL[r]}
                {isCurrent && (
                  <CheckIcon
                    size={12}
                    strokeWidth={2.5}
                    style={{ marginLeft: "auto", color: op.fg }}
                  />
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

function RowIconBtn({
  icon,
  title,
  tone = "default",
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  tone?: "default" | "danger";
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const tones = {
    default: { fg: "var(--muted)", hoverBg: "#f1f5f9", hoverFg: "#0f172a", hoverBorder: "var(--border)" },
    danger: { fg: "#b91c1c", hoverBg: "#fef2f2", hoverFg: "#991b1b", hoverBorder: "#fecaca" },
  };
  const t = tones[tone];
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        padding: 0,
        border: "1px solid " + (hover && !disabled ? t.hoverBorder : "transparent"),
        background: hover && !disabled ? t.hoverBg : "transparent",
        color: hover && !disabled ? t.hoverFg : t.fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .12s, color .12s, border-color .12s",
      }}
    >
      {icon}
    </button>
  );
}

function PendingBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px 3px 7px",
        borderRadius: 999,
        background: "rgba(202,138,4,0.12)",
        color: "#a16207",
        fontWeight: 600,
        fontSize: 11.5,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <Clock size={11} strokeWidth={2.2} />
      ожидает
    </span>
  );
}

/** Compact action bar shown above the members table when one or more rows are
 * selected for bulk operations. Owner-only — the bar itself is only rendered
 * when selectedIds.size > 0 in the parent. */
function BulkBar({
  count,
  busy,
  onBlock,
  onUnblock,
  onDelete,
  onClear,
}: {
  count: number;
  busy: boolean;
  onBlock: () => void;
  onUnblock: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        margin: "12px 18px 0",
        padding: "8px 12px",
        background: "color-mix(in srgb, var(--accent) 8%, #fff)",
        border:
          "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--accent)", fontWeight: 600 }}>
        Выбрано: {count}
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        disabled={busy}
        onClick={onBlock}
        style={{
          padding: "6px 12px",
          border: "1px solid #fde68a",
          background: "#fffbeb",
          color: "#92400e",
          borderRadius: 7,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Lock size={13} />
        Заблокировать
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onUnblock}
        style={{
          padding: "6px 12px",
          border: "1px solid #a7f3d0",
          background: "#ecfdf5",
          color: "#047857",
          borderRadius: 7,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Unlock size={13} />
        Разблокировать
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        style={{
          padding: "6px 12px",
          border: "1px solid #fecaca",
          background: "#fef2f2",
          color: "#b91c1c",
          borderRadius: 7,
          fontSize: 12.5,
          fontWeight: 500,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <UserX size={13} />
        Удалить
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        style={{
          padding: "6px 10px",
          border: "1px solid transparent",
          background: "transparent",
          color: "var(--muted)",
          borderRadius: 7,
          fontSize: 12.5,
          cursor: busy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        Снять выделение
      </button>
    </div>
  );
}

/** Square chip showing a shop's `shortName` code. Color from shop.color or
 * brand fallback. */
function ShopCode({
  shop,
  size = 22,
  tone = "default",
}: {
  shop: ShopMeta;
  size?: number;
  tone?: "default" | "muted";
}) {
  const muted = tone === "muted";
  const bg = muted ? "#e2e8f0" : shop.color ?? "var(--accent)";
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        background: bg,
        color: muted ? "#475569" : "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.45),
        letterSpacing: 0.2,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        flex: "0 0 auto",
      }}
    >
      {shop.shortName}
    </span>
  );
}

function ShopChip({
  shop,
  size = "md",
  tone = "default",
}: {
  shop: ShopMeta;
  size?: "sm" | "md";
  tone?: "default" | "muted";
}) {
  const sizes = {
    sm: { pad: "2px 7px 2px 5px", font: 11, iconSize: 18, gap: 5, radius: 6 },
    md: { pad: "4px 9px 4px 5px", font: 12, iconSize: 22, gap: 6, radius: 7 },
  } as const;
  const s = sizes[size];
  const muted = tone === "muted";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        padding: s.pad,
        borderRadius: s.radius,
        background: muted ? "#f1f5f9" : "color-mix(in srgb, var(--accent) 10%, transparent)",
        color: muted ? "#475569" : "var(--accent)",
        fontWeight: 500,
        fontSize: s.font,
        lineHeight: 1.2,
        maxWidth: "100%",
      }}
    >
      <ShopCode shop={shop} size={s.iconSize} tone={tone} />
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {shop.name}
      </span>
    </span>
  );
}

/** Build the tooltip shown on a shop chip. If a grantor is known (the chip is
 * on the viewer's own row for a shop they don't own), surface «доступ от X»;
 * otherwise fall back to «создан X». */
function shopChipTitle(shop: ShopMeta, grantorEmail?: string | null): string {
  if (grantorEmail) return `${shop.name} · доступ от ${grantorEmail}`;
  if (shop.createdByEmail) return `${shop.name} · создан ${shop.createdByEmail}`;
  return shop.name;
}

/** «X из Y магазинов» pill with overlapping code chips. Click opens the
 * shop-access drawer/expander. Chips for shops the viewer can't manage are
 * rendered muted with a lock indicator. */
function AccessPill({
  count,
  total,
  accessed,
  disabled,
  onClick,
  grantorByShopId,
}: {
  count: number;
  total: number;
  accessed: ShopMeta[];
  disabled?: boolean;
  onClick?: () => void;
  /** Per-shop grantor email — used on the viewer's own row to attribute
   * externally-granted access. */
  grantorByShopId?: Map<number, string | null>;
}) {
  const previews = accessed.slice(0, 3);
  const more = Math.max(0, accessed.length - 3);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px 5px 6px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "#fff",
        cursor: disabled || !onClick ? "default" : "pointer",
        fontFamily: "inherit",
        transition: "background .12s, border-color .12s",
        maxWidth: "100%",
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled || !onClick) return;
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.background =
          "color-mix(in srgb, var(--accent) 6%, #fff)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "#fff";
      }}
    >
      <span style={{ display: "flex" }}>
        {previews.length === 0 ? (
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: "#f1f5f9",
              color: "#94a3b8",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
            }}
          >
            —
          </span>
        ) : (
          previews.map((s, i) => {
            const grantor = grantorByShopId?.get(s.id);
            const readOnly = !s.canEdit;
            return (
              <span
                key={s.id}
                title={shopChipTitle(s, grantor)}
                style={{
                  marginLeft: i > 0 ? -6 : 0,
                  border: "2px solid #fff",
                  borderRadius: 7,
                  display: "inline-flex",
                  position: "relative",
                }}
              >
                <ShopCode shop={s} size={22} tone={readOnly ? "muted" : "default"} />
                {readOnly && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      right: -2,
                      bottom: -2,
                      width: 11,
                      height: 11,
                      borderRadius: 11,
                      background: "#fff",
                      border: "1px solid #cbd5e1",
                      color: "#64748b",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Lock size={7} strokeWidth={2.5} />
                  </span>
                )}
              </span>
            );
          })
        )}
      </span>
      <span style={{ fontSize: 12.5, color: "#1e293b", fontWeight: 500 }}>
        {count === 0 ? (
          "нет доступа"
        ) : (
          <>
            <b>{count}</b>
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              {" "}
              из {total}
            </span>
          </>
        )}
      </span>
      {more > 0 && (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>+{more}</span>
      )}
      <ChevronRight size={12} style={{ color: "#94a3b8", marginLeft: "auto" }} />
    </button>
  );
}

function CheckBox({
  checked,
  onChange,
  size = 18,
  disabled,
  indeterminate,
}: {
  checked: boolean;
  onChange?: () => void;
  size?: number;
  disabled?: boolean;
  indeterminate?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.();
      }}
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        padding: 0,
        border:
          "1.5px solid " +
          (checked || indeterminate ? "var(--accent)" : "var(--border)"),
        background: checked || indeterminate ? "var(--accent)" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all .12s",
        opacity: disabled ? 0.45 : 1,
        flex: "0 0 auto",
      }}
    >
      {checked && <CheckIcon size={size - 6} color="#fff" strokeWidth={3} />}
      {indeterminate && !checked && (
        <Minus size={size - 6} color="#fff" strokeWidth={3} />
      )}
    </button>
  );
}

function Section({
  icon,
  title,
  count,
  action,
  headerRight,
  children,
}: {
  icon?: ReactNode;
  title: string;
  count?: number;
  action?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 1px 0 rgba(15,23,42,0.02)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px 12px",
          borderBottom: "1px solid var(--border-soft)",
          flexWrap: "wrap",
        }}
      >
        {icon}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: -0.1 }}>
          {title}
        </h3>
        {count != null && (
          <span
            style={{
              minWidth: 20,
              height: 20,
              padding: "0 6px",
              borderRadius: 999,
              background: "#f1f5f9",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        )}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {headerRight}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

// ===================================================================
// Body of the shop-access selector (used both in drawer and inline)
// ===================================================================

interface ShopAccessBodyProps {
  shops: ShopMeta[];
  selected: Set<number>;
  onToggle: (shopId: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  saved: boolean;
  /** Pulled out as prop so mobile + desktop can style differently. */
  variant: "drawer" | "inline";
  /** Read-only view (e.g. viewer opens their own access drawer). Disables
   * toggles and hides bulk select/clear. */
  readOnly?: boolean;
  /** Per-shop grantor email — used to attribute «доступ от X» under each shop
   * row when the viewer is looking at their own assignments. */
  grantorByShopId?: Map<number, string | null>;
}

function ShopAccessBody({
  shops,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  saved,
  variant,
  readOnly,
  grantorByShopId,
}: ShopAccessBodyProps) {
  const [search, setSearch] = useState("");
  const filtered = shops.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.shortName.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  });

  const inline = variant === "inline";

  return (
    <>
      <div
        style={{
          padding: inline ? "12px 12px 8px" : "14px 20px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          borderBottom: "1px solid var(--border-soft)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
            Доступ к магазинам
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            <b style={{ color: "#1e293b" }}>{selected.size}</b> из {shops.length}
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#94a3b8",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Поиск среди ${shops.length} магазинов`}
            style={{
              width: "100%",
              height: 32,
              padding: "0 12px 0 32px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "#fff",
              fontSize: 12.5,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={onSelectAll}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--accent)",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                Выбрать все
              </button>
              <button
                type="button"
                onClick={onClearAll}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--muted)",
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                Снять все
              </button>
            </>
          )}
          {readOnly && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                color: "var(--muted)",
              }}
            >
              <Info size={12} />
              просмотр без редактирования
            </span>
          )}
          <span style={{ flex: 1 }} />
          {saved && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: "#16a34a",
                fontWeight: 500,
                fontSize: 11.5,
              }}
            >
              <CheckIcon size={12} strokeWidth={2.5} />
              сохранено
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: inline ? "8px 10px 12px" : "8px 12px 16px",
        }}
      >
        {filtered.length === 0 && (
          <div
            style={{
              padding: "28px 8px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 12.5,
            }}
          >
            По запросу «{search}» ничего не найдено
          </div>
        )}
        {filtered.map((s) => {
          const on = selected.has(s.id);
          const toggleDisabled = readOnly || !s.canEdit;
          const grantor = grantorByShopId?.get(s.id);
          const attribution =
            grantor != null
              ? `доступ от ${grantor}`
              : s.createdByEmail
                ? `создан ${s.createdByEmail}`
                : null;
          return (
            <label
              key={s.id}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 11,
                padding: "9px 10px",
                borderRadius: 8,
                cursor: toggleDisabled ? "default" : "pointer",
                background: on
                  ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                  : "transparent",
                transition: "background .1s",
                marginBottom: 1,
              }}
              onMouseEnter={(e) => {
                if (!on && !toggleDisabled) e.currentTarget.style.background = "#f8fafc";
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.background = "transparent";
              }}
            >
              <CheckBox
                checked={on}
                onChange={toggleDisabled ? undefined : () => onToggle(s.id)}
                disabled={toggleDisabled}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <ShopChip shop={s} size="md" tone={on ? "default" : "muted"} />
                {attribution && (
                  <div
                    style={{
                      marginTop: 3,
                      marginLeft: 30,
                      fontSize: 11,
                      color: "var(--muted)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                    }}
                  >
                    {!s.canEdit && <Lock size={10} strokeWidth={2} />}
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {attribution}
                    </span>
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </>
  );
}

// ===================================================================
// Desktop drawer
// ===================================================================

interface DrawerProps {
  member: PersonRow & { kind: "member" };
  shops: ShopMeta[];
  onClose: () => void;
  onToggle: (shopId: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  saved: boolean;
  readOnly?: boolean;
  grantorByShopId?: Map<number, string | null>;
}

function ShopAccessDrawer(props: DrawerProps) {
  const {
    member,
    shops,
    onClose,
    onToggle,
    onSelectAll,
    onClearAll,
    saved,
    readOnly,
    grantorByShopId,
  } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.4)",
          zIndex: 1100,
          animation: "tp-fadeIn .15s ease",
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(460px, 92vw)",
          background: "#fff",
          boxShadow: "-30px 0 60px -20px rgba(15,23,42,.25)",
          display: "flex",
          flexDirection: "column",
          zIndex: 1101,
          animation: "tp-slideIn .22s cubic-bezier(.2,.7,.3,1)",
        }}
      >
        <header
          style={{
            padding: "18px 20px 16px",
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar
              name={member.fullName || member.email}
              avatarDataUrl={member.avatarDataUrl}
              email={member.email}
              size={40}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {member.fullName || member.email}
              </div>
              {member.jobTitle && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {member.jobTitle}
                </div>
              )}
              {member.fullName && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted-2)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {member.email}
                </div>
              )}
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <RoleBadge role={member.role} />
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  с {fmtDate(member.createdAt)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              style={{
                width: 34,
                height: 34,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
                color: "var(--muted)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {member.role === "owner" ? (
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: 13,
              color: "var(--muted)",
              lineHeight: 1.5,
            }}
          >
            <Info
              size={15}
              style={{ flex: "0 0 auto", marginTop: 1, color: "#b45309" }}
            />
            <span>
              Владелец автоматически видит все {shops.length} магазинов команды.
              Управление доступом для него не требуется.
            </span>
          </div>
        ) : (
          <ShopAccessBody
            shops={shops}
            selected={member.assignedShopIds}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
            onClearAll={onClearAll}
            saved={saved}
            variant="drawer"
            readOnly={readOnly}
            grantorByShopId={grantorByShopId}
          />
        )}

        <footer
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-soft)",
            background: "#f8fafc",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Info size={12} />
            {readOnly
              ? "Управление доступом — у владельца команды или создателя магазина"
              : "Изменения сохраняются автоматически"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: "6px 14px" }}
          >
            Готово
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

// ===================================================================
// Desktop member row
// ===================================================================

interface MemberRowProps {
  row: PersonRow;
  shops: ShopMeta[];
  shopsById: Map<number, ShopMeta>;
  isFirst: boolean;
  /** Workspace-level "canManage" (owner OR manager). Drives whether "..." actions are shown. */
  allowManage: boolean;
  /** Only true for workspace owner. Drives role-change controls. */
  isWorkspaceOwner: boolean;
  busy: boolean;
  selected: boolean;
  /** Active search query — highlighted inside name/email/job title. */
  searchQuery?: string;
  /** When this row is the current viewer's own row — maps shopId → grantor email
   * for shops the viewer didn't create. Used to attribute «доступ от X». */
  grantorByShopId?: Map<number, string | null>;
  onToggleSelect: () => void;
  onOpenAccess: (userId: number) => void;
  onChangeRole: (userId: number, role: WorkspaceRole) => void;
  onSetBlocked: (userId: number, email: string, blocked: boolean) => void;
  onDeleteAccount: (userId: number, email: string) => void;
  onRevokeInvite: (token: string, email: string) => void;
  onEditProfile: (userId: number) => void;
}

function MemberRow({
  row,
  shops,
  shopsById,
  isFirst,
  allowManage,
  isWorkspaceOwner,
  busy,
  selected,
  searchQuery,
  grantorByShopId,
  onToggleSelect,
  onOpenAccess,
  onChangeRole,
  onSetBlocked,
  onDeleteAccount,
  onRevokeInvite,
  onEditProfile,
}: MemberRowProps) {
  const q = searchQuery ?? "";
  const isOwnerRow = row.kind === "member" && row.role === "owner";
  const isInvite = row.kind === "invite";

  const accessed =
    row.kind === "member"
      ? isOwnerRow
        ? shops
        : shops.filter((s) => row.assignedShopIds.has(s.id))
      : [];
  const count = isOwnerRow
    ? shops.length
    : row.kind === "member"
      ? row.assignedShopIds.size
      : 0;

  // void to acknowledge unused — shopsById is reserved for future inline detail.
  void shopsById;

  const canSelect =
    isWorkspaceOwner && row.kind === "member" && !row.isYou;
  return (
    <div
      style={{
        padding: "14px 18px",
        display: "grid",
        gridTemplateColumns: "36px minmax(0,1.6fr) 180px minmax(0,1fr) 110px",
        gap: 14,
        alignItems: "center",
        borderTop: !isFirst ? "1px solid var(--border-soft)" : "none",
        transition: "background .12s",
        opacity: isInvite ? 0.85 : 1,
        background: selected
          ? "color-mix(in srgb, var(--accent) 8%, #fff)"
          : isInvite
            ? "#fffbeb"
            : undefined,
      }}
    >
      <div>
        {canSelect && (
          <CheckBox
            checked={selected}
            onChange={onToggleSelect}
            size={16}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
        <Avatar
          name={row.kind === "member" ? row.fullName || row.email : row.email}
          avatarDataUrl={row.kind === "member" ? row.avatarDataUrl : null}
          email={row.email}
          size={36}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.25,
            }}
          >
            {highlight(
              row.kind === "member" ? row.fullName || row.email : row.email,
              q,
            )}
            {row.kind === "member" && row.isYou && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  color: "var(--muted)",
                  fontWeight: 400,
                }}
              >
                (вы)
              </span>
            )}
            {row.kind === "member" && row.isBlocked && (
              <span
                title="Аккаунт заблокирован — пользователь не может войти"
                style={{
                  marginLeft: 6,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#b91c1c",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  padding: "1px 6px",
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  verticalAlign: 1,
                }}
              >
                <Lock size={9} strokeWidth={2.5} />
                заблокирован
              </span>
            )}
          </div>
          {row.kind === "member" && row.jobTitle && (
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginTop: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {highlight(row.jobTitle, q)}
            </div>
          )}
          <div
            style={{
              fontSize: 11.5,
              color: "var(--muted-2)",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.kind === "member" ? (
              <>
                {row.fullName ? (
                  <>
                    {highlight(row.email, q)}
                    {" · "}
                  </>
                ) : null}
                в команде с {fmtDate(row.createdAt)}
              </>
            ) : (
              <>
                приглашение от {row.invitedByEmail} · истекает {fmtDate(row.expiresAt)}
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 4, minWidth: 0 }}>
        {isInvite ? (
          <>
            <PendingBadge />
            <RoleBadge role={row.role} />
          </>
        ) : isWorkspaceOwner && row.kind === "member" && !row.isYou ? (
          <RolePicker
            value={row.role}
            options={["owner", "manager", "member"]}
            disabled={busy}
            onChange={(r) => onChangeRole(row.userId, r)}
          />
        ) : (
          <RoleBadge role={row.role} />
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        {isInvite ? (
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            доступ настроите после принятия
          </span>
        ) : isOwnerRow ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 10px 5px 7px",
              borderRadius: 8,
              background: "rgba(180,83,9,0.12)",
              color: "#b45309",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Crown size={13} />
            Все магазины
          </span>
        ) : (
          <AccessPill
            count={count}
            total={shops.length}
            accessed={accessed}
            disabled={!allowManage}
            grantorByShopId={
              row.kind === "member" && row.isYou ? grantorByShopId : undefined
            }
            onClick={
              allowManage && row.kind === "member"
                ? () => onOpenAccess(row.userId)
                : undefined
            }
          />
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 6,
          alignItems: "center",
        }}
      >
        {isInvite ? (
          allowManage && (
            <button
              type="button"
              className="btn-icon danger"
              disabled={busy}
              onClick={() => onRevokeInvite(row.token, row.email)}
              title="Отозвать приглашение"
              style={{ padding: "6px 10px", display: "inline-flex", gap: 4 }}
            >
              <Trash2 size={13} />
              <span style={{ fontSize: 12 }}>Отозвать</span>
            </button>
          )
        ) : row.kind === "member" && isWorkspaceOwner && !row.isYou ? (
          <>
            <RowIconBtn
              title="Редактировать профиль"
              icon={<Pencil size={14} />}
              disabled={busy}
              onClick={() => onEditProfile(row.userId)}
            />
            <RowIconBtn
              title={row.isBlocked ? "Разблокировать" : "Заблокировать"}
              icon={
                row.isBlocked ? <CircleCheck size={14} /> : <Ban size={14} />
              }
              disabled={busy}
              onClick={() =>
                onSetBlocked(row.userId, row.email, !row.isBlocked)
              }
            />
            <RowIconBtn
              title="Удалить сотрудника"
              icon={<Trash2 size={14} />}
              tone="danger"
              disabled={busy}
              onClick={() => onDeleteAccount(row.userId, row.email)}
            />
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: "#94a3b8" }}>—</span>
        )}
      </div>
    </div>
  );
}

// ===================================================================
// Mobile member card
// ===================================================================

interface MemberCardProps {
  row: PersonRow;
  shops: ShopMeta[];
  isOpen: boolean;
  allowManage: boolean;
  isWorkspaceOwner: boolean;
  busy: boolean;
  saved: boolean;
  selected: boolean;
  /** Active search query — highlighted inside name/email/job title. */
  searchQuery?: string;
  /** When this card is the current viewer's own — shopId → grantor email. */
  grantorByShopId?: Map<number, string | null>;
  onToggleSelect: () => void;
  onToggleOpen: () => void;
  onToggleShop: (shopId: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onChangeRole: (userId: number, role: WorkspaceRole) => void;
  onSetBlocked: (userId: number, email: string, blocked: boolean) => void;
  onDeleteAccount: (userId: number, email: string) => void;
  onRevokeInvite: (token: string, email: string) => void;
}

function MemberCard({
  row,
  shops,
  isOpen,
  allowManage,
  isWorkspaceOwner,
  busy,
  saved,
  selected,
  searchQuery,
  grantorByShopId,
  onToggleSelect,
  onToggleOpen,
  onToggleShop,
  onSelectAll,
  onClearAll,
  onChangeRole,
  onSetBlocked,
  onDeleteAccount,
  onRevokeInvite,
}: MemberCardProps) {
  const q = searchQuery ?? "";
  const isSelfRow = row.kind === "member" && row.isYou;
  const isOwnerRow = row.kind === "member" && row.role === "owner";
  const isInvite = row.kind === "invite";

  const accessedIds =
    row.kind === "member" ? row.assignedShopIds : new Set<number>();
  const count = isOwnerRow ? shops.length : accessedIds.size;
  const previewShops = isOwnerRow
    ? shops.slice(0, 4)
    : shops.filter((s) => accessedIds.has(s.id)).slice(0, 4);
  const moreCount = Math.max(
    0,
    (isOwnerRow ? shops.length : accessedIds.size) - previewShops.length,
  );

  const canSelect =
    isWorkspaceOwner && row.kind === "member" && !row.isYou;
  return (
    <div
      style={{
        background: selected
          ? "color-mix(in srgb, var(--accent) 8%, #fff)"
          : isInvite
            ? "#fffbeb"
            : "#fff",
        border:
          "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: isOpen
          ? "0 8px 28px -12px rgba(15,23,42,.18)"
          : "0 1px 0 rgba(15,23,42,.02)",
        transition: "box-shadow .18s",
      }}
    >
      <button
        type="button"
        onClick={onToggleOpen}
        style={{
          width: "100%",
          padding: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "transparent",
          border: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        {canSelect && (
          <CheckBox
            checked={selected}
            onChange={onToggleSelect}
            size={18}
          />
        )}
        <Avatar
          name={row.kind === "member" ? row.fullName || row.email : row.email}
          avatarDataUrl={row.kind === "member" ? row.avatarDataUrl : null}
          email={row.email}
          size={44}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {highlight(
              row.kind === "member" ? row.fullName || row.email : row.email,
              q,
            )}
            {row.kind === "member" && row.isYou && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11.5,
                  color: "var(--muted)",
                  fontWeight: 400,
                }}
              >
                (вы)
              </span>
            )}
          </div>
          {row.kind === "member" && row.jobTitle && (
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {highlight(row.jobTitle, q)}
            </div>
          )}
          {row.kind === "member" && row.fullName && (
            <div
              style={{
                fontSize: 11,
                color: "var(--muted-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {highlight(row.email, q)}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 5,
              flexWrap: "wrap",
            }}
          >
            {isInvite && <PendingBadge />}
            <RoleBadge role={row.role} />
            {row.kind === "member" && row.isBlocked && (
              <span
                title="Аккаунт заблокирован"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#b91c1c",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  padding: "1px 6px",
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Lock size={9} strokeWidth={2.5} />
                заблокирован
              </span>
            )}
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {row.kind === "member"
                ? `с ${fmtDateShort(row.createdAt)}`
                : `до ${fmtDateShort(row.expiresAt)}`}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 5,
          }}
        >
          {!isInvite && (
            <div
              style={{
                fontSize: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px 3px 7px",
                borderRadius: 7,
                background: isOwnerRow ? "rgba(180,83,9,0.12)" : "#f1f5f9",
                color: isOwnerRow ? "#b45309" : "#1e293b",
                fontWeight: 600,
              }}
            >
              {isOwnerRow ? <Crown size={12} /> : <StoreIcon size={12} />}
              {isOwnerRow ? (
                "все"
              ) : (
                <>
                  <b>{count}</b>
                  <span style={{ opacity: 0.6, fontWeight: 500 }}>
                    /{shops.length}
                  </span>
                </>
              )}
            </div>
          )}
          <ChevronDown
            size={16}
            style={{
              color: "#94a3b8",
              transform: isOpen ? "rotate(180deg)" : "none",
              transition: "transform .15s",
            }}
          />
        </div>
      </button>

      {!isOpen && previewShops.length > 0 && (
        <div
          style={{
            padding: "0 14px 14px",
            display: "flex",
            gap: 5,
            flexWrap: "wrap",
          }}
        >
          {previewShops.map((s) => (
            <span
              key={s.id}
              style={{
                padding: "3px 7px 3px 5px",
                borderRadius: 5,
                background: "#f8fafc",
                border: "1px solid var(--border-soft)",
                fontSize: 10.5,
                color: "#1e293b",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontWeight: 700,
                  color: s.color ?? "var(--accent)",
                  fontSize: 9.5,
                  letterSpacing: 0.2,
                }}
              >
                {s.shortName}
              </span>
              <span
                style={{
                  maxWidth: 80,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.name}
              </span>
            </span>
          ))}
          {moreCount > 0 && (
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                background: "#f1f5f9",
                fontSize: 10.5,
                color: "var(--muted)",
                fontWeight: 600,
              }}
            >
              +{moreCount}
            </span>
          )}
        </div>
      )}

      {isOpen && (
        <div
          style={{
            borderTop: "1px solid var(--border-soft)",
            background: "#f8fafc",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isInvite ? (
            <div
              style={{
                padding: "14px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              <Info
                size={15}
                style={{ flex: "0 0 auto", marginTop: 1, color: "#a16207" }}
              />
              <span>
                Доступ к магазинам можно будет настроить после того, как
                получатель примет приглашение. Сейчас можно только отозвать.
              </span>
            </div>
          ) : isOwnerRow ? (
            <div
              style={{
                padding: "14px 16px",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              <Info
                size={15}
                style={{ flex: "0 0 auto", marginTop: 1, color: "#b45309" }}
              />
              <span>
                Владелец автоматически видит все {shops.length} магазинов команды.
              </span>
            </div>
          ) : (
            <ShopAccessBody
              shops={shops}
              selected={accessedIds}
              onToggle={onToggleShop}
              onSelectAll={onSelectAll}
              onClearAll={onClearAll}
              saved={saved}
              variant="inline"
              readOnly={isSelfRow}
              grantorByShopId={isSelfRow ? grantorByShopId : undefined}
            />
          )}

          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--border-soft)",
              background: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {!isInvite && isWorkspaceOwner && row.kind === "member" && !row.isYou && (
              <RolePicker
                value={row.role}
                options={["owner", "manager", "member"]}
                disabled={busy}
                onChange={(r) => onChangeRole(row.userId, r)}
              />
            )}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onToggleOpen}
              className="btn-secondary"
              style={{ padding: "8px 14px", fontSize: 13 }}
            >
              Свернуть
            </button>
            {isInvite && allowManage && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRevokeInvite(row.token, row.email)}
                style={{
                  padding: "8px 14px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  color: "#dc2626",
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: busy ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "inherit",
                }}
              >
                <Trash2 size={14} />
                Отозвать
              </button>
            )}
            {!isInvite && row.kind === "member" && isWorkspaceOwner && !row.isYou && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onSetBlocked(row.userId, row.email, !row.isBlocked)
                  }
                  style={{
                    padding: "8px 14px",
                    background: row.isBlocked ? "#ecfdf5" : "#fef3c7",
                    border:
                      "1px solid " +
                      (row.isBlocked ? "#a7f3d0" : "#fde68a"),
                    borderRadius: 8,
                    color: row.isBlocked ? "#047857" : "#92400e",
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: busy ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "inherit",
                  }}
                >
                  {row.isBlocked ? <Unlock size={14} /> : <Lock size={14} />}
                  {row.isBlocked ? "Разблокировать" : "Заблокировать"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeleteAccount(row.userId, row.email)}
                  style={{
                    padding: "8px 14px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    color: "#dc2626",
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: busy ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "inherit",
                  }}
                >
                  <UserX size={14} />
                  Удалить
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===================================================================
// Invite form (desktop + mobile)
// ===================================================================

function InviteForm({
  isOwner,
  busy,
  onSubmit,
}: {
  isOwner: boolean;
  busy: boolean;
  onSubmit: (email: string, role: WorkspaceRole) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");

  const send = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    await onSubmit(e, role);
    setEmail("");
    setRole("member");
  };

  return (
    <div
      style={{
        padding: 18,
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        type="email"
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          flex: "1 1 240px",
          minWidth: 200,
          height: 38,
          padding: "0 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 13,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as WorkspaceRole)}
        style={{
          height: 38,
          padding: "0 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 13,
          fontFamily: "inherit",
          background: "#fff",
          minWidth: 150,
        }}
      >
        <option value="member">участник</option>
        <option value="manager">менеджер</option>
        {isOwner && <option value="owner">владелец</option>}
      </select>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || !email.trim()}
        onClick={() => void send()}
        style={{
          padding: "0 16px",
          height: 38,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <MailPlus size={14} />
        Отправить приглашение
      </button>
      <p
        className="muted"
        style={{ width: "100%", margin: 0, fontSize: 11.5 }}
      >
        После принятия приглашения настроишь доступ к магазинам отдельно. Можно
        несколько вызовов подряд для разных адресов.
      </p>
    </div>
  );
}

// ===================================================================
// Mobile bottom-sheet invite form
// ===================================================================

function InviteSheet({
  isOwner,
  busy,
  onClose,
  onSubmit,
}: {
  isOwner: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (email: string, role: WorkspaceRole) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,.45)",
          zIndex: 1100,
          animation: "tp-fadeIn .15s",
        }}
      />
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "#fff",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          zIndex: 1101,
          padding: "12px 16px 24px",
          boxShadow: "0 -20px 40px -10px rgba(15,23,42,.2)",
          animation: "tp-slideUp .22s cubic-bezier(.2,.7,.3,1)",
          maxWidth: 460,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            width: 38,
            height: 4,
            background: "var(--border)",
            borderRadius: 4,
            margin: "2px auto 14px",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>
            Пригласить сотрудника
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: 0,
              background: "#f1f5f9",
              cursor: "pointer",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              Email
            </div>
            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                border: "1px solid var(--border)",
                borderRadius: 9,
                fontSize: 14,
                fontFamily: "inherit",
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              Роль
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isOwner ? "1fr 1fr 1fr" : "1fr 1fr",
                gap: 8,
              }}
            >
              {(isOwner
                ? (["member", "manager", "owner"] as const)
                : (["member", "manager"] as const)
              ).map((r) => {
                const on = role === r;
                const desc =
                  r === "owner"
                    ? "полный доступ"
                    : r === "manager"
                      ? "создаёт магазины"
                      : "только просмотр";
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    style={{
                      padding: "10px 10px",
                      borderRadius: 10,
                      border: "1.5px solid " + (on ? "var(--accent)" : "var(--border)"),
                      background: on
                        ? "color-mix(in srgb, var(--accent) 8%, #fff)"
                        : "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: on ? "var(--accent)" : "#1e293b",
                      }}
                    >
                      {ROLE_LABEL[r]}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--muted)",
                        marginTop: 2,
                      }}
                    >
                      {desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              padding: "4px 2px",
              lineHeight: 1.5,
            }}
          >
            Магазины можно будет настроить после принятия приглашения.
          </div>
          <button
            type="button"
            disabled={busy || !email.trim()}
            onClick={async () => {
              await onSubmit(email.trim().toLowerCase(), role);
              setEmail("");
              setRole("member");
              onClose();
            }}
            className="btn-primary"
            style={{
              height: 48,
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 15,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            <Mail size={16} />
            Отправить приглашение
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ===================================================================
// Team summary card (workspace name + slug + stats)
// ===================================================================

function TeamSummary({
  info,
  shopsTotal,
  isOwner,
  onRename,
}: {
  info: WorkspaceInfo;
  shopsTotal: number;
  isOwner: boolean;
  onRename: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(info.name);

  return (
    <Section
      icon={<Users size={16} style={{ color: "var(--muted)" }} />}
      title="Команда"
      action={
        isOwner && !editing ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDraft(info.name);
              setEditing(true);
            }}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            Переименовать
          </button>
        ) : null
      }
    >
      <div
        style={{
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 11,
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, #fff), color-mix(in srgb, var(--accent) 60%, #fff))",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            color: "#fff",
            fontWeight: 700,
            letterSpacing: 0.3,
            flex: "0 0 auto",
            overflow: "hidden",
          }}
        >
          {info.logoDataUrl ? (
            <img
              src={info.logoDataUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            info.name[0]?.toUpperCase() ?? "?"
          )}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          {editing ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={80}
                autoFocus
                style={{
                  padding: "6px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 14,
                  minWidth: 200,
                  flex: "1 1 240px",
                }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={async () => {
                  if (!draft.trim()) return;
                  await onRename(draft.trim());
                  setEditing(false);
                }}
                style={{ padding: "6px 12px" }}
              >
                Сохранить
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDraft(info.name);
                  setEditing(false);
                }}
                style={{ padding: "6px 12px" }}
              >
                Отмена
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>
                {info.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 3,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    background: "#f1f5f9",
                    padding: "2px 7px",
                    borderRadius: 5,
                    fontSize: 11,
                    color: "#1e293b",
                  }}
                >
                  slug: {info.slug}
                </span>
                <span>создана {fmtDate(info.createdAt)}</span>
                <span style={{ color: "var(--border)" }}>·</span>
                <span>
                  <b style={{ color: "#1e293b" }}>{info.members.length}</b>{" "}
                  сотрудников
                </span>
                <span>
                  <b style={{ color: "#1e293b" }}>{shopsTotal}</b> магазинов
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

// ===================================================================
// Main TeamPage
// ===================================================================

export default function TeamPage() {
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);

  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [matrix, setMatrix] = useState<ShopAccessMatrix | null>(null);
  const [invites, setInvites] = useState<WorkspaceInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openMemberId, setOpenMemberId] = useState<number | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | WorkspaceRole>("all");
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Optimistic per-member assignment state. Drives the AccessPill counts and
  // the drawer/inline checkboxes; backend mutation runs in the background and
  // rolls back on error.
  const [accessByUser, setAccessByUser] = useState<Map<number, Set<number>>>(
    new Map(),
  );
  const savedTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [i, sa, inv] = await Promise.all([
        api.workspace.me(),
        api.workspace.shopAccess().catch(() => null),
        api.workspace.listInvites().catch(() => [] as WorkspaceInviteRow[]),
      ]);
      setInfo(i);
      setMatrix(sa);
      setInvites(inv);
      // Build per-user assignment map from matrix.
      if (sa) {
        const next = new Map<number, Set<number>>();
        for (const m of sa.members) next.set(m.userId, new Set());
        for (const a of sa.assignments) {
          let set = next.get(a.userId);
          if (!set) {
            set = new Set();
            next.set(a.userId, set);
          }
          set.add(a.shopId);
        }
        setAccessByUser(next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const allowManage = canManage(info?.role);
  const isWorkspaceOwner = info?.role === "owner";
  const shops: ShopMeta[] = useMemo(
    () => matrix?.shops ?? [],
    [matrix],
  );
  const shopsById = useMemo(
    () => new Map(shops.map((s) => [s.id, s])),
    [shops],
  );

  // Per-shop grantor email for the current user's own assignments. Surfaced on
  // their self-row chips as «доступ от X» (matters when a manager is assigned
  // to shops they didn't create).
  const myGrantorByShopId = useMemo(() => {
    if (!info || !matrix) return undefined;
    const myId = info.members.find((m) => m.isYou)?.userId;
    if (myId == null) return undefined;
    const map = new Map<number, string | null>();
    for (const a of matrix.assignments) {
      if (a.userId === myId) map.set(a.shopId, a.grantedByEmail);
    }
    return map;
  }, [info, matrix]);

  // Build the unified people list (members + invites), apply filters.
  const people = useMemo<PersonRow[]>(() => {
    if (!info) return [];
    const memberRows: PersonRow[] = info.members.map((m: WorkspaceMember) => ({
      kind: "member" as const,
      key: `u-${m.userId}`,
      userId: m.userId,
      email: m.email,
      fullName: m.fullName,
      jobTitle: m.jobTitle,
      avatarDataUrl: m.avatarDataUrl,
      role: m.role,
      isBlocked: m.isBlocked,
      createdAt: m.createdAt,
      isYou: m.isYou,
      assignedShopIds: accessByUser.get(m.userId) ?? new Set(),
    }));
    const inviteRows: PersonRow[] = invites.map((inv) => ({
      kind: "invite" as const,
      key: `i-${inv.token}`,
      token: inv.token,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      invitedByEmail: inv.invitedBy.email,
    }));
    return [...memberRows, ...inviteRows];
  }, [info, invites, accessByUser]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (roleFilter !== "all" && p.role !== roleFilter) return false;
      if (q) {
        const haystacks: string[] = [p.email];
        if (p.kind === "member") {
          if (p.fullName) haystacks.push(p.fullName);
          if (p.jobTitle) haystacks.push(p.jobTitle);
        }
        const match = haystacks.some((s) => s.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [people, search, roleFilter]);

  // Saved-tick: brief "saved" hint when an assignment toggles.
  const flashSaved = useCallback(() => {
    setSavedTick(true);
    if (savedTickTimer.current) clearTimeout(savedTickTimer.current);
    savedTickTimer.current = setTimeout(() => setSavedTick(false), 1200);
  }, []);

  const openMember = openMemberId
    ? (filtered.find(
        (p) => p.kind === "member" && p.userId === openMemberId,
      ) as (PersonRow & { kind: "member" }) | undefined)
    : undefined;

  // ---- Mutations ----

  const toggleShopForMember = async (userId: number, shopId: number) => {
    const current = accessByUser.get(userId) ?? new Set<number>();
    const isOn = current.has(shopId);
    // Optimistic.
    setAccessByUser((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(userId) ?? []);
      if (isOn) set.delete(shopId);
      else set.add(shopId);
      next.set(userId, set);
      return next;
    });
    flashSaved();
    try {
      if (isOn) {
        // Confirm destructive removal — backend cascade-deletes per-user data.
        if (
          !window.confirm(
            "Снять доступ к этому магазину? Товары, финансы и история импортов этого сотрудника в этом магазине будут удалены безвозвратно.",
          )
        ) {
          // User cancelled — rollback.
          setAccessByUser((prev) => {
            const next = new Map(prev);
            const set = new Set(next.get(userId) ?? []);
            set.add(shopId);
            next.set(userId, set);
            return next;
          });
          return;
        }
        await api.shops.members.remove(shopId, userId);
      } else {
        await api.shops.members.add(shopId, userId);
      }
    } catch (e) {
      setError((e as Error).message);
      // Roll back optimistic update on failure.
      setAccessByUser((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(userId) ?? []);
        if (isOn) set.add(shopId);
        else set.delete(shopId);
        next.set(userId, set);
        return next;
      });
    }
  };

  const selectAllShopsForMember = async (userId: number) => {
    const current = accessByUser.get(userId) ?? new Set<number>();
    const toAdd = shops.filter((s) => !current.has(s.id));
    setAccessByUser((prev) => {
      const next = new Map(prev);
      next.set(userId, new Set(shops.map((s) => s.id)));
      return next;
    });
    flashSaved();
    try {
      for (const s of toAdd) await api.shops.members.add(s.id, userId);
    } catch (e) {
      setError((e as Error).message);
      await reload();
    }
  };

  const clearAllShopsForMember = async (userId: number) => {
    const current = accessByUser.get(userId) ?? new Set<number>();
    if (current.size === 0) return;
    if (
      !window.confirm(
        `Снять доступ ко всем ${current.size} магазинам? Все товары, финансы и импорты этого сотрудника в этих магазинах будут удалены безвозвратно.`,
      )
    )
      return;
    const toRemove = [...current];
    setAccessByUser((prev) => {
      const next = new Map(prev);
      next.set(userId, new Set());
      return next;
    });
    flashSaved();
    try {
      for (const shopId of toRemove) await api.shops.members.remove(shopId, userId);
    } catch (e) {
      setError((e as Error).message);
      await reload();
    }
  };

  const changeMemberRole = async (userId: number, role: WorkspaceRole) => {
    setBusy(true);
    setError(null);
    try {
      await api.workspace.setMemberRole(userId, role);
      setNotice(`Роль изменена на «${ROLE_LABEL[role]}»`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setMemberBlocked = async (
    userId: number,
    email: string,
    blocked: boolean,
  ) => {
    if (blocked) {
      if (
        !window.confirm(
          `Заблокировать ${email}? Они будут разлогинены со всех устройств и не смогут войти, пока не разблокируешь. Данные команды сохраняются.`,
        )
      )
        return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.workspace.setMemberBlocked(userId, blocked);
      setNotice(
        blocked
          ? `${email} заблокирован(а)`
          : `${email} разблокирован(а)`,
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteMemberAccount = async (userId: number, email: string) => {
    if (
      !window.confirm(
        `Удалить сотрудника ${email} навсегда?\n\nЕго аккаунт будет удалён вместе со всеми сессиями и приглашениями. Магазины, которые он создал, перейдут к вам (текущему владельцу команды). Действие необратимо.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.workspace.deleteMemberAccount(userId);
      setNotice(`Аккаунт ${email} удалён. Его магазины переданы вам.`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (token: string, email: string) => {
    if (!window.confirm(`Отозвать приглашение для ${email}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.workspace.revokeInvite(token);
      setNotice(`Приглашение для ${email} отозвано`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async (email: string, role: WorkspaceRole) => {
    setBusy(true);
    setError(null);
    try {
      await api.workspace.createInvite(email, role);
      setNotice(`Приглашение отправлено на ${email}`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  // ---- Bulk selection (owner-only) ----

  const selectableMembers = useMemo<(PersonRow & { kind: "member" })[]>(
    () =>
      info && isWorkspaceOwner
        ? (people.filter(
            (p) => p.kind === "member" && !p.isYou,
          ) as (PersonRow & { kind: "member" })[])
        : [],
    [info, isWorkspaceOwner, people],
  );

  const selectableIds = useMemo(
    () => selectableMembers.map((m) => m.userId),
    [selectableMembers],
  );

  const allBulkSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const someBulkSelected = selectedIds.size > 0 && !allBulkSelected;

  const toggleOneSelect = (userId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const toggleAllSelect = () => {
    setSelectedIds((prev) => {
      if (allBulkSelected) {
        const next = new Set(prev);
        for (const id of selectableIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of selectableIds) next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const runBulk = async (
    label: string,
    fn: (m: PersonRow & { kind: "member" }) => Promise<unknown>,
  ) => {
    const targets = selectableMembers.filter((m) => selectedIds.has(m.userId));
    if (targets.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    const results = await Promise.allSettled(targets.map(fn));
    const failures = results.filter((r) => r.status === "rejected").length;
    const ok = results.length - failures;
    if (failures === 0) {
      setNotice(`${label}: ${ok} из ${results.length}`);
      clearSelection();
    } else {
      setError(
        `${label}: успешно ${ok}, ошибок ${failures}. Подробности — выделите оставшиеся и попробуйте снова.`,
      );
    }
    await reload();
    setBulkBusy(false);
  };

  const bulkBlock = async (blocked: boolean) => {
    const count = selectedIds.size;
    if (
      blocked &&
      !window.confirm(
        `Заблокировать ${count} сотрудников? Каждый из них будет разлогинен и не сможет войти, пока ты не разблокируешь.`,
      )
    )
      return;
    await runBulk(
      blocked ? "Заблокировано" : "Разблокировано",
      (m) => api.workspace.setMemberBlocked(m.userId, blocked),
    );
  };

  const bulkDeleteAccounts = async () => {
    const count = selectedIds.size;
    if (
      !window.confirm(
        `Удалить ${count} сотрудников навсегда?\n\nИх аккаунты будут удалены вместе с сессиями. Магазины, которые они создавали, перейдут к вам. Действие необратимо.`,
      )
    )
      return;
    await runBulk("Удалено", (m) =>
      api.workspace.deleteMemberAccount(m.userId),
    );
  };

  const renameWorkspace = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.workspace.update({ name: next });
      setInfo((i) => (i ? { ...i, name: res.name } : i));
      setNotice("Команда переименована");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ===================================================================
  // Render
  // ===================================================================

  if (loading && !info) {
    return (
      <div className="card">
        <span className="muted">Загрузка команды…</span>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="card">
        <span className="muted">{error ?? "Команда не найдена"}</span>
      </div>
    );
  }

  // Team-page content is narrower than the rest of the calculator (which has
  // wide tables): per design, capped at 1280px so cards don't stretch awkwardly.
  const headerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 1280,
    margin: "0 auto",
    width: "100%",
  };

  const inlineNotices = (
    <>
      {error && (
        <div className="error-panel">
          <span>Ошибка: {error}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setError(null)}
          >
            Закрыть
          </button>
        </div>
      )}
      {notice && (
        <div
          className="card"
          style={{
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{notice}</span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setNotice(null)}
          >
            Закрыть
          </button>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        <style>{KEYFRAMES_CSS}</style>
        <div style={{ ...headerStyle, paddingBottom: 80 }}>
          {inlineNotices}

          <TeamSummary
            info={info}
            shopsTotal={shops.length}
            isOwner={isWorkspaceOwner}
            onRename={renameWorkspace}
          />

          <div style={{ display: "flex", gap: 8 }}>
            {[
              { icon: <Users size={15} />, label: "сотрудников", value: info.members.length },
              { icon: <StoreIcon size={15} />, label: "магазинов", value: shops.length },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 11,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background:
                      "color-mix(in srgb, var(--accent) 12%, transparent)",
                    color: "var(--accent)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {s.icon}
                </span>
                <div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: -0.3,
                    }}
                  >
                    {s.value}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                    {s.label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#94a3b8",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск сотрудника"
              style={{
                width: "100%",
                height: 40,
                padding: "0 12px 0 36px",
                border: "1px solid var(--border)",
                borderRadius: 9,
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                background: "#fff",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((p) => (
              <MemberCard
                key={p.key}
                row={p}
                shops={shops}
                isOpen={p.kind === "member" && openMemberId === p.userId}
                allowManage={allowManage}
                isWorkspaceOwner={isWorkspaceOwner}
                busy={busy || bulkBusy}
                saved={savedTick}
                selected={
                  p.kind === "member" && selectedIds.has(p.userId)
                }
                searchQuery={search}
                grantorByShopId={myGrantorByShopId}
                onToggleSelect={() => {
                  if (p.kind === "member") toggleOneSelect(p.userId);
                }}
                onToggleOpen={() => {
                  if (p.kind === "member") {
                    setOpenMemberId(
                      openMemberId === p.userId ? null : p.userId,
                    );
                  }
                }}
                onToggleShop={(shopId) => {
                  if (p.kind !== "member") return;
                  void toggleShopForMember(p.userId, shopId);
                }}
                onSelectAll={() => {
                  if (p.kind !== "member") return;
                  void selectAllShopsForMember(p.userId);
                }}
                onClearAll={() => {
                  if (p.kind !== "member") return;
                  void clearAllShopsForMember(p.userId);
                }}
                onChangeRole={changeMemberRole}
                onSetBlocked={setMemberBlocked}
                onDeleteAccount={deleteMemberAccount}
                onRevokeInvite={revokeInvite}
              />
            ))}
            {filtered.length === 0 && (
              <div
                style={{
                  padding: "40px 10px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Ничего не найдено
              </div>
            )}
          </div>
        </div>

        {allowManage && (
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              padding: "12px 16px",
              background:
                "linear-gradient(to top, #f8fafc 60%, rgba(248,250,252,0))",
              zIndex: 50,
            }}
          >
            <button
              type="button"
              onClick={() => setInviteSheetOpen(true)}
              className="btn-primary"
              style={{
                width: "100%",
                height: 50,
                borderRadius: 12,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontWeight: 600,
                fontSize: 15,
                boxShadow:
                  "0 10px 30px -10px color-mix(in srgb, var(--accent) 55%, transparent)",
              }}
            >
              <UserPlus size={17} strokeWidth={2.5} />
              Пригласить сотрудника
            </button>
          </div>
        )}

        {inviteSheetOpen && (
          <InviteSheet
            isOwner={isWorkspaceOwner}
            busy={busy}
            onClose={() => setInviteSheetOpen(false)}
            onSubmit={sendInvite}
          />
        )}
      </>
    );
  }

  // Desktop layout
  return (
    <>
      <style>{KEYFRAMES_CSS}</style>
      <div style={headerStyle}>
        {inlineNotices}

        <TeamSummary
          info={info}
          shopsTotal={shops.length}
          isOwner={isWorkspaceOwner}
          onRename={renameWorkspace}
        />

        <Section
          icon={<Users size={16} style={{ color: "var(--muted)" }} />}
          title="Участники и доступы"
          count={people.length}
          headerRight={
            <>
              <button
                type="button"
                onClick={() => void reload(true)}
                disabled={refreshing || loading}
                title="Обновить список"
                aria-label="Обновить список"
                style={{
                  height: 30,
                  width: 30,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "#fff",
                  color: "var(--muted-2)",
                  cursor: refreshing || loading ? "not-allowed" : "pointer",
                  opacity: refreshing || loading ? 0.6 : 1,
                  transition: "background .15s, color .15s, border-color .15s",
                }}
              >
                <RefreshCw
                  size={14}
                  style={{
                    animation: refreshing ? "team-refresh-spin 0.8s linear infinite" : undefined,
                  }}
                />
              </button>
              <div style={{ position: "relative", width: 220 }}>
                <Search
                  size={13}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                    pointerEvents: "none",
                  }}
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени или email"
                  style={{
                    width: "100%",
                    height: 30,
                    padding: "0 12px 0 30px",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) =>
                  setRoleFilter(e.target.value as "all" | WorkspaceRole)
                }
                style={{
                  height: 30,
                  padding: "0 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "#fff",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                }}
              >
                <option value="all">Все роли</option>
                <option value="owner">Владелец</option>
                <option value="manager">Менеджер</option>
                <option value="member">Участник</option>
              </select>
            </>
          }
        >
          {selectedIds.size > 0 && (
            <BulkBar
              count={selectedIds.size}
              busy={bulkBusy}
              onBlock={() => void bulkBlock(true)}
              onUnblock={() => void bulkBlock(false)}
              onDelete={() => void bulkDeleteAccounts()}
              onClear={clearSelection}
            />
          )}
          <div
            style={{
              padding: "10px 18px",
              background: "#f8fafc",
              borderBottom: "1px solid var(--border-soft)",
              display: "grid",
              gridTemplateColumns: "36px minmax(0,1.6fr) 180px minmax(0,1fr) 110px",
              gap: 14,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--muted)",
              letterSpacing: 0.4,
              textTransform: "uppercase",
              alignItems: "center",
            }}
          >
            <div>
              {isWorkspaceOwner && selectableIds.length > 0 && (
                <CheckBox
                  checked={allBulkSelected}
                  indeterminate={someBulkSelected}
                  onChange={toggleAllSelect}
                  size={16}
                />
              )}
            </div>
            <div>Сотрудник</div>
            <div>Роль</div>
            <div>Магазины</div>
            <div style={{ textAlign: "right" }}>Действия</div>
          </div>
          {filtered.map((p, i) => (
            <MemberRow
              key={p.key}
              row={p}
              shops={shops}
              shopsById={shopsById}
              isFirst={i === 0}
              allowManage={allowManage}
              isWorkspaceOwner={isWorkspaceOwner}
              busy={busy || bulkBusy}
              selected={
                p.kind === "member" && selectedIds.has(p.userId)
              }
              searchQuery={search}
              grantorByShopId={myGrantorByShopId}
              onToggleSelect={() => {
                if (p.kind === "member") toggleOneSelect(p.userId);
              }}
              onOpenAccess={(userId) => setOpenMemberId(userId)}
              onChangeRole={changeMemberRole}
              onSetBlocked={setMemberBlocked}
              onDeleteAccount={deleteMemberAccount}
              onRevokeInvite={revokeInvite}
              onEditProfile={(userId) => setEditingMemberId(userId)}
            />
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "36px 18px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              По текущим фильтрам ничего нет
            </div>
          )}
        </Section>

        {allowManage && (
          <Section
            icon={<Mail size={16} style={{ color: "var(--muted)" }} />}
            title="Пригласить сотрудника"
          >
            <InviteForm
              isOwner={isWorkspaceOwner}
              busy={busy}
              onSubmit={sendInvite}
            />
          </Section>
        )}
      </div>

      {openMember && (
        <ShopAccessDrawer
          member={openMember}
          shops={shops}
          onClose={() => setOpenMemberId(null)}
          onToggle={(shopId) =>
            void toggleShopForMember(openMember.userId, shopId)
          }
          onSelectAll={() => void selectAllShopsForMember(openMember.userId)}
          onClearAll={() => void clearAllShopsForMember(openMember.userId)}
          saved={savedTick}
          readOnly={openMember.isYou}
          grantorByShopId={openMember.isYou ? myGrantorByShopId : undefined}
        />
      )}
      {editingMemberId != null &&
        (() => {
          const target = people.find(
            (p) => p.kind === "member" && p.userId === editingMemberId,
          );
          if (!target || target.kind !== "member") return null;
          return (
            <ProfileEditor
              mode="member"
              userId={target.userId}
              email={target.email}
              initialFullName={target.fullName}
              initialJobTitle={target.jobTitle}
              initialAvatarDataUrl={target.avatarDataUrl}
              onClose={() => setEditingMemberId(null)}
              onSaved={() => {
                void reload(true);
              }}
            />
          );
        })()}
    </>
  );
}

const KEYFRAMES_CSS = `
  @keyframes tp-fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes tp-slideIn { from{transform:translateX(20px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes tp-slideUp { from{transform:translateY(40px)} to{transform:translateY(0)} }
  @keyframes tp-popIn { from{transform:translateY(-4px) scaleY(.96);opacity:0} to{transform:translateY(0) scaleY(1);opacity:1} }
`;
