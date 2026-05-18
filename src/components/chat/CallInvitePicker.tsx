import { useMemo, useState } from "react";
import { Phone, Video, X } from "lucide-react";
import Avatar from "../Avatar";

/** Subset of WorkspaceMember / ChatChannelMember that the picker needs.
 *  The exact source type differs (workspace vs channel member endpoint),
 *  so the picker takes the lowest-common-denominator shape. */
export interface CallCandidate {
  userId: number;
  email: string;
  fullName: string;
  avatarDataUrl: string | null;
}

interface CallInvitePickerProps {
  /** Display name of the channel — used in the dialog heading. */
  channelName: string;
  /** Already filtered: never includes the current user. */
  candidates: CallCandidate[];
  /** Userids who are presence-online right now. Drives the green dot +
   *  default selection (only online users pre-checked). */
  onlineUserIds: ReadonlySet<number>;
  callType: "audio" | "video";
  /** Hard cap from the server's MAX_PARTICIPANTS = 5 → 4 invitees + self. */
  maxInvitees: number;
  onConfirm: (inviteeUserIds: number[]) => void;
  onCancel: () => void;
}

/** Modal picker for group calls: shows every callable channel member with
 * a checkbox, presence dot, and search filter. The caller chooses up to
 * `maxInvitees` people; submitting sends the userIds back up to ChatPage
 * which forwards them in the `call.invite` WS payload (server then
 * validates against the channel's member pool). */
export function CallInvitePicker({
  channelName,
  candidates,
  onlineUserIds,
  callType,
  maxInvitees,
  onConfirm,
  onCancel,
}: CallInvitePickerProps) {
  const [selected, setSelected] = useState<Set<number>>(() => {
    // Pre-check the first N online users — common case is «call everyone
    // currently around», and ≤N keeps the size legal.
    const initial = new Set<number>();
    for (const c of candidates) {
      if (initial.size >= maxInvitees) break;
      if (onlineUserIds.has(c.userId)) initial.add(c.userId);
    }
    return initial;
  });
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const toggle = (userId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else if (next.size < maxInvitees) {
        next.add(userId);
      }
      return next;
    });
  };

  const canConfirm = selected.size > 0 && selected.size <= maxInvitees;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      role="dialog"
      aria-label="Кого позвать на звонок"
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 12,
          width: "min(440px, 100%)",
          maxHeight: "min(80vh, 640px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border, #eee)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {callType === "video" ? "Видеозвонок" : "Аудиозвонок"} ·{" "}
              <span style={{ color: "var(--muted, #888)" }}>{channelName}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
              Выберите до {maxInvitees} участников (выбрано {selected.size}/
              {maxInvitees})
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Закрыть"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--muted, #888)",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "8px 16px" }}>
          <input
            type="text"
            placeholder="Поиск по имени или email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "6px 10px",
              fontSize: 13,
              border: "1px solid var(--border, #ddd)",
              borderRadius: 6,
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px" }}>
          {filtered.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "16px 8px",
                color: "var(--muted, #888)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {query
                ? "Никого не найдено."
                : "В этом канале некого приглашать."}
            </p>
          ) : (
            filtered.map((c) => {
              const isChecked = selected.has(c.userId);
              const reachedCap = !isChecked && selected.size >= maxInvitees;
              return (
                <label
                  key={c.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 8px",
                    borderRadius: 6,
                    cursor: reachedCap ? "not-allowed" : "pointer",
                    opacity: reachedCap ? 0.5 : 1,
                    background: isChecked
                      ? "var(--accent-soft, #eef)"
                      : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={reachedCap}
                    onChange={() => toggle(c.userId)}
                    style={{ margin: 0 }}
                  />
                  <Avatar
                    name={c.fullName || c.email}
                    email={c.email}
                    avatarDataUrl={c.avatarDataUrl}
                    size={32}
                    isOnline={onlineUserIds.has(c.userId)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.fullName || c.email.split("@")[0]}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted, #888)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.email}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border, #eee)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              background: "transparent",
              border: "1px solid var(--border, #ddd)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => canConfirm && onConfirm([...selected])}
            disabled={!canConfirm}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              background: canConfirm
                ? "var(--accent, #2563eb)"
                : "var(--border, #ddd)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: canConfirm ? "pointer" : "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {callType === "video" ? <Video size={14} /> : <Phone size={14} />}
            Позвонить
          </button>
        </div>
      </div>
    </div>
  );
}
