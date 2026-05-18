import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, Upload, X } from "lucide-react";
import { api } from "../api";
import Avatar from "./Avatar";
import NotificationSettings from "./NotificationSettings";
import {
  resizeImage,
  IMAGE_DATA_URL_MAX_LEN,
} from "../lib/imageResize";

/** Target avatar dimension after client-side resize. Photos are square-cropped
 * and downscaled to this size, keeping output under the size cap. */
const AVATAR_OUT_PX = 256;

interface ProfileEditorProps {
  /** Identity being edited. `mode: "self"` → POST /auth/me/profile.
   * `mode: "member"` → owner edits another user's profile. */
  mode: "self" | "member";
  userId?: number;
  email: string;
  initialFullName: string;
  initialJobTitle: string | null;
  initialAvatarDataUrl: string | null;
  onClose: () => void;
  onSaved: (fields: {
    fullName: string;
    jobTitle: string | null;
    avatarDataUrl: string | null;
  }) => void;
}


export default function ProfileEditor({
  mode,
  userId,
  email,
  initialFullName,
  initialJobTitle,
  initialAvatarDataUrl,
  onClose,
  onSaved,
}: ProfileEditorProps) {
  const [fullName, setFullName] = useState(initialFullName);
  const [jobTitle, setJobTitle] = useState(initialJobTitle ?? "");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(
    initialAvatarDataUrl,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const dataUrl = await resizeImage(file, {
        mode: "crop-square",
        maxSize: AVATAR_OUT_PX,
        outputType: "image/jpeg",
        jpegQuality: 0.85,
      });
      if (dataUrl.length > IMAGE_DATA_URL_MAX_LEN) {
        setError(
          "Не удалось ужать изображение под лимит. Попробуйте другой файл.",
        );
        return;
      }
      setAvatarDataUrl(dataUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError("Имя не может быть пустым");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const patch = {
        fullName: trimmedName,
        jobTitle: jobTitle.trim() || null,
        avatarDataUrl,
      };
      if (mode === "self") {
        await api.auth.updateProfile(patch);
      } else {
        if (userId == null) throw new Error("userId required for member edit");
        await api.workspace.updateMemberProfile(userId, patch);
      }
      onSaved(patch);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "tp-fadeIn .15s ease",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 30px 60px -20px rgba(15,23,42,0.4)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2
            style={{
              margin: 0,
              flex: 1,
              fontSize: 16,
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            {mode === "self" ? "Мой профиль" : "Профиль участника"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            disabled={busy}
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "#fff",
              cursor: busy ? "not-allowed" : "pointer",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={15} />
          </button>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Avatar
            name={fullName || email}
            avatarDataUrl={avatarDataUrl}
            email={email}
            size={72}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 12px",
                fontSize: 13,
              }}
            >
              <Upload size={14} />
              {avatarDataUrl ? "Заменить" : "Загрузить аватар"}
            </button>
            {avatarDataUrl && (
              <button
                type="button"
                className="btn-icon danger"
                onClick={() => setAvatarDataUrl(null)}
                disabled={busy}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Trash2 size={13} />
                Удалить
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#1e293b" }}>
            Имя
          </span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={80}
            disabled={busy}
            style={{
              height: 36,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#1e293b" }}>
            Должность{" "}
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>
              · опционально
            </span>
          </span>
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={80}
            disabled={busy}
            placeholder="Менеджер по продажам"
            style={{
              height: 36,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </label>

        <div style={{ fontSize: 11.5, color: "var(--muted-2)" }}>
          Email <b>{email}</b> здесь не меняется — это идентификатор для входа.
        </div>

        {mode === "self" && <NotificationSettings />}

        {error && (
          <div
            style={{
              padding: "8px 10px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#b91c1c",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        )}

        <footer style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={busy}
            style={{ padding: "8px 16px", fontSize: 13 }}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            disabled={busy || !fullName.trim()}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
