import { useEffect, useState } from "react";
import { api, type PublicInviteInfo } from "../../api";
import { useAuth } from "../../contexts/useAuth";
import { navigate } from "../../lib/router";
import AuthShell, { FormError } from "./AuthShell";

const ROLE_LABEL: Record<string, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

export default function InvitePage({ token }: { token: string }) {
  const { user, refresh } = useAuth();
  const [info, setInfo] = useState<PublicInviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.invites
      .lookup(token)
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <AuthShell title="Приглашение" subtitle="Проверяем ссылку…">
        <p className="muted">Загрузка…</p>
      </AuthShell>
    );
  }

  if (error || !info) {
    return (
      <AuthShell
        title="Приглашение"
        subtitle="Ссылка недействительна"
        footer={
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              navigate("/login");
            }}
            style={{ color: "var(--accent)", fontWeight: 600 }}
          >
            Перейти ко входу
          </a>
        }
      >
        <FormError message={error ?? "Приглашение не найдено"} />
      </AuthShell>
    );
  }

  const onAccept = async () => {
    if (!user) return;
    setAccepting(true);
    setError(null);
    try {
      await api.invites.accept(token);
      await refresh();
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAccepting(false);
    }
  };

  const role = ROLE_LABEL[info.role] ?? info.role;

  return (
    <AuthShell
      title="Приглашение в команду"
      subtitle={`«${info.workspaceName}»`}
      footer={
        user ? (
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
            style={{ color: "var(--accent)", fontWeight: 600 }}
          >
            Отмена
          </a>
        ) : null
      }
    >
      <FormError message={error} />
      <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
        <b>{info.inviterEmail}</b> приглашает вас в команду{" "}
        <b>«{info.workspaceName}»</b> на роль <b>{role}</b>.
      </p>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Email приглашения: <b>{info.email}</b>
      </p>

      {user ? (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Вы вошли как <b>{user.email}</b>.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void onAccept()}
            disabled={accepting}
            style={{ width: "100%", padding: "10px 16px" }}
          >
            {accepting ? "Принимаем…" : "Принять приглашение"}
          </button>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              navigate(`/register?invite=${encodeURIComponent(token)}`)
            }
            style={{ width: "100%", padding: "10px 16px" }}
          >
            Зарегистрироваться и присоединиться
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              navigate(`/login?invite=${encodeURIComponent(token)}`)
            }
            style={{ width: "100%", padding: "10px 16px" }}
          >
            У меня уже есть аккаунт — войти
          </button>
        </div>
      )}
    </AuthShell>
  );
}
