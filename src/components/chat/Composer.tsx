import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import {
  FileText,
  Mic,
  MicOff,
  Paperclip,
  Reply,
  Send,
  Smile,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMessage, WorkspaceMember } from "../../api";
import MentionAutocomplete from "./MentionAutocomplete";
import EmojiPicker from "./EmojiPicker";

/** Format byte count for the file-tile tooltip (e.g. "1.4 MB"). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const TYPING_REFRESH_MS = 3_000;
const MENTION_MAX_RESULTS = 8;
const TRIGGER_RE = /(?:^|\s)@([\p{L}\p{N}_.-]*)$/u;
/** Hard cap on voice-message length (browser auto-stops at this point and
 *  the recorded blob is attached to the draft). Mirrors WhatsApp/Slack. */
const VOICE_MAX_SECS = 120;
/** Format MM:SS for the recording timer. */
function fmtMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Pick a MediaRecorder MIME the browser can actually produce. Most modern
 *  browsers prefer audio/webm;codecs=opus; Safari falls back to mp4. The
 *  server `audio/*` allowlist accepts whatever lands. */
function pickRecorderMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function extForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "audio";
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s._-]+/g, "");
}

function mentionInsertName(m: WorkspaceMember): string {
  const candidate = m.fullName.trim() || m.email.split("@")[0];
  // Replace spaces with `.` so the resulting token matches our server regex
  // (`@([\p{L}\p{N}_.-]{2,40})`).
  return `@${candidate.replace(/\s+/g, ".")}`;
}

interface ComposerProps {
  channelName: string;
  disabled?: boolean;
  members: WorkspaceMember[];
  onSendText: (text: string) => Promise<void>;
  onSendWithAttachments: (text: string, files: File[]) => Promise<void>;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  /** Suppress "Enter — отправить · Shift+Enter — новая строка" hint. Set
   *  true on touch devices where keyboard shortcuts don't apply. */
  hideHints?: boolean;
  /** When non-null, the composer renders a quote-preview banner above the
   *  textarea and the parent (ChatPage) is expected to thread
   *  `quotedMessageId` through `onSendText` / `onSendWithAttachments` and
   *  clear this prop after a successful send. */
  quoting?: ChatMessage | null;
  onCancelQuote?: () => void;
}

export default function Composer({
  channelName,
  disabled,
  members,
  onSendText,
  onSendWithAttachments,
  onTypingStart,
  onTypingStop,
  hideHints,
  quoting,
  onCancelQuote,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  /** Voice recording state. Null = not recording; non-null while the
   *  MediaRecorder is capturing. The recorder + media stream + tick timer
   *  live on refs so React renders don't tear them down. */
  const [recordingSecs, setRecordingSecs] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderCancelledRef = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingRefreshAt = useRef<number>(0);

  /** Where to place the caret after the *next* React commit. Set by
   * insertEmoji, consumed by useLayoutEffect below. Using a ref (not state)
   * avoids triggering an extra render. */
  const pendingCaretRef = useRef<number | null>(null);

  /** Blob URLs for image previews — one per file in `pending`. Computed
   * synchronously from the file list (memoised on identity), and revoked
   * by the cleanup effect below when the URL list changes or the composer
   * unmounts. Non-image files map to null. */
  const previewUrls = useMemo<Array<string | null>>(
    () =>
      pending.map((f) =>
        f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      ),
    [pending],
  );
  useEffect(
    () => () => {
      for (const u of previewUrls) {
        if (u) URL.revokeObjectURL(u);
      }
    },
    [previewUrls],
  );

  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    // Read from DOM, not the closure: `text` state lags behind rapid clicks
    // (React batches setState; the closure stays on the version of `text`
    // captured when the callback ran). `el.value` is always the latest.
    const current = el.value;
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    pendingCaretRef.current = start + emoji.length;
    setText(current.slice(0, start) + emoji + current.slice(end));
  }, []);

  useLayoutEffect(() => {
    // Runs synchronously after React commits the new `text` and before paint
    // — caret is set on the freshly-rendered DOM, no race with rAF.
    if (pendingCaretRef.current == null || !textareaRef.current) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    el.focus();
    el.selectionStart = pos;
    el.selectionEnd = pos;
  }, [text]);

  // Auto-focus the textarea when the user picks a quote target — they came
  // here intending to type a reply, no reason to make them click the input.
  // Keyed on the quoted message id so picking a different quote re-focuses.
  const quotingId = quoting?.id ?? null;
  useEffect(() => {
    if (quotingId == null) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    // Place the caret at the current end of any existing draft.
    const end = el.value.length;
    el.selectionStart = end;
    el.selectionEnd = end;
  }, [quotingId]);

  const mentionCandidates = useMemo<WorkspaceMember[]>(() => {
    if (mentionQuery === null) return [];
    const q = normalize(mentionQuery);
    if (q.length === 0) {
      return members.slice(0, MENTION_MAX_RESULTS);
    }
    const filtered = members.filter((m) => {
      const nameKey = normalize(m.fullName);
      const emailKey = normalize(m.email.split("@")[0] ?? "");
      return nameKey.includes(q) || emailKey.includes(q);
    });
    return filtered.slice(0, MENTION_MAX_RESULTS);
  }, [mentionQuery, members]);

  useEffect(() => {
    // Clamp selection when candidates list shrinks — derived state but
    // local-only, so a setState is the simplest way to stay consistent.
    if (mentionSelectedIdx >= mentionCandidates.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionSelectedIdx(0);
    }
  }, [mentionCandidates.length, mentionSelectedIdx]);

  // Stop typing when unmounting / switching channels.
  useEffect(() => {
    return () => {
      if (typingRefreshAt.current > 0) {
        typingRefreshAt.current = 0;
        onTypingStop?.();
      }
    };
  }, [onTypingStop]);

  const bumpTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingRefreshAt.current > TYPING_REFRESH_MS) {
      typingRefreshAt.current = now;
      onTypingStart?.();
    }
  }, [onTypingStart]);

  const stopTyping = useCallback(() => {
    if (typingRefreshAt.current === 0) return;
    typingRefreshAt.current = 0;
    onTypingStop?.();
  }, [onTypingStop]);

  const acceptFiles = useCallback(
    (incoming: File[]) => {
      setError(null);
      const next = [...pending];
      for (const f of incoming) {
        if (next.length >= MAX_FILES) {
          setError(`Не более ${MAX_FILES} файлов за раз`);
          break;
        }
        if (f.size > MAX_FILE_BYTES) {
          setError(`Файл «${f.name}» больше 25 МБ`);
          continue;
        }
        next.push(f);
      }
      setPending(next);
    },
    [pending],
  );

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) acceptFiles(files);
    if (fileInput.current) fileInput.current.value = "";
  };

  /** Tear down the mic stream + timer. Used by both stop and cancel — they
   *  differ only by whether the produced blob lands in `pending`. */
  const teardownRecorder = useCallback(() => {
    if (recorderTickRef.current) {
      clearInterval(recorderTickRef.current);
      recorderTickRef.current = null;
    }
    const stream = recorderStreamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
    recorderStreamRef.current = null;
    recorderRef.current = null;
    recorderChunksRef.current = [];
    setRecordingSecs(null);
  }, []);

  const startRecording = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);
    if (typeof MediaRecorder === "undefined") {
      setError("Браузер не поддерживает запись аудио");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Запись недоступна — приложение работает не в secure context. " +
          "Откройте через https:// или http://localhost.",
      );
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException).name ?? "";
      const msg =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Доступ к микрофону запрещён. Разрешите его в настройках браузера."
          : name === "NotFoundError"
            ? "Микрофон не найден. Подключите устройство и повторите."
            : `Не удалось получить доступ к микрофону${name ? ` (${name})` : ""}.`;
      setError(msg);
      return;
    }
    const mime = pickRecorderMime();
    let mr: MediaRecorder;
    try {
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      setError("Не удалось запустить запись аудио");
      return;
    }
    recorderStreamRef.current = stream;
    recorderRef.current = mr;
    recorderChunksRef.current = [];
    recorderCancelledRef.current = false;
    mr.addEventListener("dataavailable", (evt) => {
      if (evt.data && evt.data.size > 0) recorderChunksRef.current.push(evt.data);
    });
    mr.addEventListener("stop", () => {
      const wasCancelled = recorderCancelledRef.current;
      const chunks = recorderChunksRef.current.slice();
      teardownRecorder();
      if (wasCancelled || chunks.length === 0) return;
      const blobMime = mr.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks, { type: blobMime });
      if (blob.size === 0) return;
      if (blob.size > MAX_FILE_BYTES) {
        setError("Запись больше 25 МБ — сократите длительность");
        return;
      }
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const file = new File([blob], `voice-${ts}.${extForMime(blobMime)}`, {
        type: blobMime,
      });
      setPending((prev) => [...prev, file]);
    });
    // Start with 250 ms chunks so dataavailable fires regularly — required
    // by some browsers (Firefox) to deliver any data at all when stop is
    // called shortly after start.
    mr.start(250);
    setRecordingSecs(0);
    recorderTickRef.current = setInterval(() => {
      setRecordingSecs((s) => {
        if (s == null) return s;
        const next = s + 1;
        if (next >= VOICE_MAX_SECS) {
          // Auto-stop at the cap; the recorder's `stop` event will commit
          // the partial blob to `pending`.
          try {
            recorderRef.current?.stop();
          } catch {
            /* already stopped */
          }
        }
        return next;
      });
    }, 1000);
  }, [teardownRecorder]);

  const stopRecording = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    recorderCancelledRef.current = false;
    try {
      mr.stop();
    } catch {
      /* race with auto-stop */
      teardownRecorder();
    }
  }, [teardownRecorder]);

  const cancelRecording = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    recorderCancelledRef.current = true;
    try {
      mr.stop();
    } catch {
      teardownRecorder();
    }
  }, [teardownRecorder]);

  // Belt-and-suspenders cleanup: if the composer unmounts mid-recording
  // (channel switch, navigation), drop the mic stream so the OS-level
  // recording indicator doesn't linger.
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderCancelledRef.current = true;
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      teardownRecorder();
    };
  }, [teardownRecorder]);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      acceptFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) acceptFiles(files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const removePending = (idx: number) => {
    setPending(pending.filter((_, i) => i !== idx));
  };

  const canSend = !busy && !disabled && (text.trim() !== "" || pending.length > 0);

  const send = useCallback(async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const body = text.trim();
      if (pending.length > 0) {
        await onSendWithAttachments(body, pending);
      } else {
        await onSendText(body);
      }
      setText("");
      setPending([]);
      stopTyping();
      setEmojiOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [canSend, text, pending, onSendText, onSendWithAttachments, stopTyping]);

  const insertMention = useCallback(
    (m: WorkspaceMember) => {
      const el = textareaRef.current;
      if (!el) return;
      const caret = el.selectionStart;
      const before = text.slice(0, caret);
      const after = text.slice(caret);
      const triggerMatch = before.match(TRIGGER_RE);
      if (!triggerMatch) return;
      const triggerStart = before.length - triggerMatch[0].length + (
        // если триггер начинается с пробела, оставляем пробел перед @
        triggerMatch[0].startsWith("@") ? 0 : 1
      );
      const insertion = `${mentionInsertName(m)} `;
      const nextText = before.slice(0, triggerStart) + insertion + after;
      setText(nextText);
      setMentionQuery(null);
      // Восстановить каретку после вставки.
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const pos = triggerStart + insertion.length;
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
        textareaRef.current.focus();
      });
    },
    [text],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelectedIdx((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelectedIdx(
          (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionCandidates[mentionSelectedIdx]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      style={{
        position: "relative",
        border: "1px solid var(--border, #e2e2e2)",
        borderRadius: 8,
        padding: 10,
        background: dragOver ? "var(--bg-soft, #f5f5f5)" : "var(--bg, #fff)",
      }}
    >
      {emojiOpen && (
        <EmojiPicker
          onPick={(e) => insertEmoji(e)}
          onClose={() => setEmojiOpen(false)}
        />
      )}
      {quoting && (
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 8,
            marginBottom: 8,
            padding: "6px 8px 6px 0",
            background: "var(--bg-soft, #f3f3f3)",
            borderRadius: 6,
            borderLeft: "3px solid var(--accent, #2563eb)",
          }}
        >
          <Reply
            size={16}
            style={{
              color: "var(--accent, #2563eb)",
              marginLeft: 8,
              marginTop: 2,
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--accent, #2563eb)",
              }}
            >
              {quoting.author.fullName ||
                quoting.author.email.split("@")[0] ||
                "—"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--muted, #555)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {quoting.deletedAt
                ? "сообщение удалено"
                : quoting.body ||
                  (quoting.attachments.length > 0 ? "📎 вложение" : "")}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelQuote}
            title="Отменить цитату"
            aria-label="Отменить цитату"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--muted, #888)",
              padding: 4,
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8,
          }}
        >
          {pending.map((f, idx) => {
            const previewUrl = previewUrls[idx] ?? null;
            const isImage = previewUrl != null;
            const tooltip = `${f.name} · ${formatBytes(f.size)}`;
            return (
              <div
                key={`${f.name}-${idx}`}
                title={tooltip}
                style={{
                  position: "relative",
                  width: 64,
                  height: 64,
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--bg-soft, #f3f3f3)",
                  border: "1px solid var(--border, #ddd)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {isImage ? (
                  <img
                    src={previewUrl}
                    alt={f.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 4,
                      width: "100%",
                      height: "100%",
                      boxSizing: "border-box",
                      color: "var(--muted, #888)",
                    }}
                  >
                    <FileText size={20} />
                    <span
                      style={{
                        fontSize: 10,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        width: "100%",
                        textAlign: "center",
                      }}
                    >
                      {f.name}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removePending(idx)}
                  title="Убрать"
                  aria-label="Убрать"
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ position: "relative" }}>
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <MentionAutocomplete
            candidates={mentionCandidates}
            selectedIdx={mentionSelectedIdx}
            onPick={(m) => insertMention(m)}
            onHoverIdx={setMentionSelectedIdx}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            // Telegram-style UX: as soon as user starts typing, dismiss the
            // emoji picker. Programmatic setText (from emoji insert) doesn't
            // fire onChange, so picking emojis with the mouse stays open.
            if (emojiOpen) setEmojiOpen(false);
            if (next.trim()) bumpTyping();
            else stopTyping();
            // Detect @trigger by looking at caret position.
            const caret = e.target.selectionStart;
            const before = next.slice(0, caret);
            const m = before.match(TRIGGER_RE);
            if (m) {
              setMentionQuery(m[1]);
              setMentionSelectedIdx(0);
            } else if (mentionQuery !== null) {
              setMentionQuery(null);
            }
          }}
          onBlur={() => {
            stopTyping();
            // Defer closing so mousedown on a popover item still fires.
            setTimeout(() => setMentionQuery(null), 150);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={`Сообщение в #${channelName}`}
          rows={2}
          disabled={disabled || busy}
          style={{
            width: "100%",
            minHeight: 44,
            resize: "vertical",
            border: "none",
            outline: "none",
            fontFamily: "inherit",
            fontSize: 14,
            background: "transparent",
            color: "inherit",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
        }}
      >
        <button
          type="button"
          className="btn-icon"
          onClick={() => fileInput.current?.click()}
          title="Прикрепить файл"
          disabled={disabled || busy || recordingSecs != null}
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="btn-icon"
          onClick={() => setEmojiOpen((v) => !v)}
          title="Эмодзи"
          disabled={disabled || busy || recordingSecs != null}
          style={emojiOpen ? { color: "var(--accent)" } : undefined}
        >
          <Smile size={16} />
        </button>
        {recordingSecs == null ? (
          <button
            type="button"
            className="btn-icon"
            onClick={() => void startRecording()}
            title="Записать голосовое сообщение"
            aria-label="Записать голосовое сообщение"
            disabled={disabled || busy}
          >
            <Mic size={16} />
          </button>
        ) : (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "2px 10px",
              borderRadius: 14,
              background: "var(--accent-soft, #fee2e2)",
              color: "var(--danger, #c33)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: "var(--danger, #c33)",
                animation: "ozonRecPulse 1s ease-in-out infinite",
              }}
            />
            <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
              {fmtMMSS(recordingSecs)} / {fmtMMSS(VOICE_MAX_SECS)}
            </span>
            <button
              type="button"
              onClick={cancelRecording}
              title="Отменить запись"
              aria-label="Отменить запись"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                padding: 2,
                display: "inline-flex",
              }}
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              onClick={stopRecording}
              title="Остановить и прикрепить"
              aria-label="Остановить и прикрепить"
              style={{
                background: "var(--danger, #c33)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MicOff size={12} />
            </button>
          </div>
        )}
        {!hideHints && recordingSecs == null && (
          <span style={{ fontSize: 11, color: "var(--muted, #888)" }}>
            Enter — отправить · Shift+Enter — новая строка
          </span>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={() => void send()}
          disabled={!canSend || recordingSecs != null}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Send size={14} />
          Отправить
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 6, color: "var(--danger, #c33)", fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
