import { useEffect } from "react";
import { X } from "lucide-react";
import type { Shop } from "../api";
import type { FilterValue } from "./ChannelFilter";
import ChannelFilter from "./ChannelFilter";
import ShopMultiSelect from "./ShopMultiSelect";

interface Props {
  open: boolean;
  onClose: () => void;
  shops: Shop[];
  shopFilter: Set<number>;
  onShopFilterChange: (next: Set<number>) => void;
  channelFilter: FilterValue;
  onChannelFilterChange: (v: FilterValue) => void;
  activeOnly: boolean;
  onActiveOnlyChange: (v: boolean) => void;
  /** Result count to show in the «Показать N товаров» button. */
  resultCount: number;
}

/** Bottom sheet (mobile) housing all product filters. Reuses .gs-sheet /
 * .gs-backdrop styles from ShopSettings for visual consistency. */
export default function ProductFiltersSheet({
  open,
  onClose,
  shops,
  shopFilter,
  onShopFilterChange,
  channelFilter,
  onChannelFilterChange,
  activeOnly,
  onActiveOnlyChange,
  resultCount,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const reset = () => {
    onShopFilterChange(new Set());
    onChannelFilterChange("Все");
    onActiveOnlyChange(false);
  };

  return (
    <>
      <div
        className={`gs-backdrop${open ? " open" : ""}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`gs-sheet${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Фильтры товаров"
      >
        <div className="gs-sheet-handle-wrap" onClick={onClose}>
          <span className="gs-sheet-handle" />
        </div>
        <div className="gs-sheet-header">
          <div className="gs-sheet-title">Фильтры</div>
          <button
            type="button"
            className="filters-reset-link"
            onClick={reset}
          >
            Сбросить
          </button>
          <button
            type="button"
            className="gs-iconbtn"
            onClick={onClose}
            aria-label="Закрыть"
            style={{ marginLeft: 8 }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="gs-sheet-body filters-sheet-body">
          {shops.length > 1 && (
            <div className="filters-section">
              <div className="filters-section-label">Магазины</div>
              <ShopMultiSelect
                shops={shops}
                value={shopFilter}
                onChange={onShopFilterChange}
                embedded
              />
            </div>
          )}
          <div className="filters-section">
            <div className="filters-section-label">Схема</div>
            <ChannelFilter
              active={channelFilter}
              onChange={onChannelFilterChange}
            />
          </div>
          <div className="filters-section">
            <label className="active-only-toggle">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => onActiveOnlyChange(e.target.checked)}
              />
              <span>Только активные</span>
            </label>
          </div>
        </div>
        <div className="gs-sheet-footer">
          <button
            type="button"
            className="gs-btn gs-btn-primary filters-apply-btn"
            onClick={onClose}
          >
            Показать {resultCount}{" "}
            {pluralize(resultCount, "товар", "товара", "товаров")}
          </button>
        </div>
      </div>
    </>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
