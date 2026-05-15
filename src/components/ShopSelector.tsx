import { useEffect, useRef, useState } from "react";
import { ChevronDown, Settings as SettingsIcon } from "lucide-react";
import type { Shop } from "../api";
import ShopBadge from "./ShopBadge";

interface Props {
  shops: Shop[];
  activeShopId: number | null;
  onSelect: (shopId: number) => void;
  onManage: () => void;
}

/** Header dropdown for choosing the active shop. Adjacent to the user block. */
export default function ShopSelector({
  shops,
  activeShopId,
  onSelect,
  onManage,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = shops.find((s) => s.id === activeShopId);

  if (shops.length === 0) {
    return (
      <button
        type="button"
        className="btn-icon"
        onClick={onManage}
        title="Добавить магазин"
        style={{ marginRight: 8 }}
      >
        + Магазин
      </button>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", marginRight: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={active?.name ?? "Выбрать магазин"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--border-soft)",
          background: "var(--surface, #fff)",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text)",
        }}
      >
        {active && (
          <ShopBadge
            code={active.shortName}
            color={active.color}
            title={active.name}
            shared={!active.isOwner}
          />
        )}
        <span
          style={{
            maxWidth: 160,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {active?.name ?? "Выбрать магазин"}
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 30,
            minWidth: 240,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border-soft)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            padding: 4,
          }}
        >
          {shops.map((s) => {
            const isActive = s.id === activeShopId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  background: isActive
                    ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                    : "transparent",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  textAlign: "left",
                  color: "var(--text)",
                }}
              >
                <ShopBadge
                  code={s.shortName}
                  color={s.color}
                  title={s.name}
                  shared={!s.isOwner}
                />
                <span
                  style={{
                    flex: 1,
                    fontWeight: isActive ? 600 : 500,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <span>{s.name}</span>
                  {!s.isOwner && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted, #888)",
                        fontWeight: 400,
                      }}
                    >
                      Общий магазин команды
                    </span>
                  )}
                </span>
                {s.hasOzonCreds && (
                  <span
                    title="Подключён Ozon API"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#16a34a",
                    }}
                  />
                )}
              </button>
            );
          })}
          <div
            style={{
              height: 1,
              background: "var(--border-soft)",
              margin: "4px 0",
            }}
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            <SettingsIcon size={14} />
            Управлять магазинами…
          </button>
        </div>
      )}
    </div>
  );
}
