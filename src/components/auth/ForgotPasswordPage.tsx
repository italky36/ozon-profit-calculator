import { useState } from "react";
import { api } from "../../api";
import { navigate } from "../../lib/router";
import AuthShell, { Field, FormError, FormNotice } from "./AuthShell";
import { useSubmit } from "./useSubmit";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { submitting, onSubmit } = useSubmit(async () => {
    const res = await api.auth.forgotPassword(email);
    setNotice(res.message);
  }, setError);

  return (
    <AuthShell
      title="Восстановление пароля"
      subtitle="Калькулятор прибыли продавца Ozon"
      footer={
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            navigate("/login");
          }}
          style={{ color: "var(--accent)", fontWeight: 600 }}
        >
          Вернуться к входу
        </a>
      }
    >
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <FormNotice message={notice} />
        {!notice && (
          <>
            <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
              Введите email, на который зарегистрирована учётная запись. Мы пришлём
              ссылку для смены пароля.
            </p>
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              required
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
              style={{ width: "100%", padding: "10px 16px", marginTop: 4 }}
            >
              {submitting ? "Отправляем…" : "Отправить ссылку"}
            </button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
