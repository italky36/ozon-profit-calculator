import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";

interface Props {
  articleId: string;
  onClose: () => void;
}

interface DebugResult {
  endpoint: string;
  request: unknown;
  response: unknown;
}

export default function OzonPricesDebugModal({ articleId, onClose }: Props) {
  const [data, setData] = useState<DebugResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    api.import
      .debugPrices(articleId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = () => {
    if (!data) return;
    void navigator.clipboard.writeText(JSON.stringify(data.response, null, 2));
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside
        className="drawer"
        role="dialog"
        aria-label="Ozon /v5/product/info/prices"
        style={{ width: "min(900px, 95vw)" }}
      >
        <div className="drawer-header">
          <h3>
            Ozon /v5/product/info/prices · <code>{articleId}</code>
          </h3>
          <button
            className="btn-icon"
            onClick={onClose}
            title="Закрыть (Esc)"
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">
          {loading && <p className="muted">Запрашиваем Ozon…</p>}
          {error && (
            <section
              className="card"
              style={{ borderColor: "#FFB3B3", background: "#FEEFEF" }}
            >
              <h3 style={{ margin: "0 0 8px", color: "var(--err)" }}>
                Ошибка запроса
              </h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{error}</p>
            </section>
          )}
          {data && (
            <>
              <section className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <h3 style={{ margin: 0 }}>Ответ Ozon</h3>
                  <button className="btn-secondary" onClick={copy}>
                    Скопировать JSON
                  </button>
                </div>
                <pre
                  style={{
                    background: "#0f1115",
                    color: "#d6e1ef",
                    padding: 12,
                    borderRadius: 6,
                    overflow: "auto",
                    maxHeight: "60vh",
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  {JSON.stringify(data.response, null, 2)}
                </pre>
              </section>
              <details className="card" style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer" }}>Тело запроса</summary>
                <pre
                  style={{
                    background: "#0f1115",
                    color: "#d6e1ef",
                    padding: 12,
                    borderRadius: 6,
                    overflow: "auto",
                    fontSize: 12,
                    marginTop: 8,
                  }}
                >
                  {JSON.stringify(data.request, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
