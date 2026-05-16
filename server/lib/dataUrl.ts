/** Shared validation for base64 image data URLs (workspace logo, user avatar).
 * The strings live in TEXT columns and are sent inline in JSON — keep the cap
 * tight so request bodies stay small. */
export const IMAGE_DATA_URL_RE =
  /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/;

/** ~200 KB cap on the data URL string (incl. prefix). Clients are expected to
 * resize images before submitting; this is a sanity check, not the primary
 * defence (the UI should resize down to ~50 KB for avatars). */
export const IMAGE_DATA_URL_MAX_LEN = 200_000;

export function validateImageDataUrl(
  value: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Должно быть строкой data URL" };
  }
  if (!IMAGE_DATA_URL_RE.test(value)) {
    return {
      ok: false,
      error:
        "Неподдерживаемый формат — нужен data:image/(png|jpeg|gif|webp|svg)",
    };
  }
  if (value.length > IMAGE_DATA_URL_MAX_LEN) {
    return {
      ok: false,
      error: "Изображение слишком большое (макс. 200 КБ закодированного размера)",
    };
  }
  return { ok: true, value };
}
