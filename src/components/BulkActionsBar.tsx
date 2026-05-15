import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet, Trash2, X } from "lucide-react";
import type { ProductRow, TaxSettings, VatRate } from "../types";
import type { RowResult } from "./ProductsTable";
import { api } from "../api";
import { useToast } from "../contexts/useToast";
import { exportShortExcel } from "../lib/exportExcel";

interface Props {
  selectedIds: Set<string>;
  rows: ProductRow[];
  results: Map<string, RowResult>;
  taxSettings?: TaxSettings;
  onClear: () => void;
  onAfterChange: () => void | Promise<void>;
}

const WHITE_OPTIONS: { value: boolean | null; label: string }[] = [
  { value: true, label: "Белая" },
  { value: false, label: "Не белая" },
  { value: null, label: "По умолчанию (из глоб. настроек)" },
];

/** OSNO-relevant VAT rates only. Per `src/lib/calc/vat.ts:15` (isOsno) calc
 *  use VAT only for 10% / 22%, плюс «Не облагается» = 0%. 5/7/22 — это USN. */
const VAT_OPTIONS: { value: VatRate; label: string }[] = [
  { value: "Не облагается", label: "Не облагается (0%)" },
  { value: 0.1, label: "10% — льготная (книги, детское)" },
  { value: 0.22, label: "22% — общая" },
];

function isOsno(t?: TaxSettings): boolean {
  return t?.taxSystem === "ОСНО ООО" || t?.taxSystem === "ОСНО ИП";
}

export default function BulkActionsBar({
  selectedIds,
  rows,
  results,
  taxSettings,
  onClear,
  onAfterChange,
}: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const count = selectedIds.size;

  const idsArr = () => Array.from(selectedIds);

  const applyWhite = async (value: boolean | null) => {
    setBusy(true);
    try {
      const r = await api.products.bulkUpdate(idsArr(), {
        whitePurchase: value,
      });
      const label = value === true ? "Белая" : value === false ? "Не белая" : "По умолчанию";
      toast.show(`Обновлено ${r.updated} товаров: тип поставки → ${label}.`, {
        variant: "success",
      });
      await onAfterChange();
    } catch (e) {
      toast.show((e as Error).message, { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const applyVat = async (value: VatRate) => {
    setBusy(true);
    try {
      const r = await api.products.bulkUpdate(idsArr(), {
        vatRate: typeof value === "number" ? String(value) : value,
      });
      const label =
        value === "Не облагается"
          ? "Не облагается"
          : `${Math.round(value * 100)}%`;
      toast.show(`Обновлено ${r.updated} товаров: ставка НДС → ${label}.`, {
        variant: "success",
      });
      await onAfterChange();
    } catch (e) {
      toast.show((e as Error).message, { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const doExport = () => {
    const selectedRows = rows.filter((r) => selectedIds.has(r.id));
    void exportShortExcel(selectedRows, results);
    toast.show(`Экспорт ${selectedRows.length} товаров в Excel.`, {
      variant: "info",
    });
  };

  const doDelete = async () => {
    if (
      !window.confirm(
        `Удалить ${count} товаров без возможности восстановления?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.products.bulkDelete(idsArr());
      toast.show(`Удалено ${r.deleted} товаров.`, { variant: "success" });
      onClear();
      await onAfterChange();
    } catch (e) {
      toast.show((e as Error).message, { variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-bar">
      <div className="bulk-bar-meta">
        <span className="bulk-bar-count">Выбрано {count}</span>
        <button
          type="button"
          className="bulk-bar-clear"
          onClick={onClear}
          title="Снять выделение"
          aria-label="Снять выделение"
        >
          <X size={14} />
          <span>Снять</span>
        </button>
      </div>
      <div className="bulk-bar-actions">
        <BulkMenu
          label="Тип поставки"
          disabled={busy}
          options={WHITE_OPTIONS.map((o) => ({
            key: String(o.value),
            label: o.label,
            onPick: () => void applyWhite(o.value),
          }))}
        />
        {isOsno(taxSettings) && (
          <BulkMenu
            label="Ставка НДС"
            disabled={busy}
            options={VAT_OPTIONS.map((o) => ({
              key: String(o.value),
              label: o.label,
              onPick: () => void applyVat(o.value),
            }))}
          />
        )}
        <button
          type="button"
          className="btn-secondary toolbar-btn"
          onClick={doExport}
          disabled={busy}
          title="Экспорт выбранных в Excel"
        >
          <FileSpreadsheet size={14} />
          <span className="toolbar-btn-label">Excel</span>
        </button>
        <button
          type="button"
          className="btn-secondary toolbar-btn bulk-bar-danger"
          onClick={() => void doDelete()}
          disabled={busy}
          title="Удалить выбранные"
        >
          <Trash2 size={14} />
          <span className="toolbar-btn-label">Удалить</span>
        </button>
      </div>
    </div>
  );
}

interface MenuItem {
  key: string;
  label: string;
  onPick: () => void;
}

function BulkMenu({
  label,
  options,
  disabled,
}: {
  label: string;
  options: MenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="bulk-menu" ref={ref}>
      <button
        type="button"
        className="btn-secondary toolbar-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className="toolbar-btn-label">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="bulk-menu-list" role="menu">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              className="bulk-menu-item"
              onClick={() => {
                setOpen(false);
                o.onPick();
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
