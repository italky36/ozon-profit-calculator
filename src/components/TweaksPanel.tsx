import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Tweaks } from "../lib/useTweaks";

interface PanelProps {
  open: boolean;
  onClose: () => void;
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, val: Tweaks[K]) => void;
}

export default function TweaksPanel({ open, onClose, tweaks, setTweak }: PanelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 16, y: 16 });

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    if (!panel) return;
    const clamp = () => {
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const maxR = Math.max(16, window.innerWidth - w - 16);
      const maxB = Math.max(16, window.innerHeight - h - 16);
      offsetRef.current = {
        x: Math.min(maxR, Math.max(16, offsetRef.current.x)),
        y: Math.min(maxB, Math.max(16, offsetRef.current.y)),
      };
      panel.style.right = `${offsetRef.current.x}px`;
      panel.style.bottom = `${offsetRef.current.y}px`;
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open]);

  if (!open) return null;

  const onDragStart = (e: React.MouseEvent) => {
    const panel = ref.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: Math.max(16, startRight - (ev.clientX - sx)),
        y: Math.max(16, startBottom - (ev.clientY - sy)),
      };
      panel.style.right = `${offsetRef.current.x}px`;
      panel.style.bottom = `${offsetRef.current.y}px`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 300,
        width: 280,
        background: "rgba(250, 249, 247, 0.92)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        borderRadius: 14,
        border: "1px solid rgba(255, 255, 255, 0.6)",
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.18)",
        font: '11.5px/1.4 "Inter", system-ui, sans-serif',
        color: "#29261b",
        overflow: "hidden",
      }}
    >
      <div
        onMouseDown={onDragStart}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 8px 10px 14px",
          cursor: "move",
          userSelect: "none",
        }}
      >
        <b style={{ fontSize: 12, fontWeight: 600 }}>Настройки оформления</b>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          style={{
            border: 0,
            background: "transparent",
            color: "rgba(41, 38, 27, 0.55)",
            width: 22,
            height: 22,
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Закрыть"
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: "2px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <Section label="Внешний вид" />
        <ColorRow label="Акцентный цвет" value={tweaks.accentColor}
          onChange={(v) => setTweak("accentColor", v)} />
        <ToggleRow label="Тёмная шапка" value={tweaks.darkHeader}
          onChange={(v) => setTweak("darkHeader", v)} />
        <Section label="Таблица" />
        <ToggleRow label="Мини-график маржи" value={tweaks.showChart}
          onChange={(v) => setTweak("showChart", v)} />
        <ToggleRow label="Только unit-экономика" value={tweaks.unitMode}
          onChange={(v) => setTweak("unitMode", v)} />
        <RadioRow<Tweaks["density"]>
          label="Плотность"
          value={tweaks.density}
          options={[
            { value: "normal", label: "Обычно" },
            { value: "compact", label: "Компакт" },
          ]}
          onChange={(v) => setTweak("density", v)}
        />
      </div>
    </div>
  );
}

const Section = ({ label }: { label: string }) => (
  <div
    style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "rgba(41, 38, 27, 0.45)",
      paddingTop: 4,
    }}
  >
    {label}
  </div>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
    <span style={{ fontWeight: 500, color: "rgba(41, 38, 27, 0.72)" }}>{label}</span>
    {children}
  </div>
);

const ColorRow = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <Row label={label}>
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 56,
        height: 22,
        border: "0.5px solid rgba(0, 0, 0, 0.1)",
        borderRadius: 6,
        padding: 0,
        cursor: "pointer",
        background: "transparent",
      }}
    />
  </Row>
);

const ToggleRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <Row label={label}>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        position: "relative",
        width: 32,
        height: 18,
        border: 0,
        borderRadius: 999,
        background: value ? "#34c759" : "rgba(0, 0, 0, 0.15)",
        transition: "background .15s",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <i
        style={{
          position: "absolute",
          top: 2,
          left: value ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
          transition: "left .15s",
          display: "block",
        }}
      />
    </button>
  </Row>
);

interface RadioOption<T> {
  value: T;
  label: string;
}

function RadioRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <div
        style={{
          position: "relative",
          display: "flex",
          padding: 2,
          borderRadius: 8,
          background: "rgba(0, 0, 0, 0.06)",
        }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: 0,
              background: o.value === value ? "rgba(255, 255, 255, 0.95)" : "transparent",
              boxShadow: o.value === value ? "0 1px 2px rgba(0, 0, 0, 0.12)" : "none",
              color: "inherit",
              font: "inherit",
              fontWeight: 500,
              minHeight: 22,
              borderRadius: 6,
              cursor: "pointer",
              padding: "4px 10px",
              transition: "all .15s",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}
