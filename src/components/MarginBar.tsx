import type { ChannelKey } from "./ChannelBadge";
import { fmtRub } from "../format";

interface Props {
  fbo: number;
  fbs: number;
  real: number;
  best: ChannelKey | null;
}

const COLORS: Record<ChannelKey, string> = {
  FBO: "#005BFF",
  FBS: "#00A859",
  realFBS: "#FF6A00",
};

export default function MarginBar({ fbo, fbs, real, best }: Props) {
  const max = Math.max(fbo, fbs, real, 1);
  const bars: Array<{ key: ChannelKey; val: number }> = [
    { key: "FBO", val: fbo },
    { key: "FBS", val: fbs },
    { key: "realFBS", val: real },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 2, alignItems: "flex-end", height: 28 }}>
      {bars.map((b) => {
        const color = COLORS[b.key];
        const dim = best && b.key !== best;
        const h = Math.max(3, (b.val / max) * 26);
        return (
          <div
            key={b.key}
            title={`${b.key}: ${fmtRub(b.val)}`}
            style={{
              width: 8,
              borderRadius: "3px 3px 0 0",
              height: h,
              background: dim ? `${color}55` : color,
              transition: "height .3s",
            }}
          />
        );
      })}
    </div>
  );
}
