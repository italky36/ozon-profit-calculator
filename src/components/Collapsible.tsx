import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  badge?: number | string;
  children: ReactNode;
}

export default function Collapsible({ title, defaultOpen = true, badge, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible">
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          className={`collapsible-chevron${open ? " open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="#8B95A8"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="collapsible-title">{title}</span>
        {badge != null && <span className="collapsible-badge">{badge}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
