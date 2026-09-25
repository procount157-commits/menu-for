import { remember, forget, learnFromOutcome, memoryFor, memoryPreamble, tasksFor } from "../agent-memory";
import { skillsFor, skillsPreamble } from "../agent-skills";
import { isDue } from "../agent-routines";
import {
  db, agentMemoryTable, agentTasksTable, agentSkillsTable, agentSkillGrantsTable,
  autoReplyLogTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const USER = 1, ROLE = "sales", P = "971500000009";
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

async function clean() {
  await db.delete(agentMemoryTable).where(eq(agentMemoryTable.userId, USER));
  await db.delete(agentTasksTable).where(eq(agentTasksTable.userId, USER));
  await db.delete(agentSkillGrantsTable).where(eq(agentSkillGrantsTable.userId, USER));
  await db.delete(agentSkillsTable).where(eq(agentSkillsTable.userId, USER));
  await db.delete(autoReplyLogTable).where(eq(autoReplyLogTable.userId, USER));
}

// ── Remembering ──────────────────────────────────────────────────
await clean();
await remember(USER, ROLE, "instruction", "لا تذكر السعر قبل أن يخبرك بحجم شركته");
let mem = await memoryFor(USER, ROLE);
check("a standing order is stored", mem.instruction[0]?.content.includes("لا تذكر السعر") === true);
check("...counted once", mem.instruction[0]?.times === 1);

await remember(USER, ROLE, "instruction", "لا تذكر السعر قبل أن يخبرك بحجم شركته");
mem = await memoryFor(USER, ROLE);
check("the same lesson twice increments, not duplicates", mem.instruction.length === 1 && mem.instruction[0]?.times === 2);

await remember(USER, ROLE, "loss", "عرض مباشر للسعر في أول رد");
await remember(USER, ROLE, "loss", "عرض مباشر للسعر في أول رد");
await remember(USER, ROLE, "loss", "عرض مباشر للسعر في أول رد");
await remember(USER, ROLE, "loss", "سؤال واحد فقط ثم صمت");
mem = await memoryFor(USER, ROLE);
check("the most-repeated lesson comes first", mem.loss[0]?.times === 3, `${mem.loss[0]?.times}×`);

// One employee's memory is not another's — the whole point of it being its own.
await remember(USER, "support", "instruction", "اعتذر مرة واحدة فقط");
check("memory is per employee", (await memoryFor(USER, "support")).instruction.length === 1);
check("...and does not leak to a colleague", (await memoryFor(USER, ROLE)).instruction.length === 1);

const [one] = await db.select().from(agentMemoryTable)
  .where(and(eq(agentMemoryTable.userId, USER), eq(agentMemoryTable.kind, "loss")));
await forget(USER, one!.id);
check("a lesson can be removed", (await memoryFor(USER, ROLE)).loss.length === 1);

// ── Learning from what the customer said next ───────────────────
await clean();
async function logReply(reply: string, agentRole: string | null, minutesAgo = 5) {
  const [r] = await db.insert(autoReplyLogTable).values({
    userId: USER, phone: P, incoming: "سؤال", reply, agentRole,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  } as any).returning();
  return r!;
}

await logReply("تمام، ممكن أعرف حجم شركتك؟", ROLE);
await learnFromOutcome(USER, P, "interested");
check("a reply followed by interest is a win", (await memoryFor(USER, ROLE)).win.length === 1);
check("...and the reply is marked, so it is not judged twice",
  (await db.select().from(autoReplyLogTable).where(eq(autoReplyLogTable.userId, USER)))[0]?.outcome === "win");

await learnFromOutcome(USER, P, "not_interested");
check("a judged reply is not re-judged by the next message",
  (await memoryFor(USER, ROLE)).loss.length === 0, "الحكم مرة واحدة");

await clean();
await logReply("سعرنا يبدأ من ٥٠٠ درهم", ROLE);
await learnFromOutcome(USER, P, "not_interested");
check("a reply followed by a refusal is a loss", (await memoryFor(USER, ROLE)).loss.length === 1);

await clean();
await logReply("أهلاً بك", ROLE);
await learnFromOutcome(USER, P, "question");
check("a question says nothing either way — nothing recorded",
  (await memoryFor(USER, ROLE)).win.length === 0 && (await memoryFor(USER, ROLE)).loss.length === 0);

await clean();
await logReply("رد قديم جداً", ROLE, 60 * 48);
await learnFromOutcome(USER, P, "interested");
check("a two-day-old reply is not what they are reacting to",
  (await memoryFor(USER, ROLE)).win.length === 0);

await clean();
await logReply("رد بلا موظف معروف", null);
await learnFromOutcome(USER, P, "interested");
check("a reply with no recorded employee teaches nobody",
  (await memoryFor(USER, ROLE)).win.length === 0);

// ── Tasks ────────────────────────────────────────────────────────
await clean();
await db.insert(agentTasksTable).values([
  { userId: USER, role: ROLE, task: "اجمع اسم الشركة ونشاطها", sortOrder: 1 },
  { userId: USER, role: ROLE, task: "اعرض موعد مكالمة", sortOrder: 2 },
  { userId: USER, role: ROLE, task: "مهمة موقوفة", sortOrder: 3, isActive: false },
]);
const tasks = await tasksFor(USER, ROLE);
check("duties come back in the owner's order", tasks[0]?.includes("اجمع") === true && tasks.length === 2);
check("a stopped duty is left out", !tasks.some((t) => t.includes("موقوفة")));

// ── Skills ───────────────────────────────────────────────────────
const [always] = await db.insert(agentSkillsTable).values({
  userId: USER, name: "التعامل مع اعتراض السعر",
  instruction: "اسأل عن الميزانية قبل أن تدافع عن السعر.", intents: [],
} as any).returning();
const [onlyComplaint] = await db.insert(agentSkillsTable).values({
  userId: USER, name: "تهدئة غاضب",
  instruction: "اعترف بالخطأ أولاً.", intents: ["complaint"],
} as any).returning();
const [ungranted] = await db.insert(agentSkillsTable).values({
  userId: USER, name: "مهارة لم تُمنح", instruction: "لا يجب أن تظهر.", intents: [],
} as any).returning();
await db.insert(agentSkillGrantsTable).values([
  { userId: USER, role: ROLE, skillId: always!.id },
  { userId: USER, role: ROLE, skillId: onlyComplaint!.id },
]);

const onQuestion = await skillsFor(USER, ROLE, "question");
check("a skill with no intents is always carried", onQuestion.some((s) => s.id === always!.id));
check("an intent-scoped skill stays out of other intents", !onQuestion.some((s) => s.id === onlyComplaint!.id));
check("a skill nobody was granted is never carried", !onQuestion.some((s) => s.id === ungranted!.id));

const onComplaint = await skillsFor(USER, ROLE, "complaint");
check("...and appears on its own intent", onComplaint.some((s) => s.id === onlyComplaint!.id));
check("another employee holds none of them", (await skillsFor(USER, "support", "question")).length === 0);
check("the prompt text names the skill", /التعامل مع اعتراض السعر/.test(skillsPreamble(onQuestion)));
check("no skills means no heading at all", skillsPreamble([]) === "");

// ── The assembled preamble ───────────────────────────────────────
await remember(USER, ROLE, "instruction", "لا تَعِد بموعد تسليم");
await remember(USER, ROLE, "gap", "هل تتعاملون مع شركات خارج الإمارات؟");
const pre = await memoryPreamble(USER, ROLE);
check("duties reach the prompt", /مهامك/.test(pre));
check("standing orders are stated as binding", /التزم بها حرفياً/.test(pre));
check("an unanswered question tells it to admit it", /ولا تخترع/.test(pre) && /خارج الإمارات/.test(pre));
check("an employee with nothing remembered gets no preamble",
  (await memoryPreamble(USER, "nobody")).trim() === "");

// ── Routine triggers ─────────────────────────────────────────────
const H = 3_600_000;
check("an interval routine never run is due",
  isDue({ triggerKind: "interval", everyMinutes: 60, atHour: null, lastRunAt: null, isActive: true }));
check("...and not again straight away",
  !isDue({ triggerKind: "interval", everyMinutes: 60, atHour: null, lastRunAt: new Date(Date.now() - 10 * 60_000), isActive: true }));
check("...but is once the interval passes",
  isDue({ triggerKind: "interval", everyMinutes: 60, atHour: null, lastRunAt: new Date(Date.now() - 61 * 60_000), isActive: true }));
check("a stopped routine is never due",
  !isDue({ triggerKind: "interval", everyMinutes: 5, atHour: null, lastRunAt: null, isActive: false }));

// Gulf time is UTC+4, and "daily at hour" means that hour there.
const gulfNow = (new Date().getUTCHours() + 4) % 24;
check("a daily routine fires in its own hour",
  isDue({ triggerKind: "daily", everyMinutes: null, atHour: gulfNow, lastRunAt: null, isActive: true }));
check("...and not in another hour",
  !isDue({ triggerKind: "daily", everyMinutes: null, atHour: (gulfNow + 5) % 24, lastRunAt: null, isActive: true }));
check("...and only once inside that hour",
  !isDue({ triggerKind: "daily", everyMinutes: null, atHour: gulfNow, lastRunAt: new Date(Date.now() - 2 * H), isActive: true }));
check("...but again the next day",
  isDue({ triggerKind: "daily", everyMinutes: null, atHour: gulfNow, lastRunAt: new Date(Date.now() - 25 * H), isActive: true }));
check("a daily routine with no hour set never fires",
  !isDue({ triggerKind: "daily", everyMinutes: null, atHour: null, lastRunAt: null, isActive: true }));

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
