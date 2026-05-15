import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, ChevronDown } from "lucide-react";

export interface TabSpec<T extends string> {
  id: T;
  label: ReactNode;
}

interface Props<T extends string> {
  tabs: TabSpec<T>[];
  active: T;
  onChange: (id: T) => void;
  rightSlot?: ReactNode;
}

export default function TabBar<T extends string>({ tabs, active, onChange, rightSlot }: Props<T>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const activeTab = tabs.find((t) => t.id === active);

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab${active === t.id ? " active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-menu" ref={menuRef}>
        <button
          type="button"
          className="tab-menu-trigger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <Menu size={18} />
          <span className="tab-menu-trigger-label">{activeTab?.label}</span>
          <ChevronDown
            size={16}
            className={`tab-menu-trigger-chev${menuOpen ? " open" : ""}`}
          />
        </button>
        {menuOpen && (
          <div className="tab-menu-list" role="menu">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={`tab-menu-item${active === t.id ? " active" : ""}`}
                onClick={() => {
                  onChange(t.id);
                  setMenuOpen(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {rightSlot && <div className="tab-bar-actions">{rightSlot}</div>}
    </div>
  );
}
