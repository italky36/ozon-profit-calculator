import type { EmailMessage } from "./client";

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

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
  token: string,
): EmailMessage {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
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
