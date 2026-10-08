// The graph's foundations: receipts that cannot be rewritten, the off
// switch that stops an employee's thinking wherever it is called from,
// contracts that hold (no node reviews itself, no side effect without an
// authority), and a goal's pace measured against numbers no employee writes.

export {};
const { receipt, graphOf, tokensOf, firstBroken } = await import("../graph/receipts");
const { offDuty, setTeamPaused } = await import("../graph/switch");
const { GRAPHS, contractProblems, WHATSAPP_GRAPH, PLATFORM_GRAPH } = await import("../graph/contracts");
const { pace, MEASURES, FAMILY, mayUse, familyOf, setGoal } = await import("../graph/goals");
const { backfillReceipts } = await import("../graph/backfill");
const { complete } = await import("../llm");
const { asAgent } = await import("../agent-context");
const { db } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${d}`); };
const U = 1;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as any).n);

// ── Receipts ─────────────────────────────────────────────────────
const before = await count(sql`SELECT count(*)::int AS n FROM receipts WHERE user_id = ${U}`);
receipt({ userId: U, node: "sales", action: "reply", subject: "971500000009", why: "اختبار" });
receipt({ userId: U, node: "email_guard", action: "email.clean", why: "اختبار" });
await wait(400);
const after = await count(sql`SELECT count(*)::int AS n FROM receipts WHERE user_id = ${U}`);
check("a receipt is written for each act", after - before === 2, `${after - before}`);
check("the ledger is intact", (await firstBroken(U)) === null);
const edit = await db.execute(sql`UPDATE receipts SET why = 'تلاعب' WHERE user_id = ${U}`).then(() => "changed", (e) => String(e?.cause?.message ?? e?.message ?? e));
check("a receipt cannot be changed", /append-only/.test(edit), edit.slice(0, 60));
const del = await db.execute(sql`DELETE FROM receipts WHERE user_id = ${U}`).then(() => "deleted", (e) => String(e?.cause?.message ?? e?.message ?? e));
check("...or deleted", /append-only/.test(del));
check("each node lands in its graph", graphOf("sales") === "whatsapp" && graphOf("email_guard") === "email" && graphOf("shop_sales") === "platform" && graphOf("ops") === "ops" && graphOf("chief") === "manager");
check("tokens are estimated from characters when not given", tokensOf(400) === 100);

// ── The off switch ───────────────────────────────────────────────
await setTeamPaused(U, true);
check("with the team paused, every employee is off duty", (await offDuty(U, "sales")) === "الفريق كله موقوف");
const blocked = sql`SELECT count(*)::int AS n FROM receipts WHERE user_id = ${U} AND action = 'llm.call' AND status = 'blocked'`;
const n0 = await count(blocked);
const out = await asAgent(U, "sales", () => complete([{ role: "user", content: "مرحبا" }], 5_000));
await wait(300);
check("a paused employee's model call does not happen", out === null);
check("...and leaves a «blocked» receipt saying why", (await count(blocked)) - n0 === 1);
await setTeamPaused(U, false);
check("back on, they may work", (await offDuty(U, "sales")) === null);

// ── Contracts ────────────────────────────────────────────────────
for (const g of GRAPHS) check(`the ${g.id} graph's contracts hold`, contractProblems(g).length === 0, contractProblems(g).join(" · "));
const selfReview = { ...WHATSAPP_GRAPH, nodes: WHATSAPP_GRAPH.nodes.map((n) => n.id === "reviewer" ? { ...n, reviews: ["reviewer"] } : n) };
check("a node that reviews itself is refused", contractProblems(selfReview).some((p) => p.includes("يراجع نفسه")));
const agentSends = { ...WHATSAPP_GRAPH, nodes: WHATSAPP_GRAPH.nodes.map((n) => n.id === "sales" ? { ...n, sideEffect: "idempotent" as const, authorisedBy: "code" as const } : n) };
check("an employee that would send on its own judgement is refused", contractProblems(agentSends).some((p) => p.includes("sales")));
const sellerSends = { ...PLATFORM_GRAPH, nodes: PLATFORM_GRAPH.nodes.map((n) => n.id === "shop_sales" ? { ...n, sideEffect: "idempotent" as const, authorisedBy: "code" as const } : n) };
check("...the platform's seller included", contractProblems(sellerSends).some((p) => p.includes("shop_sales")));
check("every graph is explained in one breath", GRAPHS.every((g) => g.oneBreath.length > 20 && g.oneBreath.length < 220));

// ── Goals ────────────────────────────────────────────────────────
const start = new Date("2026-10-08"), end = new Date("2026-12-31");
const mid = new Date("2026-11-19");
check("just past halfway with eleven done is on track", pace(11, 20, start, end, mid).state === "on_track");
check("halfway with three done is behind", pace(3, 20, start, end, mid).state === "behind");
check("the weekly need is what is left over the time left", pace(3, 20, start, end, mid).perWeek > 2.5);
check("past the deadline short of target is missed", pace(12, 20, start, end, new Date("2027-01-02")).state === "missed");
check("reaching the target is done", pace(20, 20, start, end, mid).state === "done");
check("the anchors are named measures: a plan the admin set, an order staff completed", FAMILY.platform.anchor === "shops_paying" && FAMILY.shop.anchor === "orders_completed" && !!MEASURES["shops_paying"] && !!MEASURES["orders_completed"]);
check("the counters are named measures: stops and bounces, no-shows", ["stops", "sales_stops", "email_bounce_pct", "no_shows", "turns_left"].every((k) => !!MEASURES[k]));
check("every family names only measures that exist", Object.values(FAMILY).every((f) => [f.anchor, ...f.leading, ...f.counters].every((k) => !!MEASURES[k])));
check("platform numbers are the admin's alone", !mayUse("shops_paying", false) && mayUse("shops_paying", true) && mayUse("orders_completed", false));
check("a shared measure follows the account", familyOf("stops", true) === "platform" && familyOf("stops", false) === "shop");
const refused = await setGoal(U, { title: "x", metric: "no_such_measure", target: 5, deadline: end }).then(() => "set", (e) => String(e?.message ?? e));
check("an unknown measure is refused before anything is written", refused.includes("مقياس غير معروف"));
// Every measure's query runs against the real schema.
const w = { userId: U, from: new Date(Date.now() - 30 * 86_400_000), to: new Date() };
const failed: string[] = [];
for (const [k, m] of Object.entries(MEASURES)) { const v = await m.read(w).catch((e) => { failed.push(`${k}: ${String(e?.cause?.message ?? e?.message ?? e).slice(0, 80)}`); return NaN; }); if (!Number.isFinite(v)) failed.push(k); }
check("every measure reads the schema without error", failed.length === 0, failed.join(" · "));

// ── Phase 0 ──────────────────────────────────────────────────────
// An account with nothing in the old logs: the rebuild runs and writes nothing.
const rebuilt = await backfillReceipts(2_000_000_001).then((n) => n, (e) => `error: ${String(e?.cause?.message ?? e?.message ?? e).slice(0, 100)}`);
check("the fortnight's rebuild runs against the old logs", rebuilt === 0, String(rebuilt));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
