import { File, FileText, Image as ImageIcon, FileArchive } from "lucide-react";
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

export default function Attachment({
  attachment,
}: {
  attachment: ChatAttachment;
}) {
  const isImage = attachment.mimeType.startsWith("image/");
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
