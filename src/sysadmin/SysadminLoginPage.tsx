import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import AuthShell, {
  Field,
  FormError,
} from "../components/auth/AuthShell";
import { useSubmit } from "../components/auth/useSubmit";
import { useAuth } from "../contexts/useAuth";

const SYSADMIN_ACCENT = "#b91c1c";

export default function SysadminLoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { submitting, onSubmit } = useSubmit(async () => {
    await login(email, password);
  }, setError);

  return (
    <AuthShell
      title="Консоль администратора"
      subtitle="Ozon Profit Calculator · платформенный доступ"
      accentColor={SYSADMIN_ACCENT}
      background="linear-gradient(180deg, #fef2f2 0%, #f7f8fa 60%)"
      headerIcon={
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: 8,
            background: SYSADMIN_ACCENT,
            color: "#fff",
          }}
          aria-hidden
        >
          <ShieldAlert size={20} />
        </div>
      }
      banner={
        <div
          role="note"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "10px 12px",
            marginBottom: 14,
            background: "#fef2f2",
            border: `1px solid ${SYSADMIN_ACCENT}33`,
            borderRadius: 8,
            color: "#7f1d1d",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <ShieldAlert
            size={16}
            style={{ flexShrink: 0, marginTop: 1, color: SYSADMIN_ACCENT }}
          />
          <span>
            Это административная консоль. Доступ только для операторов сервиса.
            Обычные пользователи входят в калькулятор по адресу основного приложения.
          </span>
        </div>
      }
    >
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Пароль"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "10px 16px",
            marginTop: 4,
            background: SYSADMIN_ACCENT,
            borderColor: SYSADMIN_ACCENT,
          }}
        >
          {submitting ? "Входим…" : "Войти в консоль"}
        </button>
      </form>
    </AuthShell>
  );
}
