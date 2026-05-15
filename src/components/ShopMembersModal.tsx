import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api } from "../api";
import type { WorkspaceRole } from "../api";

interface Props {
  shopId: number;
  shopName: string;
  onClose: () => void;
}

interface MemberRow {
  userId: number;
  email: string;
  role: WorkspaceRole;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "owner",
  manager: "manager",
  member: "member",
};

export default function ShopMembersModal({ shopId, shopName, onClose }: Props) {
  const [assigned, setAssigned] = useState<MemberRow[]>([]);
  const [candidates, setCandidates] = useState<MemberRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setErr(null);
    try {
      const r = await api.shops.members.list(shopId);
      setAssigned(r.assigned);
      setCandidates(r.candidates);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.shops.members.list(shopId);
        if (cancelled) return;
        setAssigned(r.assigned);
        setCandidates(r.candidates);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const add = async (userId: number) => {
    setBusy(userId);
    setErr(null);
    try {
      await api.shops.members.add(shopId, userId);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (userId: number, email: string) => {
    if (
      !window.confirm(
        `Снять доступ к «${shopName}» у ${email}? Его товары, финансы и импорты в этом магазине будут удалены безвозвратно.`,
      )
    ) {
      return;
    }
    setBusy(userId);
    setErr(null);
    try {
      await api.shops.members.remove(shopId, userId);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, width: "92vw" }}
      >
        <div className="modal-header">
          <h3>Доступ — «{shopName}»</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        {err && (
          <div
            style={{
              padding: "8px 12px",
              background: "color-mix(in srgb, var(--err) 12%, transparent)",
              color: "var(--err)",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}

        {loading ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Загрузка…
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
              Имеют доступ
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {assigned.map((m) => (
                <div
                  key={m.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border-soft)",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    {m.email}
                  </span>
                  <span
                    className="muted"
                    style={{ fontSize: 11, textTransform: "uppercase" }}
                  >
                    {ROLE_LABELS[m.role]}
                  </span>
                  {m.role !== "owner" && (
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={busy === m.userId}
                      onClick={() => void remove(m.userId, m.email)}
                      title="Снять доступ"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {assigned.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Пока никто не имеет доступа.
                </div>
              )}
            </div>

            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                marginTop: 16,
                marginBottom: 6,
              }}
            >
              Можно добавить
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {candidates.map((m) => (
                <div
                  key={m.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px dashed var(--border-soft)",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                    {m.email}
                  </span>
                  <span
                    className="muted"
                    style={{ fontSize: 11, textTransform: "uppercase" }}
                  >
                    {ROLE_LABELS[m.role]}
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={busy === m.userId}
                    onClick={() => void add(m.userId)}
                    title="Дать доступ"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              ))}
              {candidates.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Все участники команды уже имеют доступ.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
