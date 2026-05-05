export type ChannelKey = "FBO" | "FBS" | "realFBS";

const CLASS: Record<ChannelKey, string> = {
  FBO: "ch-badge fbo",
  FBS: "ch-badge fbs",
  realFBS: "ch-badge real",
};

interface Props {
  channel: ChannelKey | null;
}

export default function ChannelBadge({ channel }: Props) {
  if (!channel) return <span className="muted">—</span>;
  return <span className={CLASS[channel]}>{channel}</span>;
}
