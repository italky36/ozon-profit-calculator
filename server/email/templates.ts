import type { EmailMessage } from "./client";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateVerificationEmail(
  email: string,
  link: string,
): EmailMessage {
  const safeLink = escapeHtml(link);
  return {
    to: email,
    subject: "Подтверждение email — Ozon Profit Calculator",
    text: `Здравствуйте!\n\nПодтвердите ваш email, перейдя по ссылке:\n${link}\n\nСсылка действительна 24 часа.\n\nЕсли вы не регистрировались, проигнорируйте это письмо.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">Подтверждение email</h2>
        <p>Здравствуйте! Подтвердите регистрацию в Ozon Profit Calculator, нажав на кнопку ниже.</p>
        <p style="margin: 24px 0;">
          <a href="${safeLink}" style="display: inline-block; background: #005bff; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
            Подтвердить email
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Или скопируйте ссылку:<br><a href="${safeLink}">${safeLink}</a></p>
        <p style="color: #666; font-size: 14px;">Ссылка действительна 24 часа. Если вы не регистрировались, проигнорируйте это письмо.</p>
      </div>
    `.trim(),
  };
}

export function generatePasswordResetEmail(
  email: string,
  link: string,
): EmailMessage {
  const safeLink = escapeHtml(link);
  return {
    to: email,
    subject: "Восстановление пароля — Ozon Profit Calculator",
    text: `Здравствуйте!\n\nВы запросили восстановление пароля в Ozon Profit Calculator. Чтобы задать новый пароль, перейдите по ссылке:\n${link}\n\nСсылка действительна 1 час и может быть использована один раз.\n\nЕсли вы не запрашивали восстановление, проигнорируйте это письмо — текущий пароль останется без изменений.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">Восстановление пароля</h2>
        <p>Вы запросили восстановление пароля в Ozon Profit Calculator. Чтобы задать новый пароль, нажмите на кнопку ниже.</p>
        <p style="margin: 24px 0;">
          <a href="${safeLink}" style="display: inline-block; background: #005bff; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
            Задать новый пароль
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Или скопируйте ссылку:<br><a href="${safeLink}">${safeLink}</a></p>
        <p style="color: #666; font-size: 14px;">Ссылка действительна 1 час и может быть использована один раз. Если вы не запрашивали восстановление, проигнорируйте это письмо — текущий пароль останется без изменений.</p>
      </div>
    `.trim(),
  };
}

const ROLE_LABEL: Record<string, string> = {
  owner: "владелец",
  manager: "менеджер",
  member: "участник",
};

export function generateInviteEmail(input: {
  to: string;
  workspaceName: string;
  inviterEmail: string;
  role: "owner" | "manager" | "member";
  link: string;
}): EmailMessage {
  const safeLink = escapeHtml(input.link);
  const safeWs = escapeHtml(input.workspaceName);
  const safeInviter = escapeHtml(input.inviterEmail);
  const roleLabel = ROLE_LABEL[input.role] ?? input.role;
  return {
    to: input.to,
    subject: `Приглашение в команду «${input.workspaceName}» — Ozon Profit Calculator`,
    text: `Здравствуйте!\n\n${input.inviterEmail} приглашает вас в команду «${input.workspaceName}» в Ozon Profit Calculator. Роль: ${roleLabel}.\n\nЧтобы принять приглашение, перейдите по ссылке:\n${input.link}\n\nСсылка действительна 7 дней. Если вы не ожидали это приглашение, проигнорируйте письмо.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">Приглашение в команду</h2>
        <p><b>${safeInviter}</b> приглашает вас в команду <b>«${safeWs}»</b> в Ozon Profit Calculator.</p>
        <p>Роль: <b>${escapeHtml(roleLabel)}</b>.</p>
        <p style="margin: 24px 0;">
          <a href="${safeLink}" style="display: inline-block; background: #005bff; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
            Принять приглашение
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">Или скопируйте ссылку:<br><a href="${safeLink}">${safeLink}</a></p>
        <p style="color: #666; font-size: 14px;">Ссылка действительна 7 дней. Если вы не ожидали это приглашение, проигнорируйте письмо.</p>
      </div>
    `.trim(),
  };
}
