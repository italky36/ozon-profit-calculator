import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/useAuth";
import { getQueryParam, navigate } from "../../lib/router";
import AuthShell, { FormError, FormNotice } from "./AuthShell";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export default function VerifyEmailPage() {
  const { verifyEmail } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const token = getQueryParam("token");
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "missing" });
      return;
    }
    void (async () => {
      try {
        await verifyEmail(token);
        setState({ kind: "success" });
        setTimeout(() => navigate("/"), 1500);
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    })();
  }, [verifyEmail]);

  return (
    <AuthShell
      title="Подтверждение email"
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
      {state.kind === "loading" && (
        <p className="muted" style={{ margin: 0 }}>Проверяем токен…</p>
      )}
      {state.kind === "missing" && (
        <FormError message="В ссылке отсутствует параметр token." />
      )}
      {state.kind === "success" && (
        <FormNotice message="Email подтверждён. Перенаправляем в приложение…" />
      )}
      {state.kind === "error" && <FormError message={state.message} />}
    </AuthShell>
  );
}
