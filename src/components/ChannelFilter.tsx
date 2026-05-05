import type { ChannelKey } from "./ChannelBadge";

export type FilterValue = "Все" | ChannelKey;

const ORDER: FilterValue[] = ["Все", "FBO", "FBS", "realFBS"];

const VARIANT: Record<FilterValue, string> = {
  Все: "all",
  FBO: "fbo",
  FBS: "fbs",
  realFBS: "real",
};

interface Props {
  active: FilterValue;
  onChange: (v: FilterValue) => void;
}

export default function ChannelFilter({ active, onChange }: Props) {
  return (
    <div className="ch-filter">
      {ORDER.map((ch) => {
        const isActive = active === ch;
        return (
          <button
            key={ch}
            type="button"
            className={`ch-pill${isActive ? ` active ${VARIANT[ch]}` : ""}`}
            onClick={() => onChange(ch)}
          >
            {ch}
          </button>
        );
      })}
    </div>
  );
}
