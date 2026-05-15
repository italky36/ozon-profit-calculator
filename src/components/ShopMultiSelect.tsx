import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { Shop } from "../api";

interface Props {
  shops: Shop[];
  /** Selected shop ids. Empty set = «все магазины». */
  value: Set<number>;
  onChange: (next: Set<number>) => void;
  /** When true, renders inline (no card border) — for use inside the mobile
   * filters sheet where the surrounding sheet already has padding/border. */
  embedded?: boolean;
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function shopFilterLabel(
  selected: Set<number>,
  total: number,
): string {
  if (selected.size === 0 || selected.size === total) return "Все магазины";
  const word = pluralize(selected.size, "магазин", "магазина", "магазинов");
  return `${selected.size} ${word}`;
}

/** Desktop multi-select dropdown. Trigger shows a summary («N магазинов»),
 * popover has a search input and a checkbox list with «Все магазины» on top. */
export default function ShopMultiSelect({
  shops,
  value,
  onChange,
  embedded = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) => s.name.toLowerCase().includes(q));
  }, [shops, query]);

  const allSelected = value.size === 0 || value.size === shops.length;
  const toggleAll = () => {
    if (allSelected) {
      // From "all" state into empty selection — but semantically empty = "all",
      // so this would be a no-op. Treat as «invert»: deselect everything →
      // empty set keeps meaning of "all". To actually narrow selection, the
      // user clicks individual rows. So we route "all" click to clear set
      // (equivalent: "show all").
      onChange(new Set());
    } else {
      onChange(new Set());
    }
  };

  const toggleOne = (id: number) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const label = shopFilterLabel(value, shops.length);
  const summaryCount =
    value.size === 0 || value.size === shops.length ? shops.length : value.size;

  const panel = (
    <div className={embedded ? "shop-ms-panel embedded" : "shop-ms-panel"}>
      <label className="shop-ms-search">
        <Search size={14} className="shop-ms-search-icon" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти магазин"
          autoFocus={!embedded}
        />
        {query && (
          <button
            type="button"
            className="shop-ms-search-clear"
            onClick={() => setQuery("")}
            aria-label="Очистить"
          >
            <X size={12} />
          </button>
        )}
      </label>

      <ul className="shop-ms-list" role="listbox" aria-multiselectable="true">
        <li>
          <label className="shop-ms-row shop-ms-row-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span className="shop-ms-row-name">Все магазины</span>
            <span className="shop-ms-row-count">{shops.length}</span>
          </label>
        </li>
        {filtered.map((s) => {
          const checked = value.has(s.id);
          return (
            <li key={s.id}>
              <label className="shop-ms-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOne(s.id)}
                />
                {s.color && (
                  <span
                    className="shop-ms-color-dot"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                )}
                <span className="shop-ms-row-name">{s.name}</span>
              </label>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="shop-ms-empty">Ничего не найдено</li>
        )}
      </ul>
    </div>
  );

  if (embedded) {
    return <div className="shop-ms-wrap embedded">{panel}</div>;
  }

  return (
    <div ref={wrapRef} className="shop-ms-wrap">
      <button
        type="button"
        className={`shop-ms-trigger${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="shop-ms-trigger-label">{label}</span>
        <span className="shop-ms-trigger-count">{summaryCount}</span>
        <ChevronDown
          size={14}
          className={`shop-ms-chev${open ? " open" : ""}`}
        />
      </button>
      {open && panel}
    </div>
  );
}
