// ── Sending one email ─────────────────────────────────────────────
// Three ways out, chosen per account: SMTP (any mailbox — Google Workspace,
// Microsoft 365, Hostinger, Zoho), Resend, or Brevo. The two APIs are plain
// fetch calls; SMTP goes through nodemailer. All three return the provider's
// id for the message so a bounce or a reply can be tied back.

import nodemailer, { type Transporter } from "nodemailer";
import type { EmailSettings } from "@workspace/db";

export interface OutgoingEmail {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
  /** Our own RFC Message-ID, so replies carry it in In-Reply-To. */
  messageId: string;
  unsubscribeUrl: string | null;
  inReplyTo?: string | null;
}

export interface SendResult { providerId: string | null }

export class SendError extends Error {
  constructor(message: string, public permanent = false) { super(message); }
}

export function isConfigured(s: EmailSettings | null | undefined): boolean {
  if (!s?.fromEmail) return false;
  if (s.provider === "smtp") return !!(s.smtpHost && s.smtpUser && s.smtpPass);
  return !!s.apiKey;
}

function fromHeader(s: EmailSettings): string {
  return s.fromName ? `"${s.fromName.replace(/"/g, "'")}" <${s.fromEmail}>` : s.fromEmail!;
}

function listUnsubscribe(url: string | null, from: string): Record<string, string> {
  // One-click unsubscribe is what Gmail and Yahoo require of anyone sending
  // in volume. Both headers, so a client that only reads one still shows it.
  const parts = [`<mailto:${from}?subject=unsubscribe>`];
  if (url) parts.unshift(`<${url}>`);
  return { "List-Unsubscribe": parts.join(", "), "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

const transports = new Map<string, Transporter>();
function smtpTransport(s: EmailSettings): Transporter {
  const key = `${s.smtpHost}|${s.smtpPort}|${s.smtpUser}|${s.smtpSecure}`;
  let t = transports.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      // 465 is TLS from the first byte; the settings page has no switch for it, so the port decides.
      host: s.smtpHost!, port: s.smtpPort ?? 587, secure: !!s.smtpSecure || s.smtpPort === 465,
      auth: { user: s.smtpUser!, pass: s.smtpPass! },
      pool: true, maxConnections: 2, maxMessages: 50,
      connectionTimeout: 20_000, socketTimeout: 30_000,
    });
    transports.set(key, t);
  }
  return t;
}

export async function sendEmail(s: EmailSettings, m: OutgoingEmail): Promise<SendResult> {
  if (!isConfigured(s)) throw new SendError("إعدادات البريد غير مكتملة", true);
  const headers = listUnsubscribe(m.unsubscribeUrl, s.fromEmail!);

  if (s.provider === "smtp") {
    try {
      const info = await smtpTransport(s).sendMail({
        from: fromHeader(s), to: m.toName ? `"${m.toName.replace(/"/g, "'")}" <${m.to}>` : m.to,
        replyTo: s.replyTo ?? undefined,
        subject: m.subject, html: m.html, text: m.text,
        messageId: m.messageId, inReplyTo: m.inReplyTo ?? undefined,
        headers,
      });
      return { providerId: info.messageId ?? null };
    } catch (err: any) {
      const code = String(err?.responseCode ?? "");
      const msg = String(err?.message ?? err).slice(0, 300);
      // 5xx from the server is the address or the message; 4xx and network
      // errors are the moment.
      throw new SendError(msg, code.startsWith("5") && !/rate|too many|limit/i.test(msg));
    }
  }

  if (s.provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromHeader(s), to: [m.to], reply_to: s.replyTo ?? undefined,
        subject: m.subject, html: m.html, text: m.text,
        headers: { ...headers, "Message-ID": m.messageId, ...(m.inReplyTo ? { "In-Reply-To": m.inReplyTo } : {}) },
      }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new SendError(`resend ${r.status}: ${String(d?.message ?? "").slice(0, 200)}`, r.status === 422 || r.status === 403);
    return { providerId: d?.id ?? null };
  }

  if (s.provider === "brevo") {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": s.apiKey!, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: s.fromName ?? undefined, email: s.fromEmail },
        to: [{ email: m.to, name: m.toName ?? undefined }],
        replyTo: s.replyTo ? { email: s.replyTo } : undefined,
        subject: m.subject, htmlContent: m.html, textContent: m.text,
        headers: { ...headers, "Message-ID": m.messageId, ...(m.inReplyTo ? { "In-Reply-To": m.inReplyTo } : {}) },
      }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new SendError(`brevo ${r.status}: ${String(d?.message ?? "").slice(0, 200)}`, r.status === 400 || r.status === 401);
    return { providerId: d?.messageId ?? null };
  }

  throw new SendError(`مزوّد غير معروف: ${s.provider}`, true);
}

/** Try the connection without sending anything (SMTP) or with a key check (APIs). */
export async function verifySettings(s: EmailSettings): Promise<{ ok: boolean; detail: string }> {
  try {
    if (s.provider === "smtp") { await smtpTransport(s).verify(); return { ok: true, detail: "اتصال SMTP ناجح" }; }
    if (s.provider === "resend") {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${s.apiKey}` } });
      return { ok: r.ok, detail: r.ok ? "مفتاح Resend صالح" : `Resend ${r.status}` };
    }
    if (s.provider === "brevo") {
      const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": s.apiKey! } });
      return { ok: r.ok, detail: r.ok ? "مفتاح Brevo صالح" : `Brevo ${r.status}` };
    }
    return { ok: false, detail: "مزوّد غير معروف" };
  } catch (err: any) {
    return { ok: false, detail: String(err?.message ?? err).slice(0, 200) };
  }
}

/** The RFC Message-ID for a message token, stable and ours. */
export function messageIdFor(token: string, fromEmail: string): string {
  const domain = fromEmail.split("@")[1] ?? "localhost";
  return `<${token}@${domain}>`;
}
