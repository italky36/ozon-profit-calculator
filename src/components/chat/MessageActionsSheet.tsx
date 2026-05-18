import { MessageSquare, Pencil, Reply, Trash2 } from "lucide-react";
import Drawer from "../Drawer";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "🤔", "👀", "🔥", "✅"];

interface Props {
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  canDelete: boolean;
  canReplyInThread: boolean;
  canQuote: boolean;
  onReact: (emoji: string) => void;
  onOpenThread: () => void;
  onQuote: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Bottom-sheet menu opened by a long-press on a message (touch devices).
 * Mirrors the hover-icons that desktop users get + a quick-reaction row at
 * the top. Each action closes the sheet before executing (we rely on the
 * parent state to update the underlying message). */
export default function MessageActionsSheet({
  open,
  onClose,
  canEdit,
  canDelete,
  canReplyInThread,
  canQuote,
  onReact,
  onOpenThread,
  onQuote,
  onEdit,
  onDelete,
}: Props) {
  const run = (fn: () => void) => () => {
    onClose();
    // Defer so the close animation can start; action may navigate / mutate.
    setTimeout(fn, 0);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="bottom"
      size="auto"
      showDragHandle
      title="Действия"
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            gap: 4,
            justifyContent: "space-between",
            padding: "4px 0 8px",
            borderBottom: "1px solid var(--border, #e2e2e2)",
          }}
        >
          {QUICK_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={run(() => onReact(e))}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 24,
                padding: "8px 6px",
                borderRadius: 8,
                lineHeight: 1,
              }}
              title={e}
              aria-label={`Реакция ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        {canQuote && (
          <ActionButton
            icon={<Reply size={18} />}
            label="Цитировать"
            onClick={run(onQuote)}
          />
        )}
        {canReplyInThread && (
          <ActionButton
            icon={<MessageSquare size={18} />}
            label="Ответить в треде"
            onClick={run(onOpenThread)}
          />
        )}
        {canEdit && (
          <ActionButton
            icon={<Pencil size={18} />}
            label="Редактировать"
            onClick={run(onEdit)}
          />
        )}
        {canDelete && (
          <ActionButton
            icon={<Trash2 size={18} />}
            label="Удалить"
            destructive
            onClick={run(onDelete)}
          />
        )}
      </div>
    </Drawer>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: "none",
        background: "var(--bg-soft, #f7f7f7)",
        color: destructive ? "var(--danger, #c33)" : "inherit",
        fontSize: 15,
        fontWeight: 500,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <span style={{ display: "inline-flex" }}>{icon}</span>
      {label}
    </button>
  );
}
