import { useEffect, useRef, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { api, type TariffSet } from "../api";

interface Props {
  shopId: number;
  currentTariffSetId: number | null;
  userIsAdmin: boolean;
  /** True for workspace owner/manager — they edit shop default. False for
   * member — they save a per-user override via PUT /api/settings/tariff-set. */
  isOwner: boolean;
  /** Called whenever the selection / list changes — App refetches refs+shops. */
  onChanged: () => void | Promise<void>;
}

/** Cluster tariff-set selector with inline upload + delete.
 * Shows: dropdown of accessible sets (global + own-shop), upload button,
 * delete button for the selected set (if user has rights). */
export default function TariffSetsControl({
  shopId,
  currentTariffSetId,
  userIsAdmin,
  isOwner,
  onChanged,
}: Props) {
  const [sets, setSets] = useState<TariffSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Upload form state.
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadScope, setUploadScope] = useState<"global" | "shop">("shop");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await api.refs.tariffSets.list();
      setSets(list);
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
        const list = await api.refs.tariffSets.list();
        if (!cancelled) setSets(list);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve effective set: explicit override OR latest global.
  const effectiveSetId = (() => {
    if (currentTariffSetId !== null) {
      const exists = sets.find((s) => s.id === currentTariffSetId);
      if (exists) return exists.id;
    }
    const globals = sets.filter((s) => s.scope === "global");
    if (globals.length === 0) return null;
    return globals.reduce((acc, s) => (s.uploadedAt > acc.uploadedAt ? s : acc))
      .id;
  })();

  const selectedSet = sets.find((s) => s.id === effectiveSetId) ?? null;

  const changeSelection = async (nextId: number | null) => {
    setBusy(true);
    setErr(null);
    try {
      if (isOwner) {
        await api.shops.update(shopId, { tariffSetId: nextId });
      } else {
        await api.settings.putTariffSet(nextId, shopId);
      }
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr("Выберите файл .xlsx");
      return;
    }
    if (!uploadName.trim()) {
      setErr("Укажите название набора");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await api.refs.tariffSets.upload({
        file,
        name: uploadName.trim(),
        scope: uploadScope,
        shopId: uploadScope === "shop" ? shopId : undefined,
      });
      if (isOwner) {
        await api.shops.update(shopId, { tariffSetId: created.id });
      } else {
        await api.settings.putTariffSet(created.id, shopId);
      }
      setShowUploadForm(false);
      setUploadName("");
      if (fileRef.current) fileRef.current.value = "";
      await reload();
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!selectedSet) return;
    if (
      !window.confirm(
        `Удалить набор «${selectedSet.name}»? Это безвозвратно удалит ${selectedSet.rowCount} строк тарифов.`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      await api.refs.tariffSets.remove(selectedSet.id);
      await reload();
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canDeleteSelected = selectedSet
    ? selectedSet.scope === "global"
      ? userIsAdmin
      : selectedSet.shopId === shopId
    : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          className="gs-input"
          value={currentTariffSetId ?? ""}
          disabled={loading || busy || sets.length === 0}
          onChange={(e) => {
            const v = e.target.value;
            void changeSelection(v === "" ? null : Number(v));
          }}
          style={{ minWidth: 220 }}
        >
          <option value="">
            {sets.filter((s) => s.scope === "global").length > 0
              ? "Авто (последний глобальный)"
              : "— нет наборов —"}
          </option>
          {sets.map((s) => {
            const date = new Date(s.uploadedAt).toLocaleDateString("ru-RU");
            const scopeLabel = s.scope === "global" ? "общий" : "мой";
            return (
              <option key={s.id} value={s.id}>
                {s.name} · {scopeLabel} · {date}
              </option>
            );
          })}
        </select>

        <button
          type="button"
          className="gs-btn"
          disabled={busy}
          onClick={() => setShowUploadForm((v) => !v)}
          title="Загрузить новый набор"
        >
          <Upload size={14} style={{ marginRight: 4 }} />
          {showUploadForm ? "Отмена" : "Загрузить новый"}
        </button>

        {canDeleteSelected && (
          <button
            type="button"
            className="gs-btn gs-btn-ghost"
            disabled={busy}
            onClick={() => void onDelete()}
            title="Удалить набор"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {showUploadForm && (
        <div
          style={{
            padding: 10,
            border: "1px dashed var(--border-soft)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="gs-label">Название набора</span>
            <input
              type="text"
              className="gs-input"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="напр. Тарифы Q2 2026"
            />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="gs-label" style={{ marginRight: 4 }}>
              Доступ:
            </span>
            <label
              style={{
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                name="tariff-scope"
                checked={uploadScope === "shop"}
                onChange={() => setUploadScope("shop")}
              />
              Только для меня
            </label>
            {userIsAdmin && (
              <label
                style={{
                  display: "inline-flex",
                  gap: 4,
                  alignItems: "center",
                  fontSize: 13,
                }}
              >
                <input
                  type="radio"
                  name="tariff-scope"
                  checked={uploadScope === "global"}
                  onChange={() => setUploadScope("global")}
                />
                Общий (всем пользователям)
              </label>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            disabled={busy}
            style={{ fontSize: 13 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="gs-btn gs-btn-primary"
              disabled={busy || !uploadName.trim()}
              onClick={() => void onUpload()}
            >
              {busy ? "Загружаем…" : "Загрузить и активировать"}
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="gs-help" style={{ color: "var(--err)" }}>
          {err}
        </div>
      )}
    </div>
  );
}
