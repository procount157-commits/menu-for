// ── Telegram ──────────────────────────────────────────────────────
// Reports reach the owner where they already are, rather than waiting on a
// dashboard nobody has open at 7am.
//
// The linking is the awkward part, and it is Telegram's rule rather than a
// design choice: a bot cannot open a conversation with a person. The owner has
// to message it first, and only then does its chat id exist. So `link` polls
// getUpdates for a recent message and takes the chat from it.

import { and, eq, isNotNull } from "drizzle-orm";
import { db, telegramSettingsTable, type TelegramSettings } from "@workspace/db";
import { logger } from "./logger";

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

async function call<T = any>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(API(token, method), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const d = await res.json() as any;
  if (!d?.ok) throw new Error(d?.description ?? `telegram ${method} ${res.status}`);
  return d.result as T;
}

/** Confirms a token before it is stored, and names the bot for the UI. */
export async function verifyToken(token: string): Promise<{ username: string; name: string }> {
  const me = await call<any>(token, "getMe");
  return { username: me.username, name: me.first_name };
}

export async function getSettings(userId: number): Promise<TelegramSettings | null> {
  const [row] = await db.select().from(telegramSettingsTable)
    .where(eq(telegramSettingsTable.userId, userId)).limit(1);
  return row ?? null;
}

export async function saveToken(userId: number, botToken: string): Promise<void> {
  await db.insert(telegramSettingsTable)
    .values({ userId, botToken, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: telegramSettingsTable.userId,
      // A new token means a new bot, so the old chat id no longer applies.
      set: { botToken, chatId: null, chatTitle: null, linkedAt: null, lastError: null, updatedAt: new Date() },
    });
}

/**
 * Look for a message the owner has sent the bot, and remember where it came
 * from.
 *
 * Takes the most recent update rather than the first: if the owner tried twice,
 * the second attempt is the one they are watching.
 */
export async function link(userId: number): Promise<{ linked: boolean; chatTitle?: string }> {
  const s = await getSettings(userId);
  if (!s) throw new Error("لم يُضف توكن بعد");

  const updates = await call<any[]>(s.botToken, "getUpdates");
  const withChat = updates
    .map((u) => u.message ?? u.edited_message ?? u.channel_post)
    .filter((m) => m?.chat?.id);
  const last = withChat[withChat.length - 1];
  if (!last) return { linked: false };

  const chat = last.chat;
  const title = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? String(chat.id);
  await db.update(telegramSettingsTable)
    .set({ chatId: String(chat.id), chatTitle: title.slice(0, 120), linkedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(telegramSettingsTable.userId, userId));

  logger.info({ userId, chatTitle: title }, "تليجرام مربوط");
  return { linked: true, chatTitle: title };
}

/**
 * Send, and never throw.
 *
 * Every caller is an agent finishing a job. A Telegram outage must not fail
 * the report that was being delivered, and a failure here is a delivery
 * problem, not a reason to discard the work.
 */
export async function notify(userId: number, text: string): Promise<boolean> {
  const s = await getSettings(userId);
  if (!s?.chatId || !s.enabled) return false;
  try {
    await call(s.botToken, "sendMessage", {
      chat_id: s.chatId,
      text: text.slice(0, 4_000),
      parse_mode: "HTML",
      // A report is for reading, not for chasing a link preview.
      disable_web_page_preview: true,
    });
    return true;
  } catch (err: any) {
    const msg = String(err?.message ?? err).slice(0, 300);
    await db.update(telegramSettingsTable).set({ lastError: msg })
      .where(eq(telegramSettingsTable.userId, userId)).catch(() => {});
    logger.warn({ userId, err: msg }, "تعذّر الإرسال إلى تليجرام");
    return false;
  }
}

/** Accounts that can actually receive something. */
export async function linkedUsers(): Promise<number[]> {
  const rows = await db.select({ userId: telegramSettingsTable.userId })
    .from(telegramSettingsTable)
    .where(and(isNotNull(telegramSettingsTable.chatId), eq(telegramSettingsTable.enabled, true)));
  return rows.map((r) => r.userId);
}

/** Telegram's HTML subset is small; anything unescaped breaks the whole message. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
