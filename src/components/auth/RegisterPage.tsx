import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { navigate } from "../../lib/router";
import AuthShell, { Field, FormError, FormNotice, useSubmit } from "./AuthShell";

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { submitting, onSubmit } = useSubmit(async () => {
    if (password.length < 8) throw new Error("Пароль должен быть минимум 8 символов");
    if (password !== confirm) throw new Error("Пароли не совпадают");
    const res = await register(email, password);
    setNotice(res.message || "Регистрация успешна. Проверьте почту для подтверждения.");
    setEmail("");
    setPassword("");
    setConfirm("");
  }, setError);

  return (
    <AuthShell
      title="Регистрация"
      subtitle="Калькулятор прибыли продавца Ozon"
      footer={
        <>
          Уже есть аккаунт?{" "}
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              navigate("/login");
            }}
            style={{ color: "var(--accent)", fontWeight: 600 }}
          >
            Войти
          </a>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <FormNotice message={notice} />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Пароль (минимум 8 символов)"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Field
          label="Повторите пароль"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={submitting}
          style={{ width: "100%", padding: "10px 16px", marginTop: 4 }}
        >
          {submitting ? "Регистрируем…" : "Зарегистрироваться"}
        </button>
      </form>
    </AuthShell>
  );
}
