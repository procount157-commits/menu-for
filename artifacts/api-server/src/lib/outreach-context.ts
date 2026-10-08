// ── What we sent them, before they wrote ─────────────────────────
// Many conversations on a shop's number start with the shop: a deal went out
// to the customers who agreed, a campaign landed, and the customer is
// answering it. The host who reads the reply has to know what it is a reply
// to. Without that, «مهتم» under a weekend offer gets "أهلاً! وش تبي تطلب؟"
// — the reply of someone who has not seen their own shop's message.
//
// The thread now records our words as they go (whatsapp.ts recordOutbound),
// but campaigns sent before that left an empty row, and the thread holds only
// the last few turns. So the latest campaign this number received is read
// from the campaign itself and handed to the employee in plain words.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, messageLogs, campaignsTable, contactsTable } from "@workspace/db";

/**
 * A campaign template as one reader would have seen it: their name and the
 * shop's filled in, the first choice of each {a|b}, the random pools and
 * other fields dropped. Pure.
 */
export function readableTemplate(template: string, contactName?: string | null): string {
  const name = (contactName ?? "").trim();
  return template
    .replace(/\{(?:الاسم|اسم|name|الشركة|الشركه|شركة|شركه|company)(?:\|([^{}]*))?\}/gi, (_m, fallback?: string) => name || (fallback ?? "").trim())
    .replace(/\{([^{}|]*)\|[^{}]*\}/g, "$1")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/\n*━+\n🔕[^\n]*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+/gm, "")
    .trim();
}

export type Outreach = { campaign: string; text: string; buttons: string[]; daysAgo: number; read: boolean };

/** The name this number is saved under in the account's lists. */
export async function savedName(userId: number, phone: string): Promise<string | null> {
  const [c] = await db.select({ name: contactsTable.name }).from(contactsTable)
    .where(and(eq(contactsTable.phone, phone), sql`${contactsTable.groupId} IN (SELECT id FROM contact_groups WHERE user_id = ${userId})`, sql`${contactsTable.name} IS NOT NULL AND ${contactsTable.name} <> ''`))
    .limit(1);
  return c?.name ?? null;
}

/** The latest campaign this number received from the account, in the last 45 days. */
export async function lastOutreach(userId: number, phone: string, contactName?: string | null): Promise<Outreach | null> {
  const [row] = await db
    .select({
      name: campaignsTable.name, message: campaignsTable.message, buttons: campaignsTable.buttons,
      sentAt: messageLogs.sentAt, readAt: messageLogs.readAt,
    })
    .from(messageLogs)
    .innerJoin(campaignsTable, eq(messageLogs.campaignId, campaignsTable.id))
    .where(and(
      eq(messageLogs.phone, phone),
      eq(campaignsTable.userId, userId),
      eq(messageLogs.status, "sent"),
      gte(messageLogs.sentAt, new Date(Date.now() - 45 * 86_400_000)),
    ))
    .orderBy(desc(messageLogs.sentAt))
    .limit(1);
  if (!row?.message) return null;
  let buttons: string[] = [];
  try { buttons = (JSON.parse(row.buttons ?? "[]") as Array<{ text?: string; type?: string }>).filter((b) => b.type !== "stop").map((b) => b.text ?? "").filter(Boolean); } catch { /* none */ }
  return {
    campaign: row.name,
    text: readableTemplate(row.message, contactName).slice(0, 900),
    buttons,
    daysAgo: row.sentAt ? Math.floor((Date.now() - new Date(row.sentAt).getTime()) / 86_400_000) : 0,
    read: !!row.readAt,
  };
}

/** The block for the employee's instructions. Pure. */
export function outreachPreamble(o: Outreach | null, name?: string | null): string {
  if (!o) return name ? `═══ من هو ═══\nرقمه محفوظ عندنا باسم: ${name}` : "";
  const when = o.daysAgo === 0 ? "اليوم" : o.daysAgo === 1 ? "أمس" : `قبل ${o.daysAgo} أيام`;
  return [
    `═══ ما أرسلناه له قبل أن يكتب (${when}، حملة «${o.campaign}») ═══`,
    `«${o.text}»`,
    name ? `رقمه محفوظ عندنا باسم: ${name}` : "",
    o.buttons.length ? `وكان تحتها أزرار: ${o.buttons.join(" · ")}` : "",
    "رسالته على الأغلب ردّ على هذه. أكمل موضوعها هي: لا تعرّف بالمحل من جديد، ولا تسأله «وش تبي» قبل أن تربط كلامه بما أرسلناه — العرض أو الصنف أو الرابط الذي فيها.",
  ].filter(Boolean).join("\n");
}
