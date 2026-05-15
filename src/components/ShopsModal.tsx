import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { Shop } from "../api";
import { api } from "../api";
import ShopBadge from "./ShopBadge";

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
  const [drafts, setDrafts] = useState<Record<number, DraftPatch>>({});
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
                    disabled={!canDelete || busy === s.id}
                    onClick={() => void deleteShop(s)}
                    title={
                      s.isOwner
                        ? "Удалить магазин"
                        : "Удалить может только админ — владелец магазина"
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {!s.isOwner && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted, #888)",
                      paddingLeft: 32,
                    }}
                  >
                    Общий магазин — настройки задаёт администратор
                    {s.ownerEmail ? ` (${s.ownerEmail})` : ""}. У вас личный
                    каталог и финансы в нём.
                  </div>
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
