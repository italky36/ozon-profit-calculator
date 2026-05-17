import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { api, type ChatMessage } from "../../api";

interface Props {
  channelId?: number;
  channelName?: string;
  onJump: (channelId: number, messageId: number) => void;
  onClose: () => void;
}

type Result = ChatMessage & { snippet: string };

const DEBOUNCE_MS = 250;

function highlightedSnippet(html: string): { __html: string } {
  // Server returns FTS5 `snippet(... '<mark>', '</mark>' ...)`. We only allow
  // <mark> tags through; everything else is escaped. Tiny in-place sanitizer:
  // start by escaping then unescape only <mark> / </mark>.
  const esc = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const restored = esc
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
  return { __html: restored };
}

export default function SearchPanel({
  channelId,
  channelName,
  onJump,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"channel" | "workspace">(
    channelId ? "channel" : "workspace",
  );
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      void api.chat
        .search(trimmed, {
          channelId: scope === "channel" ? channelId : undefined,
        })
        .then((r) => setResults(r.results))
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, scope, channelId]);

  return (
    <div
      style={{
        padding: 12,
        borderBottom: "1px solid var(--border, #e2e2e2)",
        background: "var(--bg-soft, #fafafa)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Search size={16} />
        <input
          autoFocus
          type="text"
          placeholder="Поиск по сообщениям…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: "6px 10px",
            border: "1px solid var(--border, #e2e2e2)",
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        {channelId && (
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={scope === "channel"}
              onChange={(e) =>
                setScope(e.target.checked ? "channel" : "workspace")
              }
            />
            в #{channelName ?? "канале"}
          </label>
        )}
        <button
          type="button"
          className="btn-icon"
          onClick={onClose}
          title="Закрыть поиск"
        >
          <X size={16} />
        </button>
      </div>
      {error && (
        <div style={{ color: "var(--danger, #c33)", fontSize: 12, marginTop: 6 }}>
          {error}
        </div>
      )}
      {loading && (
        <div style={{ color: "var(--muted, #888)", fontSize: 12, marginTop: 6 }}>
          ищем…
        </div>
      )}
      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <div style={{ color: "var(--muted, #888)", fontSize: 12, marginTop: 6 }}>
          ничего не найдено
        </div>
      )}
      {results.length > 0 && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onJump(r.channelId, r.id)}
              style={{
                textAlign: "left",
                padding: "6px 8px",
                border: "1px solid var(--border, #e2e2e2)",
                borderRadius: 6,
                background: "var(--bg, #fff)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted, #888)" }}>
                {r.author.fullName || r.author.email} ·{" "}
                {new Date(r.createdAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div
                style={{ fontSize: 13, marginTop: 2 }}
                dangerouslySetInnerHTML={highlightedSnippet(r.snippet)}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
