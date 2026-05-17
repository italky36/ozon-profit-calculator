/** Shared client-side image resizing. Used by both the profile avatar uploader
 * and the workspace branding (logo) uploader so users can drop in any photo
 * without worrying about size or aspect ratio. */

export const IMAGE_DATA_URL_MAX_LEN = 200_000;

export type ResizeMode =
  /** Square-crop centred + downscale. For round avatars. */
  | "crop-square"
  /** Fit within a square bounding box, preserving aspect ratio. For logos
   * with transparency or unusual aspect ratios. */
  | "fit";

export interface ResizeOptions {
  /** Output max side in pixels (longer side after fit / both sides after crop). */
  maxSize: number;
  mode: ResizeMode;
  /** Output encoding. `image/jpeg` is smallest for photos. `image/png` keeps
   * transparency for logos. */
  outputType: "image/jpeg" | "image/png";
  /** Only relevant for JPEG output. 0..1, default 0.85. */
  jpegQuality?: number;
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = url;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Не удалось прочитать файл"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Ошибка чтения"));
    reader.readAsDataURL(file);
  });
}

/** Resize a raster image (or pass through an SVG) to a data URL fit for inline
 * storage. SVGs aren't rasterised — they're already small and scalable; we
 * just read them as-is and let the caller verify the size cap. */
export async function resizeImage(
  file: File,
  opts: ResizeOptions,
): Promise<string> {
  // SVG path: text-based, scalable, no rasterisation needed.
  if (file.type === "image/svg+xml") {
    return fileToDataUrl(file);
  }

  const img = await fileToImage(file);
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  let dw: number;
  let dh: number;
  const max = opts.maxSize;

  if (opts.mode === "crop-square") {
    const side = Math.min(img.width, img.height);
    sx = (img.width - side) / 2;
    sy = (img.height - side) / 2;
    sw = side;
    sh = side;
    dw = max;
    dh = max;
  } else {
    // Fit within max × max, preserve aspect ratio.
    const ratio = Math.min(max / img.width, max / img.height, 1);
    dw = Math.round(img.width * ratio);
    dh = Math.round(img.height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas не поддерживается");
  // For PNG output we want a transparent background; for JPEG we paint white
  // so semi-transparent input pixels don't end up muddy black.
  if (opts.outputType === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dw, dh);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return opts.outputType === "image/jpeg"
    ? canvas.toDataURL("image/jpeg", opts.jpegQuality ?? 0.85)
    : canvas.toDataURL("image/png");
}
