// ── Buttons in WhatsApp messages ──────────────────────────────────
// Two ways to show a message's buttons:
//   • interactive — real WhatsApp buttons (quick reply, open link, call),
//     sent as a native-flow interactive message;
//   • text — when interactive is off: clean lines under the message
//     («🔗 احجز الآن: https://…», «للإيقاف أرسل: إيقاف الرسائل»), not the
//     drawn pills this replaced.
// Marketing messages carry a «إيقاف الرسائل» button. Pressing it (or writing
// it) stops our messages to that number for the platform's stop period.
// Real buttons depend on what WhatsApp renders for a linked device, so they
// are a switch the admin turns on after a test to their own phone.

import { eq, sql } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";

export type ButtonType = "url" | "call" | "reply" | "interested" | "not_interested" | "stop";
export interface ButtonDef { text: string; type?: ButtonType; url?: string; phone?: string; id?: string }

export const STOP_ID = "mfy_stop";
export const STOP_TEXT = "إيقاف الرسائل";

// ── Settings ──────────────────────────────────────────────────────

export interface MessagingSettings {
  /** Real WhatsApp buttons; off = clean text lines. */
  interactive: boolean;
  /** Days a «إيقاف» keeps our messages away; 0 = for good. */
  stopDays: number;
  /** The stop button on campaigns, follow-ups and marketing messages. */
  stopButton: boolean;
  footer: string;
}
export const DEFAULT_MESSAGING: MessagingSettings = { interactive: false, stopDays: 150, stopButton: true, footer: "" };

let cache: { at: number; s: MessagingSettings } | null = null;
export async function messagingSettings(): Promise<MessagingSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.s;
  let s = DEFAULT_MESSAGING;
  try {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "messaging")).limit(1);
    s = cleanMessaging(row?.value ?? {}, DEFAULT_MESSAGING);
  } catch { /* defaults */ }
  cache = { at: Date.now(), s };
  return s;
}
export function cleanMessaging(raw: unknown, cur: MessagingSettings): MessagingSettings {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const days = Math.round(Number(b.stopDays));
  return {
    interactive: typeof b.interactive === "boolean" ? b.interactive : cur.interactive,
    stopDays: "stopDays" in b && Number.isFinite(days) ? Math.max(0, Math.min(3650, days)) : cur.stopDays,
    stopButton: typeof b.stopButton === "boolean" ? b.stopButton : cur.stopButton,
    footer: typeof b.footer === "string" ? b.footer.trim().slice(0, 60) : cur.footer,
  };
}
export async function saveMessaging(patch: unknown): Promise<MessagingSettings> {
  const s = cleanMessaging(patch, await messagingSettings());
  await db.insert(platformSettingsTable).values({ key: "messaging", value: s as any })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: s as any, updatedAt: new Date() } });
  cache = null;
  return s;
}

/** Stops whose period is over: the number may hear from us again. */
export async function sweepExpiredStops(): Promise<number> {
  const r = await db.execute(sql`DELETE FROM unsubscribed_phones WHERE until IS NOT NULL AND until < now()`);
  return (r as any).rowCount ?? 0;
}

// ── Pure builders ─────────────────────────────────────────────────

export function parseButtons(raw: string | null | undefined): ButtonDef[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((b) => b && typeof b.text === "string" && b.text.trim()) : []; } catch { return []; }
}

/** The stop button added to a marketing message's own buttons (once). Pure. */
export function withStopButton(btns: ButtonDef[]): ButtonDef[] {
  if (btns.some((b) => b.type === "stop")) return btns;
  return [...btns, { type: "stop", text: STOP_TEXT, id: STOP_ID }];
}

/** For a send: the message type and buttons once the stop button is added. Pure. */
export function marketingSend(messageType: string | null | undefined, buttons: string | null | undefined): { messageType: string; buttons: string | null } {
  const t = messageType || "text";
  if (t === "carousel") return { messageType: t, buttons: buttons ?? null };
  const btns = withStopButton(parseButtons(buttons));
  const type = t === "image" || t === "image_button" ? "image_button" : t === "video" ? "video" : "button";
  return { messageType: type, buttons: JSON.stringify(btns) };
}

const replyId = (b: ButtonDef) => b.id || (b.type === "stop" ? STOP_ID : `mfy:${b.type ?? "reply"}:${b.text.trim().slice(0, 40)}`);

/** The native-flow buttons WhatsApp renders. At most 10; links need http(s), calls a number. Pure. */
export function nativeButtons(btns: ButtonDef[]): Array<{ name: string; buttonParamsJson: string }> {
  const out: Array<{ name: string; buttonParamsJson: string }> = [];
  for (const b of btns.slice(0, 10)) {
    const display_text = b.text.trim().slice(0, 25);
    if (b.type === "url" && b.url && /^https?:\/\//i.test(b.url)) out.push({ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text, url: b.url, merchant_url: b.url }) });
    else if (b.type === "call" && b.phone) out.push({ name: "cta_call", buttonParamsJson: JSON.stringify({ display_text, phone_number: b.phone.replace(/[^\d+]/g, "") }) });
    else if (b.type !== "url" && b.type !== "call") out.push({ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text, id: replyId(b) }) });
  }
  return out;
}

/** The interactive message body (without a media header). Pure. */
export function interactiveContent(body: string, btns: ButtonDef[], footer?: string) {
  return {
    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
    interactiveMessage: {
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      header: { title: "", subtitle: "", hasMediaAttachment: false },
      nativeFlowMessage: { buttons: nativeButtons(btns), messageParamsJson: "" },
    },
  };
}

/** The node that tells WhatsApp this is a native-flow message. */
export const NATIVE_FLOW_NODE = { tag: "biz", attrs: {}, content: [{ tag: "interactive", attrs: { type: "native_flow", v: "1" }, content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }] }] };

/** When real buttons are off: the message with clean lines under it. Pure. */
export function textWithButtons(body: string, btns: ButtonDef[]): string {
  const lines: string[] = [];
  const replies = btns.filter((b) => b.type !== "url" && b.type !== "call" && b.type !== "stop");
  for (const b of btns) {
    if (b.type === "url" && b.url) lines.push(`🔗 ${b.text}: ${b.url}`);
    else if (b.type === "call" && b.phone) lines.push(`📞 ${b.text}: ${b.phone}`);
  }
  if (replies.length) lines.push(`للرد اكتب: ${replies.map((b) => `«${b.text}»`).join(" أو ")}`);
  const stop = btns.find((b) => b.type === "stop");
  const out = lines.length ? `${body}\n\n${lines.join("\n")}` : body;
  return stop ? `${out}\n\n_لإيقاف رسائلنا أرسل: ${STOP_TEXT}_` : out;
}

/** What a button press says, as text: the stop id becomes «إيقاف الرسائل». */
export function buttonReplyText(m: any): string {
  const ir = m?.interactiveResponseMessage;
  if (ir) {
    let id = "";
    try { id = JSON.parse(ir.nativeFlowResponseMessage?.paramsJson ?? "{}")?.id ?? ""; } catch { /* ignore */ }
    if (id === STOP_ID) return STOP_TEXT;
    return String(ir.body?.text ?? "").trim() || (id.startsWith("mfy:") ? id.split(":").slice(2).join(":") : id);
  }
  const br = m?.buttonsResponseMessage ?? m?.templateButtonReplyMessage;
  const id = br?.selectedButtonId ?? br?.selectedId;
  if (id === STOP_ID) return STOP_TEXT;
  return String(br?.selectedDisplayText ?? "").trim();
}
