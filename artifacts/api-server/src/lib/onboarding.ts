// ── The onboarding interview ──────────────────────────────────────
// A new account gets a bot that answers from a knowledge base, and an empty
// knowledge base. Nobody fills one by hand: the owner of a cleaning company
// is not going to sit down and write 103 entries, and until they do the
// salesman has nothing to say. So the manager interviews them instead — ten
// questions, one at a time, in the assistant — and at the end writes the
// business profile and the first knowledge entries herself.
//
// The model asks; the code decides when it is finished and parses what it
// wrote. The output format is labelled lines rather than JSON because the
// model answering may be whatever free tier is up today, and a weak model
// closes a bracket wrongly far more often than it mislabels a line.

import { and, desc, eq } from "drizzle-orm";
import {
  db, assistantThreadsTable, assistantMessagesTable, businessProfileTable,
  knowledgeBaseTable, botEmployeesTable,
} from "@workspace/db";
import { logger } from "./logger";

export const INTERVIEW_KIND = "interview";
export const INTERVIEW_DONE = "interview-done";
export const INTERVIEW_TITLE = "🎤 مقابلة التأهيل";

/** The questions, in the order a sales manager would ask a new client. */
export const QUESTIONS = [
  "ما اسم شركتك وما نشاطها بالضبط، وفي أي إمارة أو مدينة؟",
  "من عملاؤكم عادةً — أي قطاعات وأي أحجام؟ ومن الذي لا يناسبكم كعميل؟",
  "ما الخدمات التي تقدمونها فعلاً؟ سمّها كما تبيعها للعميل لا كما تُكتب في الرخصة.",
  "ما الذي يميّزكم عن منافس يقدّم الخدمة نفسها؟ لماذا اختاركم من اختاركم؟",
  "الأسعار: هل يُذكر سعر على واتساب؟ إن نعم فما النطاقات وما الذي يحدّد السعر؟ وإن لا فماذا يقول الموظف حين يُسأل؟",
  "ما أكثر خمسة أسئلة يسألها العملاء، وما إجابة كل واحد منها؟",
  "ما الذي يجب ألا يقوله الموظف أبداً — وعود، أرقام، مواضيع، جهات؟",
  "ساعات العمل، وكيف يفضّل العميل أن يُتابَع بعد واتساب (مكالمة، اجتماع، زيارة)؟ وبأي لهجة أو لغة تكتبون؟",
  "حين يقتنع العميل، ما الخطوة التالية بالضبط؟ من من فريقكم يتولاه، ومتى، وماذا يحتاج منه (مستندات مثلاً)؟",
  "أي شيء آخر يجب أن يعرفه موظف مبيعات جديد في يومه الأول عندكم؟",
];

/** The first thing the owner reads. Fixed, so starting costs no model call. */
export function opening(managerName: string): string {
  return [
    `أهلاً، أنا ${managerName}. قبل أن يبدأ الفريق الرد على عملائك أحتاج أن أفهم شركتك كما تفهمها أنت — عشر أسئلة، واحد في كل مرة، وأكتب أنا الملف وقاعدة المعرفة من إجاباتك.`,
    "أجب كما تشرح لموظف جديد، بلا رسمية. وإن أردت التوقف في أي وقت قل «خلاص».",
    "",
    `١. ${QUESTIONS[0]}`,
  ].join("\n");
}

/** Which question comes next, from how many the owner has answered. */
export function nextQuestion(answered: number): { n: number; text: string } | null {
  if (answered >= QUESTIONS.length) return null;
  return { n: answered + 1, text: QUESTIONS[answered]! };
}

const AR_NUM = ["١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩", "١٠"];

export function interviewPrompt(manager: { name: string; persona?: string | null } | null, answered: number, finishing: boolean): string {
  const next = nextQuestion(answered);
  return [
    manager ? `أنت ${manager.name}، مديرة المبيعات.` : "أنت مديرة المبيعات.",
    manager?.persona ?? "",
    "",
    "تُجرين مقابلة تأهيل مع صاحب النشاط نفسه — لا مع عميل — لتكتبي منها ملف الشركة وقاعدة معرفة موظفي المبيعات.",
    "قواعد المقابلة:",
    "- سؤال واحد فقط في كل رسالة، بترقيمه. لا تسألي سؤالين.",
    "- قبل السؤال التالي جملة واحدة تُظهر أنك فهمت إجابته (لا تكرريها حرفياً).",
    "- إن كانت إجابته ناقصة فاسألي سؤال توضيح واحداً ثم انتقلي. لا تُلحّي.",
    "- لا تخترعي عنه شيئاً. ما لم يقله لا يُكتب.",
    "",
    `الأسئلة بالترتيب:\n${QUESTIONS.map((q, i) => `${AR_NUM[i]}. ${q}`).join("\n")}`,
    "",
    `أجاب حتى الآن على ${answered} من ${QUESTIONS.length}.`,
    finishing || !next
      ? [
          "المقابلة انتهت. اكتبي الآن الخلاصة بهذا الشكل بالضبط، بلا أي نص قبله:",
          "[الملف]",
          "الاسم: <اسم الشركة>",
          "النشاط: <النشاط في كلمات قليلة>",
          "الوصف: <٣ إلى ٥ أسطر عن الشركة وعملائها وما يميزها، كما يقرؤها موظف مبيعات>",
          "القيود: <ما يجب ألا يقوله الموظف أبداً، في أسطر قصيرة>",
          "[/الملف]",
          "[معرفة]",
          "عنوان: <عنوان قصير>",
          "محتوى: <الإجابة كما تُقال لعميل، بالعربية، ٢ إلى ٦ أسطر>",
          "---",
          "عنوان: ...",
          "محتوى: ...",
          "[/معرفة]",
          "اكتبي مدخلاً لكل خدمة، ولكل سؤال شائع، وللأسعار أو لما يُقال عنها، وللخطوة التالية، ولساعات العمل — من ٦ إلى ١٥ مدخلاً، كلها من إجاباته هو فقط.",
          "بعد [/معرفة] سطر واحد فقط يقول إنك كتبت الملف وإن بإمكانه مراجعته في صفحة المعرفة.",
        ].join("\n")
      : `السؤال التالي الذي تسألينه الآن هو رقم ${AR_NUM[next.n - 1]}: ${next.text}`,
  ].filter(Boolean).join("\n");
}

// ── Reading what she wrote ────────────────────────────────────────

export interface Harvest {
  profile: { name?: string; industry?: string; description?: string; guardrails?: string };
  entries: Array<{ title: string; content: string }>;
}

/** Pull the profile and the entries out of the closing message. Pure. */
export function harvest(text: string): Harvest | null {
  const prof = /\[الملف\]([\s\S]*?)\[\/الملف\]/.exec(text);
  const kb   = /\[معرفة\]([\s\S]*?)\[\/معرفة\]/.exec(text);
  if (!prof && !kb) return null;

  const field = (block: string, label: string) => {
    const re = new RegExp(`^\\s*${label}\\s*[:：]\\s*([\\s\\S]*?)(?=^\\s*(?:الاسم|النشاط|الوصف|القيود)\\s*[:：]|$(?![\\s\\S]))`, "mu");
    const m = re.exec(block);
    return m?.[1]?.trim() || undefined;
  };

  const profile: Harvest["profile"] = {};
  if (prof) {
    const b = prof[1]!;
    profile.name        = field(b, "الاسم");
    profile.industry    = field(b, "النشاط");
    profile.description = field(b, "الوصف");
    profile.guardrails  = field(b, "القيود");
  }

  const entries: Harvest["entries"] = [];
  if (kb) {
    for (const chunk of kb[1]!.split(/^\s*---+\s*$/mu)) {
      const t = /^\s*عنوان\s*[:：]\s*(.+)$/mu.exec(chunk)?.[1]?.trim();
      const c = /^\s*محتوى\s*[:：]\s*([\s\S]+)$/mu.exec(chunk)?.[1]?.trim();
      if (t && c) entries.push({ title: t.slice(0, 255), content: c });
    }
  }
  return { profile, entries };
}

/** Write it down: the profile merged field by field, the entries added. */
export async function applyHarvest(userId: number, h: Harvest): Promise<{ profileFields: number; entries: number }> {
  const [current] = await db.select().from(businessProfileTable).where(eq(businessProfileTable.userId, userId)).limit(1);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  let profileFields = 0;
  for (const k of ["name", "industry", "description", "guardrails"] as const) {
    if (h.profile[k]) { set[k] = h.profile[k]; profileFields++; }
  }
  if (current) {
    if (profileFields) await db.update(businessProfileTable).set(set).where(eq(businessProfileTable.userId, userId));
  } else {
    await db.insert(businessProfileTable).values({ userId, tone: "friendly", autoReply: false, ...set } as any);
  }

  if (h.entries.length) {
    await db.insert(knowledgeBaseTable).values(h.entries.map((e) => ({ userId, ...e, category: "مقابلة" })));
  }
  logger.info({ userId, profileFields, entries: h.entries.length }, "مقابلة التأهيل كُتبت في الملف والمعرفة");
  return { profileFields, entries: h.entries.length };
}

// ── Threads ───────────────────────────────────────────────────────

export async function managerFor(userId: number) {
  const [m] = await db.select({ name: botEmployeesTable.name, persona: botEmployeesTable.persona })
    .from(botEmployeesTable)
    .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, "chief"))).limit(1);
  return m ?? null;
}

/** Open the interview: a marked thread with the manager's opening line already in it. */
export async function startInterview(userId: number): Promise<{ threadId: number }> {
  const manager = await managerFor(userId);
  const [t] = await db.insert(assistantThreadsTable)
    .values({ userId, title: INTERVIEW_TITLE, kind: INTERVIEW_KIND }).returning();
  await db.insert(assistantMessagesTable).values({
    threadId: t!.id, userId, role: "assistant", content: opening(manager?.name ?? "شمّة"), provider: "fixed",
  });
  return { threadId: t!.id };
}

/** The owner asked to stop. */
export const STOP = /^\s*(خلاص|كفايه|كفاية|انتهينا|توقف|بس كذا|stop|done)\s*[.!]?\s*$/i;

export async function latestInterview(userId: number) {
  const [t] = await db.select().from(assistantThreadsTable)
    .where(and(eq(assistantThreadsTable.userId, userId), eq(assistantThreadsTable.kind, INTERVIEW_KIND)))
    .orderBy(desc(assistantThreadsTable.updatedAt)).limit(1);
  return t ?? null;
}
