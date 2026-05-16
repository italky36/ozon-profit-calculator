import { useEffect, useState } from "react";
import { api, type PublicInviteInfo } from "../../api";
import { useAuth } from "../../contexts/useAuth";
import { getQueryParam, navigate } from "../../lib/router";
import AuthShell, { Field, FormError, FormNotice } from "./AuthShell";
import { useSubmit } from "./useSubmit";

const ROLE_LABEL: Record<string, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

export default function RegisterPage() {
  const { register } = useAuth();
  const inviteToken = getQueryParam("invite");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState<PublicInviteInfo | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState<boolean>(!!inviteToken);

  useEffect(() => {
    if (!inviteToken) return;
    void api.invites
      .lookup(inviteToken)
      .then((info) => {
        setInvite(info);
        setEmail(info.email);
      })
      .catch((e: Error) => setInviteError(e.message))
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  const { submitting, onSubmit } = useSubmit(async () => {
    if (!fullName.trim()) throw new Error("Укажите имя");
    if (!inviteToken && !workspaceName.trim())
      throw new Error("Укажите название команды");
    if (password.length < 8)
      throw new Error("Пароль должен быть минимум 8 символов");
    if (password !== confirm) throw new Error("Пароли не совпадают");
    const res = await register({
      email,
      password,
      fullName: fullName.trim(),
      jobTitle: jobTitle.trim() || undefined,
      workspaceName: inviteToken ? undefined : workspaceName.trim(),
      inviteToken: inviteToken ?? undefined,
    });
    setNotice(
      res.message || "Регистрация успешна. Проверьте почту для подтверждения.",
    );
    setPassword("");
    setConfirm("");
  }, setError);

  if (inviteToken && inviteLoading) {
    return (
      <AuthShell title="Приглашение" subtitle="Проверяем ссылку…">
        <p className="muted">Загрузка…</p>
      </AuthShell>
    );
  }

  if (inviteToken && inviteError) {
    return (
      <AuthShell
        title="Приглашение"
        subtitle="Ссылка недействительна"
        footer={
          <>
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
          </>
        }
      >
        <FormError message={inviteError} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invite ? "Регистрация по приглашению" : "Регистрация"}
      subtitle={
        invite
          ? `Вы вступаете в «${invite.workspaceName}» как ${ROLE_LABEL[invite.role] ?? invite.role}`
          : "Калькулятор прибыли продавца Ozon"
      }
      footer={
        <>
          Уже есть аккаунт?{" "}
          <a
            href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"}
            onClick={(e) => {
              e.preventDefault();
              navigate(
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login",
              );
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
          disabled={!!invite}
        />
        <Field
          label="Имя"
          type="text"
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
          maxLength={80}
          required
        />
        <Field
          label="Должность (опционально)"
          type="text"
          value={jobTitle}
          onChange={setJobTitle}
          autoComplete="organization-title"
          maxLength={80}
        />
        {!invite && (
          <Field
            label="Название команды"
            type="text"
            value={workspaceName}
            onChange={setWorkspaceName}
            autoComplete="organization"
            maxLength={80}
            required
          />
        )}
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
