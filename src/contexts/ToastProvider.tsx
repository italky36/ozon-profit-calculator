import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ToastContext,
  type ShowOptions,
  type ToastVariant,
} from "./ToastContext";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

const DEFAULT_DURATION = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const show = useCallback(
    (message: string, opts: ShowOptions = {}) => {
      const id = ++idRef.current;
      const variant: ToastVariant = opts.variant ?? "info";
      const duration = opts.duration ?? DEFAULT_DURATION;
      setToasts((t) => [...t, { id, message, variant }]);
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, duration);
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toast toast-${t.variant}`}
            onClick={() => dismiss(t.id)}
            title="Скрыть"
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
