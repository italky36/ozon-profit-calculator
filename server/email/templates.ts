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

export interface MentionDigestItem {
  messageId: number;
  channelId: number;
  channelName: string;
  authorName: string;
  body: string;
  createdAt: number;
  link: string;
}

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function formatRuTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function generateMentionDigest(input: {
  to: string;
  recipientName: string;
  items: MentionDigestItem[];
}): EmailMessage {
  const safeName = escapeHtml(input.recipientName);
  const count = input.items.length;
  const noun =
    count === 1 ? "упоминание" : count < 5 ? "упоминания" : "упоминаний";

  const textLines = [
    `Здравствуйте, ${input.recipientName}!`,
    "",
    `За последние минуты вас упомянули в командном чате (${count} ${noun}):`,
    "",
    ...input.items.map(
      (it) =>
        `· #${it.channelName} — ${it.authorName} в ${formatRuTime(it.createdAt)}\n  ${truncate(it.body)}\n  ${it.link}`,
    ),
    "",
    "Письмо отправлено, потому что в момент упоминания вас не было в сети. Если включить уведомления в браузере, такие письма приходить не будут.",
  ];

  const htmlItems = input.items
    .map(
      (it) => `
        <div style="margin: 16px 0; padding: 12px; border: 1px solid #e2e2e2; border-radius: 8px;">
          <div style="font-size: 12px; color: #666; margin-bottom: 6px;">
            <b>#${escapeHtml(it.channelName)}</b> · ${escapeHtml(it.authorName)} · ${escapeHtml(formatRuTime(it.createdAt))}
          </div>
          <div style="font-size: 14px; color: #222; white-space: pre-wrap;">${escapeHtml(truncate(it.body))}</div>
          <div style="margin-top: 10px;">
            <a href="${escapeHtml(it.link)}" style="color: #005bff; text-decoration: none; font-size: 13px;">Открыть сообщение →</a>
          </div>
        </div>
      `,
    )
    .join("");

  return {
    to: input.to,
    subject: `${count} ${noun} в командном чате — Ozon Profit Calculator`,
    text: textLines.join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 8px;">Вас упоминали в чате</h2>
        <p style="color: #555;">Здравствуйте, <b>${safeName}</b>! За последние минуты вы получили ${count} ${noun}, пока были не в сети.</p>
        ${htmlItems}
        <p style="color: #888; font-size: 12px; margin-top: 24px;">Письмо отправлено, потому что в момент упоминания вас не было в сети. Чтобы получать уведомления мгновенно, оставайтесь онлайн или включите push-уведомления в браузере.</p>
      </div>
    `.trim(),
  };
}

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
