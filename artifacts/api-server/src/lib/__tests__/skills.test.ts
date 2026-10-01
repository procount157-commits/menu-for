import { LIBRARY, GRANTS, seedSkills, resetSkill } from "../skills";
import { skillsFor, skillsPreamble } from "../agent-skills";
import { db, agentSkillsTable, agentSkillGrantsTable, botEmployeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

async function clean() {
  await db.delete(agentSkillGrantsTable).where(eq(agentSkillGrantsTable.userId, USER));
  await db.delete(agentSkillsTable).where(eq(agentSkillsTable.userId, USER));
  await db.delete(botEmployeesTable).where(eq(botEmployeesTable.userId, USER));
}
await clean();

// ── The library itself ───────────────────────────────────────────
check("every skill has a name and an instruction",
  LIBRARY.every((s) => s.name.length > 2 && s.instruction.length > 200));
check("names are unique", new Set(LIBRARY.map((s) => s.name)).size === LIBRARY.length);

// The ceiling is not tidiness: Groq's free tier allows 8,000 tokens a minute,
// and every 300 characters of skill costs about one reply a minute. What the
// limit applies to is what loads for one message, tested at the bottom of this
// file — the library total is irrelevant, since at most five of these are ever
// carried at once, and capping it would only stop skills being added.
const biggest = LIBRARY.reduce((a, b) => (a.instruction.length > b.instruction.length ? a : b));
check("no single skill exceeds 1,450 characters", biggest.instruction.length <= 1_450,
  `${biggest.name} ${biggest.instruction.length}`);

// A procedure a weak model can follow has literal wording in it, not adjectives.
const teaching = LIBRARY.filter((s) => /الاعتراضات|اللهجة|قراءة نية|احتواء|كتابة المتابعة|خريطة|فهم طلب/.test(s.name));
check("the customer-facing skills quote literal wording",
  teaching.every((s) => (s.instruction.match(/«/g) ?? []).length >= 3),
  "أمثلة منقولة");
check("...and say what is forbidden, not only what is wanted",
  teaching.every((s) => /ممنوع|لا ت|خطأ/.test(s.instruction)));

// ── Seeding ──────────────────────────────────────────────────────
await db.insert(botEmployeesTable).values([
  { userId: USER, name: "هال", role: "sales",   kind: "customer", isActive: true, priority: 100 },
  { userId: USER, name: "سام", role: "support", kind: "customer", isActive: true, priority: 10 },
] as any);

let r = await seedSkills(USER);
check("a first seed installs the whole library", r.created === LIBRARY.length);
check("...and grants them to the roster", r.granted === (GRANTS["sales"]!.length + GRANTS["support"]!.length));

r = await seedSkills(USER);
check("seeding twice changes nothing", r.created === 0 && r.updated === 0 && r.granted === 0);
check("...and reports them as untouched", r.untouched === LIBRARY.length);

// An instruction the owner rewrote is theirs, and a deploy must not undo it.
const [mine] = await db.select().from(agentSkillsTable)
  .where(and(eq(agentSkillsTable.userId, USER), eq(agentSkillsTable.name, "الاعتراضات والطلبات الخاصة")));
await db.update(agentSkillsTable).set({ instruction: "نصّي أنا.", updatedAt: new Date(Date.now() + 5_000) })
  .where(eq(agentSkillsTable.id, mine!.id));
await seedSkills(USER);
const [after] = await db.select().from(agentSkillsTable).where(eq(agentSkillsTable.id, mine!.id));
check("a skill the owner rewrote survives re-seeding", after?.instruction === "نصّي أنا.");

check("...and can be put back deliberately", await resetSkill(USER, "الاعتراضات والطلبات الخاصة"));
const [reset] = await db.select().from(agentSkillsTable).where(eq(agentSkillsTable.id, mine!.id));
check("...restoring the library text", reset?.instruction.includes("لا تخفّض") === true);
check("resetting an unknown skill is refused", (await resetSkill(USER, "لا توجد")) === false);

// ── Who carries what ─────────────────────────────────────────────
const salesQ = await skillsFor(USER, "sales", "question");
const salesI = await skillsFor(USER, "sales", "interested");
const support = await skillsFor(USER, "support", "complaint");
const names = (xs: any[]) => xs.map((x) => x.name).sort();

check("everyone customer-facing carries the dialect",
  [salesQ, salesI, support].every((x) => names(x).includes("اللهجة الخليجية")));
check("...and how to read a Gulf customer",
  [salesQ, salesI, support].every((x) => names(x).includes("قراءة نية العميل")));

check("objections load only once they are engaged",
  names(salesI).includes("الاعتراضات والطلبات الخاصة") && !names(salesQ).includes("الاعتراضات والطلبات الخاصة"));
check("the conversation map is always carried by sales",
  names(salesI).includes("خريطة المحادثة") && names(salesQ).includes("خريطة المحادثة"));
check("understanding the request loads before the order, not after",
  names(salesQ).includes("فهم طلب الزبون") && !names(salesI).includes("فهم طلب الزبون"));
check("support never carries the objections table", !names(support).includes("الاعتراضات والطلبات الخاصة"),
  "لا عروض أثناء شكوى");
check("...and does carry de-escalation", names(support).includes("احتواء الشكوى"));

// The real constraint: what actually reaches the model in one call. Raised
// from 3,000 when the conversation map and the objection table were added:
// the extra ~800 characters are the difference between an agent that pitches
// to someone who already agreed and one that knows where it is in the sale,
// and that is worth a slower reply on the free tier.
const worst = Math.max(...await Promise.all(
  (["greeting", "question", "unclear", "interested", "complaint"] as const)
    .map(async (i) => skillsPreamble(await skillsFor(USER, "sales", i)).length)));
check("no single message loads more than 3,800 characters of skill", worst <= 3_800, `${worst}`);

// The manager's pipeline theory is for meetings and reviews, not for "كم السعر؟".
await db.insert(botEmployeesTable).values([
  { userId: USER, name: "شمّة", role: "chief", kind: "manager", isActive: true, priority: 1 },
] as any);
await seedSkills(USER);
const chiefCustomer = names(await skillsFor(USER, "chief", "interested"));
const chiefInternal = names(await skillsFor(USER, "chief", "internal"));
check("the manager's internal skills never load for a customer",
  !chiefCustomer.includes("إدارة المبيعات") && !chiefCustomer.includes("تدريب الفريق"));
check("...and do load for a meeting or a review",
  chiefInternal.includes("إدارة المبيعات") && chiefInternal.includes("تدريب الفريق") && chiefInternal.includes("التحليل"));
check("...which carries nothing customer-facing", !chiefInternal.includes("الاعتراضات والطلبات الخاصة"));

check("an employee with no grants carries nothing",
  (await skillsFor(USER, "monitor", "question")).length === 0);

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
