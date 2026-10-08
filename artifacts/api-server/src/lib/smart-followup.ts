// ── The follow-up that writes for the person ─────────────────────
// The ladder in follow-up-engine sends the same templates to everyone on a
// sequence, and the officer argues each step but leaves the message to a
// template. Neither writes for the customer who asked the shop something,
// got an answer and went quiet — the one most worth a second message.
//
// This one follows up those people and no one else:
//
//   WHO   someone who wrote to the shop (a person, not their autoresponder),
//         got an answer, and went quiet. Never a customer who only received
//         a campaign and never replied, never one who ordered, queued or
//         booked in the last two weeks (they were served — the review and
//         win-back messages are theirs), never one who stopped messages.
//   WHEN  a ladder measured from our last message: 1, 3, 7, 14 days — or 4h,
//         1, 3, 7 days for a customer who was already at the link. Four at
//         most; a reply from them resets it.
//   WHAT  خالد writes each one for the person: what was said, what the shop
//         sent them, what the card knows, what the menu says on the subject,
//         and what the earlier follow-ups already tried. Each rung has its
//         own angle, and he may decline — "لا ترسل" — when he has nothing new.
//   CHECK the same pre-send check as every reply, one rewrite at most; a
//         blank or a near-copy of an earlier follow-up is dropped.
//
// Operations keeps its veto over the whole round, and the number's daily
// allowance, sending hours, the plan's monthly replies and every opt-out
// apply. It starts in dry mode: every draft and decision is recorded for the
// owner to read, and nothing is sent until they switch it to live.

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db, waThreadMessagesTable, botEmployeesTable, businessProfileTable, followupDeliberationsTable,
  unsubscribedPhonesTable, leadSourcesTable,
} from "@workspace/db";
import { complete } from "./llm";
import { asAgent } from "./agent-context";
import { charterBlock } from "./roles/charters";
import { detectAutoresponder } from "./autoresponder";
import { getCard, cardText, isHumanHeld } from "./lead-card";
import { lastOutreach, outreachPreamble, savedName } from "./outreach-context";
import { retrieve } from "./knowledge";
import { checkReply, needsRewrite, rewritePrompt, blocksSend } from "./reply-check";
import { opsVerdict, FOLLOWUP_ROLE } from "./followup-officer";
import { isWithinSendingHours } from "./sending-hours";
import { getDailyRemaining } from "./daily-limit";
import { assertCanSend } from "./plans";
import { agentReplyAllowed } from "./growth/quota";
import { sendMessage, getStatus } from "./whatsapp";
import { logger } from "./logger";
import { receipt } from "./graph/receipts";

const H = 3_600_000;
/** Hours after our last message, per rung. A warm customer is followed sooner. */
export const LADDER = { cold: [24, 72, 168, 336], warm: [4, 24, 72, 168] } as const;
export const MAX_RUNGS = 4;
/** Smart follow-ups are recorded with step 100+rung, apart from the old ladder's 0–6. */
export const STEP_BASE = 100;
/** A lead card at this stage or later had the link in hand: warm. */
export const WARM_STAGE = 4;
const MAX_PER_RUN = 8;

/** What each rung is for — so the four messages are four different messages. */
export const RUNG_ANGLE = [
  "المتابعة ١ — أكمل من حيث توقفت المحادثة: أجب عن آخر نقطة بقيت مفتوحة، أو أضف معلومة واحدة من المنيو تخص ما سأل عنه هو. لا تقل «أتابع» ولا «هل وصلتك رسالتي».",
  "المتابعة ٢ — زاوية جديدة لم تُذكر: صنف أو خدمة أو عرض مكتوب في المنيو يناسب ما طلبه أو مناسبته، في جملتين، ثم سؤال يجيب عنه بنعم أو لا.",
  "المتابعة ٣ — خطوة سهلة جداً: الرابط الذي يكمل به (المنيو للطلب، الحجز، الدور) مع جملة تقول ما سيجده فيه — اختر ما يناسب ما قاله.",
  "المتابعة ٤ والأخيرة — ختام لطيف: قل إنك لن تزعجه بعدها وإن المحل بانتظاره متى حب، في سطر أو سطرين، بلا ضغط ولا سؤال.",
];

export type Mode = "off" | "dry" | "live";

export async function modeOf(userId: number): Promise<Mode> {
  const [p] = await db.select({ m: businessProfileTable.smartFollowup }).from(businessProfileTable).where(eq(businessProfileTable.userId, userId)).limit(1);
  const m = (p?.m ?? "dry") as Mode;
  return m === "live" || m === "off" ? m : "dry";
}

type Turn = { fromMe: boolean; text: string; at: Date };

/** Word overlap of two messages, 0–1 — a near-copy of an earlier follow-up is not a new one. Pure. */
export function overlap(a: string, b: string): number {
  const w = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((x) => x.length > 2));
  const A = w(a), B = w(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * Who is due, and at which rung. Pure: the thread, the rungs already taken
 * since their last message, and the time.
 */
export function dueRung(turns: Turn[], taken: Date[], warm: boolean, now = Date.now()): { rung: number; dueAt: number } | null {
  const lastIn = [...turns].reverse().find((t) => !t.fromMe);
  if (!lastIn) return null;                                  // never spoke — not ours to chase
  const lastOut = [...turns].reverse().find((t) => t.fromMe);
  if (!lastOut || lastOut.at.getTime() < lastIn.at.getTime()) return null; // their turn is unanswered: the reply path's job
  const since = taken.filter((d) => d.getTime() > lastIn.at.getTime());
  const rung = since.length;
  if (rung >= MAX_RUNGS) return null;
  const base = Math.max(lastOut.at.getTime(), ...since.map((d) => d.getTime()));
  const dueAt = base + (warm ? LADDER.warm : LADDER.cold)[rung]! * H;
  return dueAt <= now ? { rung, dueAt } : null;
}

async function thread(userId: number, phone: string, limit = 14): Promise<Turn[]> {
  const rows = await db.select({ fromMe: waThreadMessagesTable.fromMe, text: waThreadMessagesTable.text, at: waThreadMessagesTable.createdAt })
    .from(waThreadMessagesTable)
    .where(and(eq(waThreadMessagesTable.userId, userId), eq(waThreadMessagesTable.phone, phone), sql`coalesce(${waThreadMessagesTable.text}, '') <> ''`))
    .orderBy(desc(waThreadMessagesTable.createdAt)).limit(limit);
  return rows.reverse().map((r) => ({ fromMe: !!r.fromMe, text: r.text ?? "", at: new Date(r.at) }));
}

/**
 * Conversations where we spoke last, they had spoken in the last month, and
 * the quiet has lasted at least four hours — less those the shop served in
 * the last two weeks (an order, a turn, a booking: the notifications went to
 * them), whose follow-up is the review and win-back lane's.
 */
async function candidates(userId: number): Promise<string[]> {
  const r = await db.execute(sql`
    SELECT t.phone FROM wa_thread_messages t
    WHERE t.user_id = ${userId} AND t.created_at > now() - interval '35 days'
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.wa_user_id = ${userId} AND right(n.phone, 9) = right(t.phone, 9) AND n.created_at > now() - interval '14 days')
    GROUP BY t.phone
    HAVING max(t.created_at) FILTER (WHERE NOT t.from_me) > now() - interval '30 days'
       AND max(t.created_at) FILTER (WHERE t.from_me) > max(t.created_at) FILTER (WHERE NOT t.from_me)
       AND max(t.created_at) < now() - interval '4 hours'
    ORDER BY max(t.created_at) DESC
    LIMIT 200`);
  return (r.rows as Array<{ phone: string }>).map((x) => x.phone);
}

type Draft = { send: boolean; text: string | null; reason: string };

/** خالد writes the rung, or declines. */
async function compose(userId: number, phone: string, turns: Turn[], rung: number, earlier: string[]): Promise<Draft> {
  const [[me], [profile], card, name] = await Promise.all([
    db.select().from(botEmployeesTable).where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, FOLLOWUP_ROLE))).limit(1),
    db.select().from(businessProfileTable).where(eq(businessProfileTable.userId, userId)).limit(1),
    getCard(userId, phone).catch(() => null),
    savedName(userId, phone).catch(() => null),
  ]);
  const outreach = outreachPreamble(await lastOutreach(userId, phone, name).catch(() => null), name);
  const topic = turns.filter((t) => !t.fromMe).slice(-3).map((t) => t.text).join(" ");
  const found = await retrieve(userId, topic, 3).catch(() => []);
  const facts = found.map((f) => `${f.entry.title}\n${f.entry.content.slice(0, 700)}`).join("\n\n");

  const system = [
    `اسمك ${me?.name ?? "خالد"}، ${me?.title ?? "موظف المتابعة"}${profile?.name ? ` لدى ${profile.name}` : ""}.`,
    me?.persona ? `شخصيتك: ${me.persona}` : "",
    profile?.description ? `عن المحل: ${profile.description}` : "",
    "",
    charterBlock(FOLLOWUP_ROLE),
    "",
    RUNG_ANGLE[rung]!,
    "اكتب الرسالة نفسها فقط، بلغة الزبون ولهجته، سطر إلى ثلاثة، بلا قوائم ولا عناوين.",
    "لا سعر ولا صنف ولا عرض ولا خصم ولا موعد غير مكتوب في معلومات المحل أدناه. لا تذكر أنك برنامج.",
    "إن لم يكن عندك شيء جديد يستحق رسالة — أو كان آخر ما قاله يعني أنه لا يريد — فاكتب بالضبط: «لا ترسل: <السبب في سطر>».",
    profile?.guardrails ? `تعليمات صاحب المحل: ${profile.guardrails}` : "",
    "",
    outreach,
    card ? cardText(card) : "",
    earlier.length ? `═══ ما قلناه له في المتابعات السابقة — لا تكرره ولا تعِد صياغته ═══\n${earlier.map((e, i) => `${i + 1}. ${e}`).join("\n")}` : "",
    facts ? `═══ من معلومات المحل عن موضوعه ═══\n${facts}` : "",
    "",
    "قبل أن تكتب: □ هل فيها شيء جديد لم يُقل في المحادثة ولا في المتابعات السابقة؟ □ هل تصلح لهذا الزبون وحده؟",
  ].filter((x) => x !== "").join("\n");
  const transcript = turns.map((t) => `${t.fromMe ? "المحل" : "الزبون"}: ${t.text.slice(0, 500)}`).join("\n");
  const out = await complete([
    { role: "system", content: system },
    { role: "user", content: `المحادثة حتى الآن:\n${transcript}\n\nسكت الزبون منذ آخر رسالة منا. اكتب ${RUNG_ANGLE[rung]!.split(" — ")[0]}.` },
  ], 30_000);
  const raw = out?.text?.trim().replace(/^["«“]+|["»”]+$/g, "").trim();
  if (!raw) return { send: false, text: null, reason: "تعذّر الوصول للنموذج" };
  const no = /^«?\s*لا ترسل\s*[:：]?\s*(.*)$/s.exec(raw);
  if (no) return { send: false, text: null, reason: `خالد: ${no[1]!.replace(/»$/, "").trim() || "لا جديد يستحق"}` };

  // The check every reply passes, and one rewrite at most.
  const lastCustomer = [...turns].reverse().find((t) => !t.fromMe)?.text ?? "";
  const previous = [...turns].reverse().find((t) => t.fromMe)?.text ?? null;
  const ctx = {
    customer: lastCustomer, previous, stage: card?.stage,
    known: card ? { licence: card.licence, activity: card.activity, size: card.size, staff: card.staff } : undefined,
    facts: [facts, profile?.description ?? ""].join("\n"),
  };
  let text = raw, q = checkReply(text, ctx);
  if (needsRewrite(q)) {
    const fixed = await complete([
      { role: "system", content: "أنت محرر رسائل واتساب لمحل. تُصلح ما يُطلب منك فقط وتعيد الرسالة المصحّحة وحدها." },
      { role: "user", content: rewritePrompt(text, q, ctx) },
    ], 20_000);
    const candidate = fixed?.text?.trim().replace(/^["«“]+|["»”]+$/g, "").trim();
    if (candidate) { const q2 = checkReply(candidate, ctx); if (q2.score > q.score) { text = candidate; q = q2; } }
  }
  if (blocksSend(q)) return { send: false, text, reason: `أُوقفت: ${q.issues.find((i) => i.code === "placeholder" || i.code === "reveal")?.note ?? "فحص الكتابة"}` };
  const copy = earlier.find((e) => overlap(e, text) > 0.6);
  if (copy) return { send: false, text, reason: "تكاد تكون نسخة من متابعة سابقة" };
  return { send: true, text, reason: q.issues.length ? `جاهزة مع ملاحظات: ${q.issues.map((i) => i.note).join("، ")}`.slice(0, 300) : "جاهزة" };
}

async function record(userId: number, phone: string, rung: number, verdict: "send" | "hold" | "drop", reason: string, draft: string | null, executed: boolean, opsView: string) {
  receipt({ userId, node: FOLLOWUP_ROLE, graph: "whatsapp", action: executed ? "followup.sent" : verdict === "send" ? "followup.draft" : "followup.decline",
    status: executed || verdict === "send" ? "ok" : "blocked", subject: phone, evidence: { rung: rung + 1, ops: opsView }, why: reason.slice(0, 600) });
  await db.insert(followupDeliberationsTable).values({
    userId, phone, step: STEP_BASE + rung, verdict, reason: reason.slice(0, 1000),
    managerView: "خالد يكتب ويقرر", opsView, draft, executed,
  });
}

/** One round for one account. */
export async function runSmartFollowUps(userId: number, now = Date.now()) {
  const mode = await modeOf(userId);
  const result = { mode, considered: 0, drafted: 0, sent: 0, declined: 0 };
  if (mode === "off") return result;
  if (!isWithinSendingHours(new Date(now))) return result;
  if (mode === "live" && !getStatus(userId).connected) return result;

  const phones = await candidates(userId);
  if (!phones.length) return result;

  // Who is not to be followed at all.
  const [outRows, coldRows] = await Promise.all([
    db.select({ phone: unsubscribedPhonesTable.phone }).from(unsubscribedPhonesTable).where(and(eq(unsubscribedPhonesTable.userId, userId), inArray(unsubscribedPhonesTable.phone, phones))),
    db.select({ phone: leadSourcesTable.phone }).from(leadSourcesTable).where(and(eq(leadSourcesTable.userId, userId), inArray(leadSourcesTable.phone, phones), inArray(leadSourcesTable.lastIntent, ["not_interested", "opt_out", "complaint"]))),
  ]);
  const skip = new Set([...outRows, ...coldRows].map((r) => r.phone));

  // The rungs already taken, per phone.
  const takenRows = await db.select({ phone: followupDeliberationsTable.phone, at: followupDeliberationsTable.createdAt, draft: followupDeliberationsTable.draft, verdict: followupDeliberationsTable.verdict })
    .from(followupDeliberationsTable)
    .where(and(eq(followupDeliberationsTable.userId, userId), inArray(followupDeliberationsTable.phone, phones), sql`${followupDeliberationsTable.step} >= ${STEP_BASE}`, gt(followupDeliberationsTable.createdAt, new Date(now - 60 * 86_400_000))));

  let ops: { ok: boolean; view: string } | null = null;
  let left = mode === "live" ? await getDailyRemaining(userId).catch(() => 0) : Infinity;
  if (mode === "live") {
    const planOk = await assertCanSend(userId).then(() => true).catch(() => false);
    if (!planOk) return result;
  }

  for (const phone of phones) {
    if (result.drafted >= MAX_PER_RUN) break;
    if (skip.has(phone)) continue;
    const turns = await thread(userId, phone);
    // A thread whose every word from them is a machine's is not a conversation.
    const fromThem = turns.filter((t) => !t.fromMe);
    if (!fromThem.length || fromThem.every((t) => detectAutoresponder(t.text).isAuto)) continue;

    const mine = takenRows.filter((r) => r.phone === phone && (r.verdict === "send" || r.verdict === "drop"));
    const card = await getCard(userId, phone).catch(() => null);
    const due = dueRung(turns, mine.map((r) => new Date(r.at)), (card?.stage ?? 1) >= WARM_STAGE, now);
    if (!due) continue;
    result.considered++;
    if (await isHumanHeld(userId, phone)) continue;

    // Operations decides once a round, and its no stops the round.
    ops ??= await opsVerdict(userId);
    if (!ops.ok) { logger.info({ userId, why: ops.view }, "smart follow-ups held by operations"); break; }
    if (left <= 0) break;

    const lastIn = [...turns].reverse().find((t) => !t.fromMe)!.at.getTime();
    const earlier = mine.filter((r) => new Date(r.at).getTime() > lastIn && r.draft).map((r) => r.draft!);
    const d = await asAgent(userId, FOLLOWUP_ROLE, () => compose(userId, phone, turns, due.rung, earlier));
    result.drafted++;
    if (!d.send || !d.text) {
      // Declined: the ladder ends for this person until they speak again.
      await record(userId, phone, due.rung, "drop", d.reason, d.text, false, ops.view);
      result.declined++;
      continue;
    }
    if (mode === "dry") {
      await record(userId, phone, due.rung, "send", `${d.reason} (وضع التجربة — لم تُرسل)`, d.text, false, ops.view);
      continue;
    }
    // A shop's plan: the AI's replies this month (counted when it sends).
    if (!(await agentReplyAllowed(userId))) { logger.info({ userId }, "smart follow-ups stopped — the plan's AI replies are used up this month"); break; }
    try {
      await asAgent(userId, FOLLOWUP_ROLE, () => sendMessage(userId, phone, d.text!));
      await record(userId, phone, due.rung, "send", d.reason, d.text, true, ops.view);
      result.sent++; left--;
      logger.info({ userId, phone, rung: due.rung + 1 }, "smart follow-up sent");
      await new Promise((r) => setTimeout(r, 20_000 + Math.random() * 25_000));
    } catch (err: any) {
      logger.warn({ userId, phone, err: String(err?.message ?? err).slice(0, 160) }, "smart follow-up send failed — will try next round");
    }
  }
  if (result.drafted) logger.info({ userId, ...result }, "smart follow-up round done");
  return result;
}

let timer: NodeJS.Timeout | null = null;
export function startSmartFollowUps() {
  if (timer) return;
  const run = async () => {
    const users = await db.execute(sql`SELECT user_id FROM business_profile WHERE smart_followup <> 'off' AND auto_reply = true`).catch(() => ({ rows: [] }));
    for (const u of users.rows as Array<{ user_id: number }>) {
      await runSmartFollowUps(u.user_id).catch((err) => logger.warn({ userId: u.user_id, err: String(err?.message ?? err) }, "smart follow-up round failed"));
    }
  };
  setTimeout(() => void run(), 3 * 60_000).unref();
  timer = setInterval(() => void run(), 20 * 60_000);
  timer.unref();
}
