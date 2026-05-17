import { useState } from "react";
import { Plus, Hash } from "lucide-react";
import type { ChatChannel } from "../../api";

interface ChannelListProps {
  channels: ChatChannel[];
  activeChannelId: number | null;
  canManage: boolean;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
}

export default function ChannelList({
  channels,
  activeChannelId,
  canManage,
  onSelect,
  onCreate,
}: ChannelListProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name);
      setNewName("");
      setCreating(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = channels.filter((c) => !c.archivedAt);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 200,
        padding: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 12,
          color: "var(--muted, #888)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Каналы
        {canManage && (
          <button
            type="button"
            className="btn-icon"
            onClick={() => setCreating((v) => !v)}
            title="Создать канал"
            style={{ marginLeft: "auto" }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {creating && (
        <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
          <input
            type="text"
            placeholder="имя канала"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            disabled={busy}
            autoFocus
            style={{ flex: 1, fontSize: 13, padding: "4px 6px" }}
          />
        </div>
      )}
      {error && (
        <div
          style={{
            color: "var(--danger, #c33)",
            fontSize: 11,
            padding: "0 8px",
          }}
        >
          {error}
        </div>
      )}
      {active.map((ch) => {
        const isActive = ch.id === activeChannelId;
        return (
          <button
            key={ch.id}
            type="button"
            onClick={() => onSelect(ch.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
              background: isActive ? "var(--accent-soft, #eef)" : "transparent",
              color: isActive ? "var(--accent)" : "inherit",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              textAlign: "left",
              width: "100%",
            }}
          >
            <Hash size={14} />
            {ch.name}
          </button>
        );
      })}
    </div>
  );
}
