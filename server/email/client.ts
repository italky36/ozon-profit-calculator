import nodemailer, { type Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { smtpSettings } from "../db/schema";
import type { DB } from "../db/client";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailClient {
  send(msg: EmailMessage): Promise<void>;
}

export type SmtpSecureMode = "auto" | "ssl" | "starttls" | "none";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: SmtpSecureMode;
}

function parseSecure(v: unknown): SmtpSecureMode {
  if (v === "ssl" || v === "starttls" || v === "none" || v === "auto") return v;
  return "auto";
}

/**
 * Map our high-level `secure` mode (+ port) to nodemailer's low-level
 * TLS flags. `auto` preserves historical behaviour (SSL on 465 only).
 */
function resolveTlsOptions(mode: SmtpSecureMode, port: number): {
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
} {
  switch (mode) {
    case "ssl":
      return { secure: true };
    case "starttls":
      return { secure: false, requireTLS: true };
    case "none":
      return { secure: false, ignoreTLS: true };
    case "auto":
    default:
      return { secure: port === 465 };
  }
}

async function readSmtpFromDb(db: DB): Promise<SmtpConfig | null> {
  try {
    const [row] = await db
      .select()
      .from(smtpSettings)
      .where(eq(smtpSettings.id, 1));
    if (!row) return null;
    if (!row.host || !row.user || !row.pass || !row.fromAddr) return null;
    return {
      host: row.host,
      port: row.port,
      user: row.user,
      pass: row.pass,
      from: row.fromAddr,
      secure: parseSecure(row.secure),
    };
  } catch {
    return null;
  }
}

function readSmtpFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  if (!host || !portRaw || !user || !pass || !from) return null;
  const port = Number(portRaw);
  if (!Number.isFinite(port)) return null;
  return {
    host,
    port,
    user,
    pass,
    from,
    secure: parseSecure(process.env.SMTP_SECURE),
  };
}

export class SmtpClient implements EmailClient {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(cfg: SmtpConfig) {
    const tls = resolveTlsOptions(cfg.secure, cfg.port);
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      ...tls,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    this.from = cfg.from;
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
}

class ConsoleClient implements EmailClient {
  async send(msg: EmailMessage): Promise<void> {
    console.log(
      `[email:dev] to=${msg.to} subject=${JSON.stringify(msg.subject)}`,
    );
    console.log(msg.text ?? msg.html);
  }
}

let cached: EmailClient | null = null;
let dbRef: DB | null = null;

/** Called once from buildApp to thread DB into the lazy email client. */
export function setEmailClientDb(db: DB): void {
  dbRef = db;
}

/** Lazy singleton. Priority: DB row → env vars → stdout fallback. */
export async function getEmailClient(): Promise<EmailClient> {
  if (cached) return cached;
  const cfg = (dbRef ? await readSmtpFromDb(dbRef) : null) ?? readSmtpFromEnv();
  cached = cfg ? new SmtpClient(cfg) : new ConsoleClient();
  return cached;
}

/** Drop the cached client so the next getEmailClient() re-reads config. */
export function invalidateEmailClient(): void {
  cached = null;
}

/** For tests: inject a mock client. */
export function setEmailClient(client: EmailClient | null): void {
  cached = client;
}

/** Describe current effective source for admin UI / diagnostics. */
export async function describeEmailSource(): Promise<"db" | "env" | "console"> {
  if (dbRef && (await readSmtpFromDb(dbRef))) return "db";
  if (readSmtpFromEnv()) return "env";
  return "console";
}
