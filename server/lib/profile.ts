import { validateImageDataUrl } from "./dataUrl";

/** Patch shape for user profile updates. All fields optional; absent = no
 * change. `jobTitle` / `avatarDataUrl` accept null to clear. */
export interface ProfilePatch {
  fullName?: string;
  jobTitle?: string | null;
  avatarDataUrl?: string | null;
}

/** Parse + validate a profile-patch body. Returns the cleaned patch (only
 * fields that were actually provided) or an error message string. */
export function parseProfilePatch(raw: unknown): ProfilePatch | string {
  if (!raw || typeof raw !== "object") return "Некорректные данные";
  const r = raw as {
    fullName?: unknown;
    jobTitle?: unknown;
    avatarDataUrl?: unknown;
  };
  const out: ProfilePatch = {};

  if (r.fullName !== undefined) {
    if (typeof r.fullName !== "string") return "Имя должно быть строкой";
    const v = r.fullName.trim();
    if (!v) return "Имя не может быть пустым";
    if (v.length > 80) return "Имя не длиннее 80 символов";
    out.fullName = v;
  }

  if (r.jobTitle !== undefined) {
    if (r.jobTitle === null || r.jobTitle === "") {
      out.jobTitle = null;
    } else if (typeof r.jobTitle !== "string") {
      return "Должность должна быть строкой или null";
    } else {
      const v = r.jobTitle.trim();
      if (v.length > 80) return "Должность не длиннее 80 символов";
      out.jobTitle = v || null;
    }
  }

  if (r.avatarDataUrl !== undefined) {
    if (r.avatarDataUrl === null) {
      out.avatarDataUrl = null;
    } else {
      const v = validateImageDataUrl(r.avatarDataUrl);
      if (!v.ok) return `Аватар: ${v.error}`;
      out.avatarDataUrl = v.value;
    }
  }

  return out;
}
