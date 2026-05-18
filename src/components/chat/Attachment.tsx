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
import { extractPeaksFromUrl, extractPeaksFromBlob } from "../../lib/audioPeaks";

const WAVEFORM_BUCKETS = 48;

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

/** Mini audio player for voice messages / audio attachments. Custom
 *  waveform visualisation: PCM amplitudes are decoded once on mount via
 *  AudioContext.decodeAudioData, downsampled to 48 buckets, and rendered
 *  as clickable vertical bars. Played portion of the wave fills with the
 *  accent colour; remaining bars stay muted. Click any bar to seek.
 *
 *  Width is intentionally narrow-ish (≈260 px) so the player fits in feed
 *  message bubbles without dominating the layout. Mobile renders at full
 *  available width via `width:auto` fallback.
 *
 *  Accepts `url` for in-feed playback OR a `blob` for the recording
 *  preview before upload (extractPeaks skips the network in that case). */
export interface AudioPlayerProps {
  /** Network URL or blob: / object URL — used for the `<audio>` element. */
  url: string;
  /** Optional Blob that backs `url` (when `url` is a `URL.createObjectURL`
   *  result). Lets us skip an HTTP round-trip for the recording preview. */
  blob?: Blob;
}

export function AudioPlayer({ url, blob }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [position, setPosition] = useState<number>(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    const onLoaded = () => {
      if (Number.isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("durationchange", onLoaded);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("durationchange", onLoaded);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  // Decode peaks once per source. For previews we have the blob in memory;
  // for feed attachments we fetch via URL. Either way the result is the
  // same downsampled amplitude array.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = blob
        ? await extractPeaksFromBlob(blob, WAVEFORM_BUCKETS)
        : await extractPeaksFromUrl(url, WAVEFORM_BUCKETS);
      if (!cancelled && result) setPeaks(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, blob]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
    } else {
      a.pause();
    }
  };

  const seekByRatio = (ratio: number) => {
    const a = audioRef.current;
    if (!a || !duration || !Number.isFinite(duration)) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    a.currentTime = clamped * duration;
    setPosition(a.currentTime);
  };

  const seekFromMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekByRatio((e.clientX - rect.left) / rect.width);
  };

  const playedRatio = duration > 0 ? Math.min(1, position / duration) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - position) : 0;

  // Bars to render: either real peaks (when decoded) or flat placeholders.
  const bars = peaks ?? new Array(WAVEFORM_BUCKETS).fill(0.15);
  const playedBucket = Math.floor(playedRatio * bars.length);

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
        width: 280,
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
        onClick={seekFromMouse}
        role="slider"
        aria-label="Позиция воспроизведения"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={position}
        style={{
          flex: 1,
          minWidth: 0,
          height: 28,
          display: "flex",
          alignItems: "center",
          gap: 2,
          cursor: duration > 0 ? "pointer" : "default",
        }}
      >
        {bars.map((peak, i) => {
          const h = Math.max(3, peak * 24);
          return (
            <span
              key={i}
              aria-hidden
              style={{
                flex: 1,
                height: `${h}px`,
                background:
                  i < playedBucket
                    ? "var(--accent, #2563eb)"
                    : "var(--border, #d4d4d4)",
                borderRadius: 1,
                transition: "background 60ms linear",
              }}
            />
          );
        })}
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
      <audio ref={audioRef} src={url} preload="metadata" />
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
  if (isAudio) return <AudioPlayer url={attachment.url} />;
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
