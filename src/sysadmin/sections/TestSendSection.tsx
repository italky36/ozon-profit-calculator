import { useState } from "react";
import { Send } from "lucide-react";
import { api } from "../../api";
import { errBox, fieldRow, inputStyle, labelStyle, okBox } from "./styles";

export default function TestSendSection() {
  const [testSubject, setTestSubject] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sendTest = async () => {
    if (!testTo.trim() || !testTo.includes("@")) {
      setError("Укажите валидный email для теста");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.admin.testSmtp(
        testTo.trim(),
        testSubject.trim() || undefined,
      );
      setNotice(`Тестовое письмо отправлено через ${r.source}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Send size={14} /> Тест отправки
        </h3>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {notice && <div style={okBox}>{notice}</div>}
      <div style={fieldRow}>
        <label style={labelStyle}>Тест: тема</label>
        <input
          style={inputStyle}
          value={testSubject}
          onChange={(e) => setTestSubject(e.target.value)}
          placeholder="Тест отправки писем — Калькулятор Ozon"
          disabled={busy}
        />
      </div>
      <div style={fieldRow}>
        <label style={labelStyle}>Тест: отправить на</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
          <button
            type="button"
            className="btn-icon"
            onClick={() => void sendTest()}
            disabled={busy || !testTo.trim()}
          >
            <Send size={14} /> Отправить
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Тест использует <strong>текущий эффективный источник</strong>.
        Сохраните настройки перед отправкой, если хотите проверить новые
        значения.
      </p>
    </div>
  );
}
