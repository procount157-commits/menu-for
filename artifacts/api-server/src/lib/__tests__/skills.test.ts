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

// The size ceiling is not tidiness: Groq's free tier allows 8,000 tokens a
// minute, and every 300 characters of skill costs about one reply a minute.
const biggest = LIBRARY.reduce((a, b) => (a.instruction.length > b.instruction.length ? a : b));
check("no single skill exceeds 1,100 characters", biggest.instruction.length <= 1_100,
  `${biggest.name} ${biggest.instruction.length}`);
check("the whole library stays under 7,000 characters",
  LIBRARY.reduce((a, s) => a + s.instruction.length, 0) <= 7_000);

// A procedure a weak model can follow has literal wording in it, not adjectives.
const teaching = LIBRARY.filter((s) => /التفاوض|اللهجة|قراءة نية|احتواء|كتابة المتابعة/.test(s.name));
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
  .where(and(eq(agentSkillsTable.userId, USER), eq(agentSkillsTable.name, "التفاوض")));
await db.update(agentSkillsTable).set({ instruction: "نصّي أنا.", updatedAt: new Date(Date.now() + 5_000) })
  .where(eq(agentSkillsTable.id, mine!.id));
await seedSkills(USER);
const [after] = await db.select().from(agentSkillsTable).where(eq(agentSkillsTable.id, mine!.id));
check("a skill the owner rewrote survives re-seeding", after?.instruction === "نصّي أنا.");

check("...and can be put back deliberately", await resetSkill(USER, "التفاوض"));
const [reset] = await db.select().from(agentSkillsTable).where(eq(agentSkillsTable.id, mine!.id));
check("...restoring the library text", reset?.instruction.includes("قايض") === true);
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

check("negotiation loads only once they are engaged",
  names(salesI).includes("التفاوض") && !names(salesQ).includes("التفاوض"));
check("discovery loads before the pitch, not after",
  names(salesQ).includes("تشخيص وضع العميل المحاسبي") && !names(salesI).includes("تشخيص وضع العميل المحاسبي"));
check("support never carries negotiation", !names(support).includes("التفاوض"),
  "لا تفاوض أثناء شكوى");
check("...and does carry de-escalation", names(support).includes("احتواء الشكوى"));

// The real constraint: what actually reaches the model in one call.
const worst = Math.max(...await Promise.all(
  (["greeting", "question", "unclear", "interested", "complaint"] as const)
    .map(async (i) => skillsPreamble(await skillsFor(USER, "sales", i)).length)));
check("no single message loads more than 3,000 characters of skill", worst <= 3_000, `${worst}`);

check("an employee with no grants carries nothing",
  (await skillsFor(USER, "monitor", "question")).length === 0);

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
