import { Phone, PhoneOff, Video } from "lucide-react";
import Avatar from "../Avatar";
import type { WorkspaceMember } from "../../api";

interface IncomingCallBannerProps {
  callId: number;
  fromUserId: number;
  callType: "audio" | "video";
  members: WorkspaceMember[];
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallBanner({
  fromUserId,
  callType,
  members,
  onAccept,
  onDecline,
}: IncomingCallBannerProps) {
  const member = members.find((m) => m.userId === fromUserId);
  const name = member?.fullName || member?.email || `Участник #${fromUserId}`;
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999,
        background: "var(--surface, #fff)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 320,
      }}
      role="alertdialog"
      aria-label="Входящий звонок"
    >
      <Avatar
        name={name}
        email={member?.email}
        avatarDataUrl={member?.avatarDataUrl ?? null}
        size={48}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted, #888)" }}>
          {callType === "video" ? "Видеозвонок" : "Аудиозвонок"}
        </div>
      </div>
      <button
        type="button"
        onClick={onDecline}
        style={iconBtnStyle("#c33")}
        aria-label="Отклонить"
      >
        <PhoneOff size={18} />
      </button>
      <button
        type="button"
        onClick={onAccept}
        style={iconBtnStyle("#16a34a")}
        aria-label="Принять"
      >
        {callType === "video" ? <Video size={18} /> : <Phone size={18} />}
      </button>
    </div>
  );
}

function iconBtnStyle(bg: string): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: bg,
    color: "#fff",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
