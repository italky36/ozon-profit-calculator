import { useEffect, useState } from "react";
import { ArrowRightLeft, Plus, Trash2, Users, X } from "lucide-react";
import type { Shop, WorkspaceMember } from "../api";
import { api } from "../api";
import { useAuth } from "../contexts/useAuth";
import ShopBadge from "./ShopBadge";
import ShopMembersModal from "./ShopMembersModal";

interface Props {
  shops: Shop[];
  activeShopId: number | null;
  onClose: () => void;
  onChanged: (next: Shop[]) => void;
}

const PRESET_COLORS = [
  null,
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#ea580c",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

interface DraftPatch {
  name?: string;
  shortName?: string;
  color?: string | null;
}

export default function ShopsModal({
  shops,
  activeShopId,
  onClose,
  onChanged,
}: Props) {
  const { user } = useAuth();
  const isWorkspaceOwner = user?.workspaceRole === "owner";
  const [drafts, setDrafts] = useState<Record<number, DraftPatch>>({});
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [membersFor, setMembersFor] = useState<Shop | null>(null);
  const [transferFor, setTransferFor] = useState<Shop | null>(null);
  // Owner needs the workspace member list to populate the transfer dropdown.
  // Fetched lazily on first transfer-button click; cached afterwards.
  const [wsMembers, setWsMembers] = useState<WorkspaceMember[] | null>(null);

  useEffect(() => {
    if (!isWorkspaceOwner || wsMembers !== null) return;
    let cancelled = false;
    void api.workspace
      .me()
      .then((info) => {
        if (!cancelled) setWsMembers(info.members);
      })
      .catch(() => {
        /* non-critical — transfer button shows a fallback message */
      });
    return () => {
      cancelled = true;
    };
  }, [isWorkspaceOwner, wsMembers]);

  // New-shop form.
  const [newName, setNewName] = useState("");
  const [newShortName, setNewShortName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);

  const setDraft = (id: number, patch: DraftPatch) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const applyPatch = async (shop: Shop) => {
    const patch = drafts[shop.id];
    if (!patch || Object.keys(patch).length === 0) return;
    setBusy(shop.id);
    setErr(null);
    try {
      const updated = await api.shops.update(shop.id, patch);
      onChanged(shops.map((s) => (s.id === shop.id ? updated : s)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[shop.id];
        return next;
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const deleteShop = async (shop: Shop) => {
    if (shops.length <= 1) {
      setErr("Нельзя удалить последний магазин");
      return;
    }
    if (
      !window.confirm(
        `Удалить магазин «${shop.name}»? Все его товары, финансы и импорты будут удалены безвозвратно.`,
      )
    )
      return;
    setBusy(shop.id);
    setErr(null);
    try {
      await api.shops.remove(shop.id);
      onChanged(shops.filter((s) => s.id !== shop.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const transferShop = async (shop: Shop, userId: number) => {
    const target = wsMembers?.find((m) => m.userId === userId);
    if (!target) return;
    if (
      !window.confirm(
        `Передать управление магазином «${shop.name}» пользователю ${target.email}? Старый создатель потеряет права на этот магазин.`,
      )
    )
      return;
    setBusy(shop.id);
    setErr(null);
    try {
      const updated = await api.shops.transfer(shop.id, userId);
      onChanged(shops.map((s) => (s.id === shop.id ? updated : s)));
      setTransferFor(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createShop = async () => {
    if (!newName.trim()) {
      setErr("Введите название");
      return;
    }
    setBusy("new");
    setErr(null);
    try {
      const created = await api.shops.create({
        name: newName.trim(),
        shortName: newShortName.trim() || undefined,
        color: newColor,
      });
      onChanged([...shops, created]);
      setNewName("");
      setNewShortName("");
      setNewColor(null);
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
        style={{ maxWidth: 640, width: "92vw" }}
      >
        <div className="modal-header">
          <h3>Магазины</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        {err && (
          <div
            style={{
              padding: "8px 12px",
              background:
                "color-mix(in srgb, var(--err) 12%, transparent)",
              color: "var(--err)",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shops.map((s) => {
            const draft = drafts[s.id] ?? {};
            const name = draft.name ?? s.name;
            const shortName = draft.shortName ?? s.shortName;
            const color =
              draft.color === undefined ? s.color : draft.color;
            const dirty = Object.keys(draft).length > 0;
            const ownedCount = shops.filter((x) => x.isOwner).length;
            const canDelete = s.isOwner && ownedCount > 1;
            const editable = s.isOwner;
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border-soft)",
                  background:
                    s.id === activeShopId
                      ? "color-mix(in srgb, var(--accent) 6%, transparent)"
                      : "transparent",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <ShopBadge
                    code={shortName}
                    color={color}
                    title={name}
                    shared={!s.isOwner}
                  />
                  <input
                    type="text"
                    value={name}
                    disabled={!editable}
                    onChange={(e) => setDraft(s.id, { name: e.target.value })}
                    placeholder="Название"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border-soft)",
                      fontSize: 13,
                      opacity: editable ? 1 : 0.6,
                    }}
                  />
                  <input
                    type="text"
                    value={shortName}
                    disabled={!editable}
                    onChange={(e) =>
                      setDraft(s.id, { shortName: e.target.value.slice(0, 2) })
                    }
                    placeholder="код"
                    maxLength={2}
                    style={{
                      width: 56,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border-soft)",
                      fontSize: 13,
                      textAlign: "center",
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      opacity: editable ? 1 : 0.6,
                    }}
                  />
                  {editable ? (
                    <ColorSwatch
                      value={color}
                      onChange={(c) => setDraft(s.id, { color: c })}
                    />
                  ) : (
                    <div
                      style={{
                        width: 18 * 8 + 4 * 7 + 8,
                        height: 26,
                        borderRadius: 6,
                        border: "1px solid var(--border-soft)",
                        opacity: 0.5,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={!editable || !dirty || busy === s.id}
                    onClick={() => void applyPatch(s)}
                    title="Сохранить"
                    style={{ opacity: editable && dirty ? 1 : 0.5 }}
                  >
                    {busy === s.id ? "…" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={!editable || busy === s.id}
                    onClick={() => setMembersFor(s)}
                    title={
                      editable
                        ? "Управлять доступом сотрудников"
                        : "Доступом управляет создатель магазина или owner команды"
                    }
                  >
                    <Users size={14} />
                  </button>
                  {isWorkspaceOwner && (
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={busy === s.id}
                      onClick={() =>
                        setTransferFor((cur) =>
                          cur?.id === s.id ? null : s,
                        )
                      }
                      title="Передать управление другому участнику команды"
                    >
                      <ArrowRightLeft size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={!canDelete || busy === s.id}
                    onClick={() => void deleteShop(s)}
                    title={
                      s.isOwner
                        ? "Удалить магазин"
                        : "Удалить может только создатель магазина или owner команды"
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <CreatorHint
                  shop={s}
                  currentUserId={user?.id ?? null}
                  members={wsMembers}
                />
                {!s.isOwner && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted, #888)",
                      paddingLeft: 32,
                    }}
                  >
                    Общий магазин команды — управляет создатель или owner. У
                    вас личный каталог и финансы в нём.
                  </div>
                )}
                {transferFor?.id === s.id && (
                  <TransferPopover
                    shop={s}
                    members={wsMembers}
                    currentUserId={user?.id ?? null}
                    busy={busy === s.id}
                    onClose={() => setTransferFor(null)}
                    onPick={(uid) => void transferShop(s, uid)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            border: "1px dashed var(--border-soft)",
          }}
        >
          <div
            style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}
          >
            Добавить магазин
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название (напр. ООО «Ромашка»)"
              style={{
                flex: 1,
                minWidth: 200,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--border-soft)",
                fontSize: 13,
              }}
            />
            <input
              type="text"
              value={newShortName}
              onChange={(e) => setNewShortName(e.target.value.slice(0, 2))}
              placeholder="код"
              maxLength={2}
              style={{
                width: 56,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--border-soft)",
                fontSize: 13,
                textAlign: "center",
                fontWeight: 700,
              }}
            />
            <ColorSwatch value={newColor} onChange={setNewColor} />
            <button
              type="button"
              className="btn-primary"
              disabled={!newName.trim() || busy === "new"}
              onClick={() => void createShop()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Plus size={14} />
              {busy === "new" ? "…" : "Создать"}
            </button>
          </div>
          <p
            className="muted"
            style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4 }}
          >
            Двухсимвольный код — будет показан в строке товара (например,
            «M1», «РО»). Цвет и СНО можно поменять позже. Налоги и Ozon-ключи
            редактируются в «Глобальных настройках» при выбранном магазине.
          </p>
        </div>
      </div>
      {membersFor && (
        <ShopMembersModal
          shopId={membersFor.id}
          shopName={membersFor.name}
          onClose={() => setMembersFor(null)}
        />
      )}
    </div>
  );
}

/** Small "создан вами / создан X@…" hint shown under each shop row. */
function CreatorHint({
  shop,
  currentUserId,
  members,
}: {
  shop: Shop;
  currentUserId: number | null;
  members: WorkspaceMember[] | null;
}) {
  let label: string;
  if (shop.createdById == null) {
    label = "Создатель удалён из команды";
  } else if (shop.createdById === currentUserId) {
    label = "Создан вами";
  } else {
    const m = members?.find((x) => x.userId === shop.createdById);
    label = m ? `Создан ${m.email}` : `Создан user #${shop.createdById}`;
  }
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--text-muted, #888)",
        paddingLeft: 32,
      }}
    >
      {label}
    </div>
  );
}

/** Owner-only popover for transferring a shop's management to another
 * workspace member. Hides members in role "member" since the backend rejects
 * them; surfaces a hint when there is no valid candidate. */
function TransferPopover({
  shop,
  members,
  currentUserId,
  busy,
  onClose,
  onPick,
}: {
  shop: Shop;
  members: WorkspaceMember[] | null;
  currentUserId: number | null;
  busy: boolean;
  onClose: () => void;
  onPick: (userId: number) => void;
}) {
  const candidates = (members ?? []).filter(
    (m) =>
      m.userId !== shop.createdById &&
      m.userId !== currentUserId &&
      (m.role === "owner" || m.role === "manager"),
  );
  return (
    <div
      style={{
        marginTop: 8,
        marginLeft: 32,
        padding: 10,
        border: "1px solid var(--border-soft)",
        borderRadius: 8,
        background: "color-mix(in srgb, var(--accent) 6%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 12 }}>Передать управление</strong>
        <button
          type="button"
          className="btn-icon"
          onClick={onClose}
          aria-label="Закрыть"
          style={{ padding: 2 }}
        >
          <X size={12} />
        </button>
      </div>
      {members === null ? (
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          Загрузка списка участников…
        </p>
      ) : candidates.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          В команде нет других owner/manager, кому можно передать управление.
          Пригласите менеджера на вкладке «Команда».
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {candidates.map((m) => (
            <button
              key={m.userId}
              type="button"
              disabled={busy}
              onClick={() => onPick(m.userId)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 8px",
                border: "1px solid var(--border-soft)",
                borderRadius: 6,
                background: "#fff",
                cursor: busy ? "wait" : "pointer",
                fontSize: 12,
              }}
            >
              <span>{m.email}</span>
              <span
                className="muted"
                style={{ fontSize: 10, textTransform: "uppercase" }}
              >
                {m.role}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 6,
        border: "1px solid var(--border-soft)",
      }}
    >
      {PRESET_COLORS.map((c) => {
        const sel = c === value;
        return (
          <button
            key={c ?? "null"}
            type="button"
            onClick={() => onChange(c)}
            title={c ?? "без цвета"}
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: sel
                ? "2px solid var(--text)"
                : "1px solid var(--border-soft)",
              background:
                c ?? "repeating-linear-gradient(45deg, transparent 0 3px, var(--border-soft) 3px 6px)",
              padding: 0,
              cursor: "pointer",
            }}
          />
        );
      })}
    </div>
  );
}
