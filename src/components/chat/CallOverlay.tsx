import { useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import type { CallState } from "../../lib/callManager";
import Avatar from "../Avatar";
import type { WorkspaceMember } from "../../api";

interface CallOverlayProps {
  state: CallState;
  selfUserId: number;
  members: WorkspaceMember[];
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onHangup: () => void;
}

function findMember(
  members: WorkspaceMember[],
  userId: number,
): WorkspaceMember | undefined {
  return members.find((m) => m.userId === userId);
}

/** Single tile in the video grid. Renders either the remote stream or a
 * placeholder with the peer's avatar (audio-only, or video not yet flowing). */
function PeerTile({
  userId,
  stream,
  label,
  member,
  muted,
  status,
}: {
  userId: number;
  stream: MediaStream | null;
  label: string;
  member?: WorkspaceMember;
  muted?: boolean;
  /** 'connected' = in connectedUserIds. 'ringing' = invited but not yet
   *  joined. Renders as a coloured dot next to the label. Self tile is
   *  always 'connected'. */
  status?: "connected" | "ringing";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  const hasVideo =
    stream != null && stream.getVideoTracks().some((t) => t.enabled);
  return (
    <div
      style={{
        position: "relative",
        background: "#111",
        borderRadius: 12,
        overflow: "hidden",
        // No aspectRatio — the tile fills its grid cell (parent constrains
        // height via `min-height: 0`), and the video inside scales with
        // object-fit: contain so the picture isn't cropped.
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          data-testid={`peer-video-${userId}`}
        />
      ) : (
        <Avatar
          name={member?.fullName || member?.email || ""}
          email={member?.email || ""}
          avatarDataUrl={member?.avatarDataUrl ?? null}
          size={96}
        />
      )}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {status && (
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: status === "connected" ? "#22c55e" : "#eab308",
            }}
          />
        )}
        {label}
      </div>
    </div>
  );
}

export function CallOverlay({
  state,
  selfUserId,
  members,
  onToggleMic,
  onToggleCamera,
  onHangup,
}: CallOverlayProps) {
  const selfMember = findMember(members, selfUserId);
  const remotes = [...state.remotePeers.entries()];
  // Invitees who haven't joined yet AND don't have a remote stream — show
  // them as placeholder tiles with a yellow «ringing» dot so the caller
  // sees who is still pending.
  const ringingInvitees = state.invitedUserIds.filter(
    (uid) =>
      uid !== selfUserId &&
      !state.connectedUserIds.has(uid) &&
      !state.remotePeers.has(uid),
  );
  const totalTiles = 1 + remotes.length + ringingInvitees.length;
  const columns = totalTiles <= 1 ? 1 : totalTiles <= 4 ? 2 : 3;

  const statusLabel =
    state.status === "ringing"
      ? state.role === "caller"
        ? "Звонок…"
        : "Входящий звонок"
      : state.status === "connecting"
        ? "Подключение…"
        : state.status === "live"
          ? "На связи"
          : "Завершено";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,16,20,0.96)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        padding: 24,
      }}
      role="dialog"
      aria-label="Звонок"
    >
      <div
        style={{
          color: "#fff",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 14, opacity: 0.7 }}>{statusLabel}</span>
        <span style={{ fontSize: 14, opacity: 0.5 }}>
          {state.callType === "video" ? "Видео" : "Аудио"} ·{" "}
          {state.connectedUserIds.size}/{state.invitedUserIds.length} на связи
        </span>
      </div>

      <div
        style={{
          flex: 1,
          // Critical: without min-height:0 the grid refuses to shrink below
          // its content size, pushing the controls bar off-screen.
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gridAutoRows: "1fr",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <PeerTile
          userId={selfUserId}
          stream={state.localStream}
          label={
            (selfMember?.fullName || selfMember?.email || "Вы") +
            (state.micMuted ? " (mic выкл)" : "")
          }
          member={selfMember}
          muted={true}
          status="connected"
        />
        {remotes.map(([uid, stream]) => {
          const m = findMember(members, uid);
          return (
            <PeerTile
              key={uid}
              userId={uid}
              stream={stream}
              label={m?.fullName || m?.email || `Участник #${uid}`}
              member={m}
              status="connected"
            />
          );
        })}
        {ringingInvitees.map((uid) => {
          const m = findMember(members, uid);
          return (
            <PeerTile
              key={uid}
              userId={uid}
              stream={null}
              label={
                (m?.fullName || m?.email || `Участник #${uid}`) + " · звоним…"
              }
              member={m}
              status="ringing"
            />
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 16,
          paddingTop: 24,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onToggleMic}
          style={controlBtn(state.micMuted)}
          aria-label={state.micMuted ? "Включить микрофон" : "Выключить микрофон"}
        >
          {state.micMuted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        {state.callType === "video" && (
          <button
            type="button"
            onClick={onToggleCamera}
            style={controlBtn(state.cameraOff)}
            aria-label={state.cameraOff ? "Включить камеру" : "Выключить камеру"}
          >
            {state.cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        )}
        <button
          type="button"
          onClick={onHangup}
          style={{ ...controlBtn(false), background: "#c33", color: "#fff" }}
          aria-label="Завершить"
        >
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}

function controlBtn(active: boolean): React.CSSProperties {
  return {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: active ? "#444" : "#222",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
