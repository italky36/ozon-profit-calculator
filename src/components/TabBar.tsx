import type { ReactNode } from "react";

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
      {rightSlot && <div className="tab-bar-actions">{rightSlot}</div>}
    </div>
  );
}
