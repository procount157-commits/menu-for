import { route, personaPreamble, agentJob } from "../agent-router";
import { db, botEmployeesTable, conversationOwnerTable, agentHandoffsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const USER = 1;
const P = "971500000001";
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

async function clean() {
  await db.delete(agentHandoffsTable).where(eq(agentHandoffsTable.userId, USER));
  await db.delete(conversationOwnerTable).where(eq(conversationOwnerTable.userId, USER));
  await db.delete(botEmployeesTable).where(eq(botEmployeesTable.userId, USER));
}
async function hire(rows: Array<Partial<typeof botEmployeesTable.$inferInsert>>) {
  await db.insert(botEmployeesTable).values(rows.map((r) => ({
    userId: USER, kind: "customer", isActive: true, ...r,
  })) as any);
}

// ── No team at all: the caller keeps its single-persona path ──────
await clean();
check("no employees → null, caller falls back", (await route(USER, P, "question")) === null);

// ── One generalist ───────────────────────────────────────────────
await clean();
await hire([{ name: "هال", role: "sales", title: "مبيعات", specialties: [], priority: 100 }]);
check("lone generalist takes a question", (await route(USER, P, "question"))?.agent.role === "sales");
check("...and is recorded as the owner",
  (await db.select().from(conversationOwnerTable)
    .where(and(eq(conversationOwnerTable.userId, USER), eq(conversationOwnerTable.phone, P))))[0]?.role === "sales");
check("lone generalist takes a complaint too — nobody else can",
  (await route(USER, P, "complaint"))?.agent.role === "sales");

// ── Generalist + specialist ──────────────────────────────────────
await clean();
await hire([
  { name: "هال", role: "sales",   title: "مبيعات", specialties: ["interested", "question", "greeting", "unclear"], priority: 100, handoffTo: "support" },
  { name: "سام", role: "support", title: "خدمة العملاء", specialties: ["complaint"], priority: 10 },
]);

const q1 = await route(USER, P, "question");
check("question opens with the salesperson", q1?.agent.role === "sales");
check("...and is not announced as a handoff", q1?.handoff === undefined);

const q2 = await route(USER, P, "interested");
check("same agent keeps the thread on his own intents", q2?.agent.role === "sales");
check("...with no handoff noise", q2?.handoff === undefined);

const c1 = await route(USER, P, "complaint");
check("a complaint moves to the specialist", c1?.agent.role === "support");
check("...and the handoff names who had it", c1?.handoff?.from === "هال");
check("...and says why", /شكوى/.test(c1?.handoff?.reason ?? ""));
check("...and is written down",
  (await db.select().from(agentHandoffsTable).where(eq(agentHandoffsTable.userId, USER)))
    .some((h) => h.fromRole === "sales" && h.toRole === "support"));

const c2 = await route(USER, P, "complaint");
check("the specialist is not handed the same thread twice", c2?.handoff === undefined, "الالتصاق");

// An intent nobody claimed must not pull the thread back: whoever holds it,
// keeps it. "not_interested" is claimed by neither agent in this fixture.
const c3 = await route(USER, P, "not_interested");
check("an intent nobody claims leaves the thread where it is", c3?.agent.role === "support");
check("...and that is not a handoff either", c3?.handoff === undefined);

// ...but an intent the other agent claims does move it back. That is what
// specialties are for, and it is how a resolved complaint returns to sales.
const c4 = await route(USER, P, "interested");
check("an intent the other agent owns moves it back", c4?.agent.role === "sales");
check("...announced as coming from سام", c4?.handoff?.from === "سام");

// ── Priority decides when two agents claim the same intent ───────
await clean();
await hire([
  { name: "الأول",  role: "sales",   specialties: ["question"], priority: 50 },
  { name: "الثاني", role: "support", specialties: ["question"], priority: 5 },
]);
check("lower priority number wins a contested intent",
  (await route(USER, P, "question"))?.agent.name === "الثاني");

// ── Internal staff never answer customers ───────────────────────
await clean();
await hire([{ name: "مارك", role: "monitor", kind: "internal", specialties: [] }]);
check("an internal-only roster routes nobody", (await route(USER, P, "question")) === null);

// ── An agent who leaves the roster ──────────────────────────────
await clean();
await hire([
  { name: "هال", role: "sales", specialties: [], priority: 100 },
  { name: "سام", role: "support", specialties: ["complaint"], priority: 10 },
]);
await route(USER, P, "complaint");                    // سام owns it
await db.update(botEmployeesTable).set({ isActive: false })
  .where(and(eq(botEmployeesTable.userId, USER), eq(botEmployeesTable.role, "support")));
const orphan = await route(USER, P, "question");
check("a thread owned by a departed agent is reassigned", orphan?.agent.role === "sales");

// ── The text handed to the model ────────────────────────────────
await clean();
await hire([
  { name: "هال", role: "sales", title: "موظف المبيعات", persona: "ودود وواثق", specialties: [], priority: 100 },
  { name: "سام", role: "support", title: "خدمة العملاء", persona: "هادئ ومتعاطف", specialties: ["complaint"], priority: 10 },
]);
const plain = await route(USER, P, "question");
const pre = personaPreamble(plain!);
check("preamble states the name", /اسمك هال/.test(pre));
check("preamble carries the personality", /ودود وواثق/.test(pre));
check("no handoff line when nothing changed hands", !/تسلّمت/.test(pre));

const moved = await route(USER, P, "complaint");
const pre2 = personaPreamble(moved!);
check("a handoff tells the agent to introduce itself", /تسلّمت هذه المحادثة/.test(pre2) && /هال/.test(pre2));
check("support gets its own brief, not the sales one",
  (agentJob(moved!) ?? []).some((l) => /لا تحاول البيع/.test(l)));
check("the sales brief is the default (undefined → SALES_JOB)", agentJob(plain!) === undefined);

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
