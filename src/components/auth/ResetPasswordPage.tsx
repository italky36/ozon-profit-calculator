import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { getQueryParam, navigate } from "../../lib/router";
import AuthShell, { Field, FormError, FormNotice } from "./AuthShell";
import { useSubmit } from "./useSubmit";

type Probe =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; token: string }
  | { kind: "invalid"; message: string }
  | { kind: "done" };

export default function ResetPasswordPage() {
  const [probe, setProbe] = useState<Probe>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const token = getQueryParam("token");
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProbe({ kind: "missing" });
      return;
    }
    void (async () => {
      try {
        await api.auth.checkResetToken(token);
        setProbe({ kind: "ready", token });
      } catch (e) {
        setProbe({ kind: "invalid", message: (e as Error).message });
      }
    })();
  }, []);

  const { submitting, onSubmit } = useSubmit(async () => {
    if (probe.kind !== "ready") return;
    if (password !== confirm) {
      throw new Error("Пароли не совпадают");
    }
    await api.auth.resetPassword(probe.token, password);
    setProbe({ kind: "done" });
    setTimeout(() => navigate("/login"), 1500);
  }, setError);

  return (
    <AuthShell
      title="Новый пароль"
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
          К странице входа
        </a>
      }
    >
      {probe.kind === "loading" && (
        <p className="muted" style={{ margin: 0 }}>Проверяем ссылку…</p>
      )}
      {probe.kind === "missing" && (
        <FormError message="В ссылке отсутствует параметр token." />
      )}
      {probe.kind === "invalid" && <FormError message={probe.message} />}
      {probe.kind === "done" && (
        <FormNotice message="Пароль обновлён. Перенаправляем на страницу входа…" />
      )}
      {probe.kind === "ready" && (
        <form onSubmit={onSubmit}>
          <FormError message={error} />
          <Field
            label="Новый пароль"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Field
            label="Повторите пароль"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting}
            style={{ width: "100%", padding: "10px 16px", marginTop: 4 }}
          >
            {submitting ? "Сохраняем…" : "Сохранить пароль"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
