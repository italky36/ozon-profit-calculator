import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { navigate } from "../../lib/router";
import AuthShell, { Field, FormError, useSubmit } from "./AuthShell";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { submitting, onSubmit } = useSubmit(async () => {
    await login(email, password);
    navigate("/");
  }, setError);

  return (
    <AuthShell
      title="Вход"
      subtitle="Калькулятор прибыли продавца Ozon"
      footer={
        <>
          Нет аккаунта?{" "}
          <a
            href="/register"
            onClick={(e) => {
              e.preventDefault();
              navigate("/register");
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
