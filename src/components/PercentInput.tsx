/**
 * Number input that displays / accepts a value in *percent* but stores it as a
 * fraction. Engine throughout the project keeps rates in 0..1 form (`0.05`,
 * `0.345`); the UI is more humane in percent form (`5`, `34.5`).
 *
 * Usage: `<PercentInput value={0.05} onChange={(v) => set(v)} />` — user sees `5`
 * with `%` suffix in the input, `onChange` fires with `0.05`.
 */
interface Props {
  value: number;
  onChange: (v: number) => void;
  /** Step in percent (e.g. 0.1 means 0.1%). Defaults to 0.1. */
  step?: number;
  /** Min/max in percent. */
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
}

const stripFloatNoise = (n: number): number =>
  Number(n.toFixed(6));

export default function PercentInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  disabled,
  title,
}: Props) {
  const display = stripFloatNoise(value * 100);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        position: "relative",
        width: "100%",
      }}
    >
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        title={title}
        value={display}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-") {
            onChange(0);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(n / 100);
        }}
        style={{
          width: "100%",
          paddingRight: 24,
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 12,
          color: "var(--muted)",
          pointerEvents: "none",
        }}
      >
        %
      </span>
    </div>
  );
}
