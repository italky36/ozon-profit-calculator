import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Trash2, Upload, X } from "lucide-react";
import { api } from "../api";
import {
  IMAGE_DATA_URL_MAX_LEN,
  resizeImage,
} from "../lib/imageResize";

interface Props {
  workspaceName: string;
  initialColor: string | null;
  initialLogo: string | null;
  initialUseLogoAsAppIcon: boolean;
  canEdit: boolean;
  onClose: () => void;
  onUpdated: (next: {
    color: string | null;
    logoDataUrl: string | null;
    useLogoAsAppIcon: boolean;
  }) => void;
  /** Anchor coordinates (badge bottom-left) so we don't depend on layout libs. */
  anchorRect: { left: number; top: number };
}

/** Curated set so the user picks brand-safe shades without a full-blown
 * picker. They can still type any HEX manually. */
const COLOR_PRESETS = [
  "#005bff", // default brand blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // amber
  "#16a34a", // green
  "#0d9488", // teal
  "#0284c7", // sky
  "#475569", // slate
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LOGO_MAX_LEN = IMAGE_DATA_URL_MAX_LEN;
/** Output max dimension for the rasterised logo. Header chip & list previews
 * never render above ~64px, so 256 leaves plenty of room for retina + future
 * surfaces (auth shell, breadcrumbs) without bloating storage. */
const LOGO_OUT_PX = 256;

export default function WorkspaceBrandingPopover({
  workspaceName,
  initialColor,
  initialLogo,
  initialUseLogoAsAppIcon,
  canEdit,
  onClose,
  onUpdated,
  anchorRect,
}: Props) {
  const [color, setColor] = useState(initialColor ?? "");
  const [hexInput, setHexInput] = useState(initialColor ?? "");
  const [logo, setLogo] = useState<string | null>(initialLogo);
  const [useLogoAsAppIcon, setUseLogoAsAppIcon] = useState<boolean>(
    initialUseLogoAsAppIcon,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close on click outside / Esc.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const persist = async (patch: {
    color?: string | null;
    logoDataUrl?: string | null;
    useLogoAsAppIcon?: boolean;
  }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.workspace.update(patch);
      onUpdated({
        color: res.color,
        logoDataUrl: res.logoDataUrl,
        useLogoAsAppIcon: res.useLogoAsAppIcon,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleLogoAsAppIcon = async (next: boolean) => {
    setUseLogoAsAppIcon(next);
    await persist({ useLogoAsAppIcon: next });
  };

  const applyColor = (next: string | null) => {
    setColor(next ?? "");
    setHexInput(next ?? "");
    void persist({ color: next });
  };

  const onHexChange = (raw: string) => {
    setHexInput(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      applyColor(null);
    } else if (HEX_RE.test(trimmed)) {
      applyColor(trimmed.toLowerCase());
    }
    // else: incomplete input, wait for valid HEX before persisting
  };

  const onFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Файл должен быть изображением");
      return;
    }
    try {
      // Logos commonly have transparency — keep PNG output. Aspect ratio is
      // preserved (some logos are wide wordmarks). SVGs pass through as text.
      const dataUrl = await resizeImage(file, {
        mode: "fit",
        maxSize: LOGO_OUT_PX,
        outputType: "image/png",
      });
      if (dataUrl.length > LOGO_MAX_LEN) {
        setError(
          `Файл слишком большой (макс. ~${Math.floor(LOGO_MAX_LEN / 1024)} КБ). Попробуйте другой файл или SVG.`,
        );
        return;
      }
      setLogo(dataUrl);
      await persist({ logoDataUrl: dataUrl });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeLogo = () => {
    setLogo(null);
    setUseLogoAsAppIcon(false);
    // Clear both in one round-trip so the server doesn't keep an orphaned
    // "use logo as app icon" flag pointing at a now-missing image.
    void persist({ logoDataUrl: null, useLogoAsAppIcon: false });
  };

  // Position: just below the badge, aligned to its left edge, but clamped to
  // viewport so a narrow window doesn't push it off-screen.
  const popoverWidth = 280;
  const margin = 8;
  const left = Math.min(
    Math.max(anchorRect.left, margin),
    window.innerWidth - popoverWidth - margin,
  );
  const top = anchorRect.top + 6;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Настройки команды «${workspaceName}»`}
      style={{
        position: "fixed",
        left,
        top,
        width: popoverWidth,
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
        padding: 14,
        zIndex: 1000,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 13 }}>Брендинг команды</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--muted)",
            padding: 2,
            display: "inline-flex",
          }}
        >
          <X size={14} />
        </button>
      </div>

      {!canEdit && (
        <p
          className="muted"
          style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.4 }}
        >
          Настройки команды (название, цвет, логотип) меняет владелец workspace'а.
        </p>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: "#FEEFEF",
            color: "#a01313",
            border: "1px solid #FFB3B3",
            padding: "6px 10px",
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 6,
          }}
        >
          Цвет
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(10, 1fr)",
            gap: 4,
            marginBottom: 8,
          }}
        >
          {COLOR_PRESETS.map((c) => {
            const selected = color.toLowerCase() === c;
            return (
              <button
                key={c}
                type="button"
                disabled={!canEdit || busy}
                onClick={() => applyColor(c)}
                aria-label={`Цвет ${c}`}
                title={c}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: c,
                  border: selected ? "2px solid #1f2937" : "1px solid transparent",
                  cursor: canEdit ? "pointer" : "not-allowed",
                  padding: 0,
                  opacity: canEdit ? 1 : 0.55,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => onHexChange(e.target.value)}
            placeholder="#005bff"
            disabled={!canEdit || busy}
            style={{
              flex: 1,
              padding: "5px 8px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              background: canEdit ? "#fff" : "#f5f5f7",
            }}
          />
          {color && canEdit && (
            <button
              type="button"
              onClick={() => applyColor(null)}
              disabled={busy}
              title="Сбросить цвет"
              style={{
                padding: "4px 8px",
                border: "1px solid var(--border)",
                background: "#fff",
                borderRadius: 6,
                fontSize: 11,
                cursor: "pointer",
                color: "var(--muted)",
              }}
            >
              Сброс
            </button>
          )}
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--muted)",
            marginBottom: 6,
          }}
        >
          Логотип
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 6,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              border: "1px dashed var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f7f8fa",
              overflow: "hidden",
            }}
          >
            {logo ? (
              <img
                src={logo}
                alt="Логотип команды"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <span style={{ color: "var(--muted)", fontSize: 10 }}>нет</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!canEdit || busy}
              className="btn-secondary"
              style={{
                padding: "4px 10px",
                fontSize: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Upload size={12} />
              {logo ? "Заменить" : "Загрузить"}
            </button>
            {logo && canEdit && (
              <button
                type="button"
                onClick={removeLogo}
                disabled={busy}
                className="btn-icon danger"
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Trash2 size={12} />
                Удалить
              </button>
            )}
          </div>
        </div>
        <p
          className="muted"
          style={{ margin: 0, fontSize: 11, lineHeight: 1.35 }}
        >
          PNG/JPEG/SVG. Файл ужимается автоматически до {LOGO_OUT_PX}px по
          длинной стороне, пропорции сохраняются.
        </p>
        {logo && canEdit && (
          <button
            type="button"
            onClick={() => void toggleLogoAsAppIcon(!useLogoAsAppIcon)}
            disabled={busy}
            title={
              useLogoAsAppIcon
                ? "Логотип отображается в шапке. Нажмите, чтобы выключить."
                : "Логотип скрыт. Нажмите, чтобы показать в шапке вместо «Oz»."
            }
            aria-pressed={useLogoAsAppIcon}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 9px 5px 7px",
              borderRadius: 6,
              cursor: busy ? "not-allowed" : "pointer",
              background: useLogoAsAppIcon
                ? "color-mix(in srgb, var(--accent) 12%, #fff)"
                : "transparent",
              border: "1px solid "
                + (useLogoAsAppIcon ? "var(--accent)" : "var(--border)"),
              color: useLogoAsAppIcon ? "var(--accent)" : "var(--muted)",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1.2,
              alignSelf: "flex-start",
              transition: "background .12s, color .12s, border-color .12s",
            }}
          >
            {useLogoAsAppIcon ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>Логотип в шапке</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            // Allow re-uploading the same file.
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
