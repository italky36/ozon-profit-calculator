import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, type ImportRun } from "../api";
import {
  getAutoRefreshState,
  setAutoRefreshConfig,
  onAutoRefreshChange,
} from "../lib/autoRefresh";

type Phase =
  | "checking"
  | "need-creds"
  | "idle"
  | "running"
  | "done"
  | "error";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export default function OzonImportModal({ onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [credsSource, setCredsSource] = useState<"env" | "db" | null>(null);
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [run, setRun] = useState<ImportRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const importedNotified = useRef(false);

  const [autoState, setAutoState] = useState(getAutoRefreshState());
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);

  useEffect(() => {
    const off = onAutoRefreshChange(() => setAutoState(getAutoRefreshState()));
    setAutoState(getAutoRefreshState());
    return off;
  }, []);

  // Initial check.
  useEffect(() => {
    let cancelled = false;
    api.credentials
      .status()
      .then((s) => {
        if (cancelled) return;
        if (s.hasCredentials) {
          setCredsSource(s.source);
          setPhase("idle");
        } else {
          setPhase("need-creds");
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const startPolling = (runId: number) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const next = await api.import.getRun(runId);
        setRun(next);
        if (next.status !== "running") {
          stopPolling();
          if (next.status === "ok") {
            setPhase("done");
            if (!importedNotified.current) {
              importedNotified.current = true;
              onImported();
            }
          } else {
            setError(next.errorMessage ?? "import failed");
            setPhase("error");
          }
        }
      } catch (e) {
        stopPolling();
        setError((e as Error).message);
        setPhase("error");
      }
    }, 1000);
  };

  const saveCreds = async () => {
    setError(null);
    try {
      await api.credentials.put({ clientId: clientId.trim(), apiKey: apiKey.trim() });
      setCredsSource("db");
      setPhase("idle");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startImport = async () => {
    setError(null);
    setRun(null);
    importedNotified.current = false;
    try {
      const { runId } = await api.import.startCatalog();
      setPhase("running");
      const initial = await api.import.getRun(runId);
      setRun(initial);
      startPolling(runId);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const applyAutoRefresh = async (enabled: boolean, minutes: number) => {
    setAutoSaving(true);
    setAutoSaveError(null);
    try {
      await setAutoRefreshConfig({ enabled, intervalMin: minutes });
    } catch (e) {
      setAutoSaveError((e as Error).message);
    } finally {
      setAutoSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Импорт каталога из Ozon</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>

        {phase === "checking" && <p className="muted">Проверка ключей…</p>}

        {phase === "need-creds" && (
          <div>
            <p className="muted">
              Не найдены ключи Ozon Seller. Введите Client-Id и Api-Key
              (взять в личном кабинете → «Настройки» → «Seller API»).
            </p>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <label>
                Client-Id
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                Api-Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            {error && <p style={{ color: "var(--err)" }}>{error}</p>}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button
                className="btn-primary"
                onClick={saveCreds}
                disabled={!clientId.trim() || !apiKey.trim()}
              >
                Сохранить
              </button>
            </div>
          </div>
        )}

        {phase === "idle" && (
          <div>
            <p className="muted">
              Ключи настроены{credsSource === "env" ? " (через .env)" : ""}.
              Импорт пагинирует каталог Ozon и обновит товары по их articleId.
              Локальные поля (себестоимость, план продаж, маркетинг) сохранятся.
            </p>
            <div style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={startImport}>
                Запустить импорт
              </button>
            </div>
            <fieldset style={{ marginTop: 16 }}>
              <legend>Авто-обновление</legend>
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
              >
                <input
                  type="checkbox"
                  checked={autoState.enabled}
                  disabled={autoSaving}
                  onChange={(e) =>
                    void applyAutoRefresh(e.target.checked, autoState.intervalMin)
                  }
                />
                <span>Перезапускать импорт каждые</span>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={autoState.intervalMin}
                  disabled={autoSaving}
                  onChange={(e) => {
                    const v = Math.max(1, Number(e.target.value) || 1);
                    void applyAutoRefresh(autoState.enabled, v);
                  }}
                  style={{ width: 80 }}
                />
                <span>мин.</span>
              </label>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Настройка хранится в БД и переживает перезагрузку страницы.
                Таймер работает, пока хотя бы одна вкладка приложения открыта.
                {autoState.lastRunAt && (
                  <>
                    <br />
                    Последний авто-запуск:{" "}
                    {new Date(autoState.lastRunAt).toLocaleTimeString("ru-RU")}.
                  </>
                )}
                {autoState.lastError && (
                  <>
                    <br />
                    <span style={{ color: "var(--err)" }}>
                      Последняя ошибка: {autoState.lastError}
                    </span>
                  </>
                )}
              </p>
              {autoSaveError && (
                <p style={{ color: "var(--err)", fontSize: 12, marginTop: 4 }}>
                  Не удалось сохранить: {autoSaveError}
                </p>
              )}
            </fieldset>
          </div>
        )}

        {phase === "running" && (
          <div>
            <p>Импорт идёт…</p>
            <p className="muted">
              Обработано: <b>{run?.itemsProcessed ?? 0}</b>
            </p>
          </div>
        )}

        {phase === "done" && run && (
          <div>
            <p>Готово.</p>
            <ul className="muted">
              <li>Обработано: {run.itemsProcessed}</li>
              {run.params && typeof run.params === "object" && (
                <>
                  {"added" in run.params && (
                    <li>Добавлено: {String(run.params.added)}</li>
                  )}
                  {"updated" in run.params && (
                    <li>Обновлено: {String(run.params.updated)}</li>
                  )}
                  {"unmatched" in run.params &&
                    Number(run.params.unmatched) > 0 && (
                      <li>
                        Без категории (пропущено / неполные):{" "}
                        {String(run.params.unmatched)}
                      </li>
                    )}
                </>
              )}
            </ul>
            <div style={{ marginTop: 12 }}>
              <button className="btn-primary" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div>
            <p style={{ color: "var(--err)" }}>Ошибка: {error}</p>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="btn-icon" onClick={() => setPhase("idle")}>
                Назад
              </button>
              <button className="btn-icon" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
