import { useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { getQueryParam, navigate } from "../../lib/router";
import AuthShell, { Field, FormError } from "./AuthShell";
import { useSubmit } from "./useSubmit";

export default function LoginPage() {
  const { login } = useAuth();
  const inviteToken = getQueryParam("invite");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { submitting, onSubmit } = useSubmit(async () => {
    await login(email, password);
    if (inviteToken) {
      navigate(`/invite/${encodeURIComponent(inviteToken)}`);
    } else {
      navigate("/");
    }
  }, setError);

  return (
    <AuthShell
      title="Вход"
      subtitle="Калькулятор прибыли продавца Ozon"
      footer={
        <>
          Нет аккаунта?{" "}
          <a
            href={inviteToken ? `/register?invite=${encodeURIComponent(inviteToken)}` : "/register"}
            onClick={(e) => {
              e.preventDefault();
              navigate(
                inviteToken
                  ? `/register?invite=${encodeURIComponent(inviteToken)}`
                  : "/register",
              );
            }}
            style={{ color: "var(--accent)", fontWeight: 600 }}
          >
            Зарегистрироваться
          </a>
        </>
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
        <div style={{ marginTop: -4, marginBottom: 12, textAlign: "right" }}>
          <a
            href="/forgot-password"
            onClick={(e) => {
              e.preventDefault();
              navigate("/forgot-password");
            }}
            style={{ color: "var(--accent)", fontSize: 12, fontWeight: 500 }}
          >
            Забыли пароль?
          </a>
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting}
          style={{ width: "100%", padding: "10px 16px", marginTop: 4 }}
        >
          {submitting ? "Входим…" : "Войти"}
        </button>
      </form>
    </AuthShell>
  );
}
