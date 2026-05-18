import { useEffect, useRef, useState } from "react";
import {
  File,
  FileText,
  Image as ImageIcon,
  FileArchive,
  Pause,
  Play,
} from "lucide-react";
import type { ChatAttachment } from "../../api";

function renderIcon(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon size={18} />;
  if (mime === "application/pdf") return <FileText size={18} />;
  if (mime === "application/zip" || mime === "application/x-zip-compressed")
    return <FileArchive size={18} />;
  if (mime.startsWith("text/")) return <FileText size={18} />;
  return <File size={18} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Mini audio player for voice messages / audio attachments. Native
 *  <audio controls> works but looks heavyweight and inconsistent across
 *  browsers. Custom: play/pause toggle + click-to-seek progress bar +
 *  «current / total» readout. Loads metadata lazily on first play so a
 *  long feed of voice messages doesn't preload every blob. */
function AudioPlayer({ attachment }: { attachment: ChatAttachment }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [position, setPosition] = useState<number>(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    const onLoaded = () => {
      // MediaRecorder webm blobs sometimes report Infinity until the user
      // seeks past the end — guard against it.
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("durationchange", onLoaded);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("play", () => setPlaying(true));
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("durationchange", onLoaded);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
    } else {
      a.pause();
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration || !Number.isFinite(duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setPosition(a.currentTime);
  };

  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - position) : 0;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 20,
        background: "var(--bg-soft, #f3f3f3)",
        border: "1px solid var(--border, #e2e2e2)",
        width: 260,
        maxWidth: "100%",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        title={playing ? "Пауза" : "Воспроизвести"}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--accent, #2563eb)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div
        onClick={seek}
        role="slider"
        aria-label="Позиция воспроизведения"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={position}
        style={{
          flex: 1,
          minWidth: 0,
          height: 4,
          borderRadius: 2,
          background: "var(--border, #ddd)",
          cursor: duration > 0 ? "pointer" : "default",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${ratio * 100}%`,
            background: "var(--accent, #2563eb)",
            borderRadius: 2,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          color: "var(--muted, #888)",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {playing || position > 0
          ? formatDuration(position)
          : formatDuration(duration || 0)}
        {playing && duration > 0 && ` / ${formatDuration(remaining)}`}
      </span>
      <audio ref={audioRef} src={attachment.url} preload="metadata" />
    </div>
  );
}

export default function Attachment({
  attachment,
}: {
  attachment: ChatAttachment;
}) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isAudio = attachment.mimeType.startsWith("audio/");
  if (isAudio) return <AudioPlayer attachment={attachment} />;
  if (isImage) {
    // Open in new tab on click — server sends Content-Disposition: inline,
    // so browser previews. NO `download` attribute here — that would force
    // a save instead of preview, defeating the inline experience.
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${attachment.filename} · ${formatSize(attachment.sizeBytes)}`}
        style={{
          display: "inline-block",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border, #e2e2e2)",
          maxWidth: 320,
        }}
      >
        <img
          src={attachment.url}
          alt={attachment.filename}
          style={{
            display: "block",
            maxWidth: 320,
            maxHeight: 240,
            objectFit: "cover",
          }}
        />
      </a>
    );
  }
  // For non-images: download attribute triggers save. NO target=_blank — it
  // conflicts with download and some browsers ignore the latter.
  return (
    <a
      href={attachment.url}
      download={attachment.filename}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border, #e2e2e2)",
        background: "var(--bg-soft, #fafafa)",
        textDecoration: "none",
        color: "inherit",
        maxWidth: 320,
      }}
    >
      {renderIcon(attachment.mimeType)}
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {attachment.filename}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted, #888)" }}>
          {formatSize(attachment.sizeBytes)}
        </span>
      </span>
    </a>
  );
}
