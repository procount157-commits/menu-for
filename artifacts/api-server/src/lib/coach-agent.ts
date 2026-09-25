// ── The sales manager ─────────────────────────────────────────────
// Sets the standard, watches how the team performs against it, and writes what
// she learns into their memory as standing instructions.
//
// This is the difference between a manager and a report. The routines already
// produced observations and filed them; nothing turned an observation into a
// change in how anyone answers. She reads each employee's wins and losses —
// which are measured, not opinions, since a reply is judged by what the
// customer said next — and writes the rule that follows from them. The rule
// lands in that employee's own memory and is in front of them on their very
// next reply.
//
// On sounding human: this is about writing, not about hiding. Replies that
// open with the same greeting every time, restate the customer's question
// before answering it, or end on the same manufactured question read as
// machine output to a person, and people stop answering them. What she
// enforces is varied, specific, unpadded Arabic. Nothing here touches
// delivery, timing, identifiers or anything WhatsApp inspects — the pacing and
// the account limits are فهد's job and they are a separate matter entirely.

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  db, autoReplyLogTable, botEmployeesTable, agentMemoryTable,
  managerReviewsTable,
} from "@workspace/db";
import { complete } from "./llm";
import { remember } from "./agent-memory";
import { say } from "./agent-comms";
import { notify, esc } from "./telegram";
import { logger } from "./logger";

export const COACH_ROLE = "chief";

/** The house style, enforced on every customer-facing employee. */
export const HOUSE_STYLE = [
  "اكتب كما يكتب موظف حقيقي على واتساب، لا كما يكتب نظام:",
  "- نوّع افتتاحياتك. لا تبدأ كل رسالة بنفس التحية.",
  "- لا تُعد صياغة سؤال العميل قبل أن تجيبه — أجب مباشرة.",
  "- اذكر تفصيلاً من كلامه هو. العبارات العامة تصلح لأي أحد، وهذا بالضبط ما يجعلها تبدو آلية.",
  "- لا تُرقّم كل شيء ولا تضع عناوين عريضة. رسالة واتساب ليست تقريراً.",
  "- اجعلها قصيرة. سطران أو ثلاثة يكفيان في أغلب الأحيان.",
  "- لا تعتذر بلا سبب، ولا تشكر في كل سطر، ولا تستخدم عبارات مثل «يسعدني أن أساعدك» أو «لا تتردد».",
  "- لا تنهِ كل رسالة بسؤال مصطنع. اسأل حين يكون لديك سؤال حقيقي.",
];

type Performance = {
  role: string; name: string;
  replied: number; wins: number; losses: number;
  bestReplies: string[]; worstReplies: string[];
};

/** How each customer-facing employee has been doing, with examples. */
async function performance(userId: number, days = 7): Promise<Performance[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);

  const team = (await db.select().from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.isActive, true))))
    .filter((e) => e.kind === "customer");

  const out: Performance[] = [];
  for (const e of team) {
    const where = and(
      eq(autoReplyLogTable.userId, userId),
      eq(autoReplyLogTable.agentRole, e.role),
      gte(autoReplyLogTable.createdAt, since),
      isNotNull(autoReplyLogTable.reply),
    );
    const [[totals], best, worst] = await Promise.all([
      db.select({
        replied: sql<number>`count(*)`,
        wins:    sql<number>`count(*) filter (where ${autoReplyLogTable.outcome} = 'win')`,
        losses:  sql<number>`count(*) filter (where ${autoReplyLogTable.outcome} = 'loss')`,
      }).from(autoReplyLogTable).where(where),
      db.select({ incoming: autoReplyLogTable.incoming, reply: autoReplyLogTable.reply })
        .from(autoReplyLogTable).where(and(where, eq(autoReplyLogTable.outcome, "win")))
        .orderBy(desc(autoReplyLogTable.createdAt)).limit(4),
      db.select({ incoming: autoReplyLogTable.incoming, reply: autoReplyLogTable.reply })
        .from(autoReplyLogTable).where(and(where, eq(autoReplyLogTable.outcome, "loss")))
        .orderBy(desc(autoReplyLogTable.createdAt)).limit(4),
    ]);

    const fmt = (r: { incoming: string | null; reply: string | null }) =>
      `العميل: ${(r.incoming ?? "").slice(0, 90)}\n${e.name}: ${(r.reply ?? "").slice(0, 200)}`;

    out.push({
      role: e.role, name: e.name,
      replied: Number(totals?.replied ?? 0),
      wins: Number(totals?.wins ?? 0),
      losses: Number(totals?.losses ?? 0),
      bestReplies: best.map(fmt),
      worstReplies: worst.map(fmt),
    });
  }
  return out;
}

export type Coaching = { role: string; name: string; rules: string[]; note: string };

/**
 * Coach one employee.
 *
 * Rules are capped at three per round, and that is the point rather than a
 * detail: an employee carrying thirty standing instructions follows none of
 * them, because the prompt is long enough by then that the middle of the list
 * is what the model attends to. Three a week that actually change behaviour
 * beat twenty that dilute each other.
 */
async function coachOne(userId: number, p: Performance, manager: typeof botEmployeesTable.$inferSelect | undefined): Promise<Coaching | null> {
  // Nothing measured yet. Coaching on no evidence is just guessing in her
  // voice, and it would fill their memory with untested opinions.
  if (p.wins + p.losses < 3) return null;

  const existing = await db.select({ content: agentMemoryTable.content }).from(agentMemoryTable)
    .where(and(eq(agentMemoryTable.userId, userId), eq(agentMemoryTable.role, p.role),
               eq(agentMemoryTable.kind, "instruction")));

  const out = await complete([
    { role: "system", content: [
      manager ? `أنت ${manager.name}${manager.title ? `، ${manager.title}` : ""}.` : "أنت مديرة مبيعات.",
      manager?.persona ?? "",
      "",
      `تُدرّبين ${p.name}، أحد موظفي فريقك. أمامك أداؤه خلال أسبوع، مع أمثلة من ردود أدّت لاهتمام العميل وردود أدّت لانصرافه.`,
      "استخرجي من هذه الأمثلة تحديداً — لا من معرفتك العامة بالبيع — ما يجب أن يغيّره.",
      "",
      "معيار الكتابة الذي تفرضينه على الفريق:",
      ...HOUSE_STYLE,
      "",
      "اكتبي بهذا الشكل بالضبط ولا شيء غيره:",
      "قاعدة: <قاعدة واحدة قابلة للتطبيق في سطر>",
      "قاعدة: <قاعدة ثانية>",
      "ملاحظة: <سطران لصاحب العمل عن حال هذا الموظف>",
      "",
      "ثلاث قواعد كحد أقصى. القاعدة يجب أن تكون سلوكاً يفعله أو يتوقف عنه، لا نصيحة عامة.",
      existing.length ? `\nقواعد يلتزم بها فعلاً — لا تكرريها ولا تناقضيها:\n${existing.map((x) => `- ${x.content}`).join("\n")}` : "",
    ].filter(Boolean).join("\n") },
    { role: "user", content: [
      `${p.name}: ${p.replied} رد، ${p.wins} أدّى لاهتمام، ${p.losses} أدّى لانصراف.`,
      p.bestReplies.length ? `\n— ردود نجحت —\n${p.bestReplies.join("\n\n")}` : "",
      p.worstReplies.length ? `\n— ردود فشلت —\n${p.worstReplies.join("\n\n")}` : "",
    ].filter(Boolean).join("\n") },
  ]);

  if (!out?.text) return null;

  const rules: string[] = [];
  let note = "";
  for (const line of out.text.split("\n")) {
    const r = /^\s*قاعدة\s*[:：]\s*(.+)$/.exec(line);
    if (r?.[1] && rules.length < 3) { rules.push(r[1].trim()); continue; }
    const n = /^\s*ملاحظة\s*[:：]\s*(.+)$/.exec(line);
    if (n?.[1]) note = n[1].trim();
  }
  if (rules.length === 0) return null;

  for (const rule of rules) await remember(userId, p.role, "instruction", rule);

  // Told to them as well as stored: a rule that appears in their memory with
  // no explanation is an order from nowhere, and the manager saying it is what
  // makes her a manager rather than a config file.
  await say({
    userId, fromRole: COACH_ROLE, toRole: p.role, kind: "directive",
    body: [`راجعت أداءك هذا الأسبوع. من الآن:`, ...rules.map((r) => `- ${r}`)].join("\n"),
  }).catch(() => {});

  return { role: p.role, name: p.name, rules, note };
}

/** Make sure everyone carries the house style, once. */
export async function enforceHouseStyle(userId: number): Promise<number> {
  const team = (await db.select().from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.isActive, true))))
    .filter((e) => e.kind === "customer");

  let n = 0;
  for (const e of team) {
    for (const rule of HOUSE_STYLE.slice(1)) {
      // remember() counts repeats instead of duplicating, so this is safe to
      // run on every round.
      await remember(userId, e.role, "instruction", rule.replace(/^- /, ""));
    }
    n++;
  }
  return n;
}

/** One coaching round across the whole team. */
export async function runCoach(userId: number) {
  const [manager] = await db.select().from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, COACH_ROLE))).limit(1);

  const perf = await performance(userId);
  const coached: Coaching[] = [];
  for (const p of perf) {
    const c = await coachOne(userId, p, manager);
    if (c) coached.push(c);
  }

  const summary = coached.length === 0
    ? "لا توجد نتائج كافية لتدريب أحد هذا الأسبوع — الفريق يحتاج ردوداً أكثر قبل أن يُقاس أداؤه."
    : coached.map((c) => `${c.name}: ${c.rules.length} قاعدة جديدة. ${c.note}`).join("\n");

  await db.insert(managerReviewsTable).values({
    userId, summary, directives: coached as any,
  });

  if (coached.length > 0) {
    await notify(userId, [
      `<b>👩‍💼 ${esc(manager?.name ?? "مديرة المبيعات")} — مراجعة الفريق</b>`,
      "",
      ...coached.flatMap((c) => [
        `<b>${esc(c.name)}</b>`,
        ...c.rules.map((r) => `• ${esc(r)}`),
        c.note ? `<i>${esc(c.note)}</i>` : "",
        "",
      ]),
    ].filter(Boolean).join("\n")).catch(() => {});
  }

  logger.info({ userId, coached: coached.length }, "مديرة المبيعات أنهت مراجعة");
  return { coached, summary, performance: perf };
}
