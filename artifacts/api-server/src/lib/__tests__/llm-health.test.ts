import { score, rank, recordOk, recordFail, healthReport } from "../llm-health";
import { db, llmHealthTable } from "@workspace/db";
import { sql } from "drizzle-orm";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

// This table is not per account, so the suite owns a private namespace in it.
const P = (n: string) => `__test_${n}`;
const clean = () => db.execute(sql`DELETE FROM llm_health WHERE provider LIKE '__test_%'`);
await clean();

// ── Scoring ──────────────────────────────────────────────────────
check("an untried model sits between proven-good and proven-bad",
  score({ ok: 0, fail: 0, avgMs: 0 }) === 0.7);
check("reliability beats speed",
  score({ ok: 90, fail: 10, avgMs: 3000 }) > score({ ok: 60, fail: 40, avgMs: 200 }),
  "90% بطيء > 60% سريع");
check("speed separates two reliable models",
  score({ ok: 50, fail: 0, avgMs: 500 }) > score({ ok: 50, fail: 0, avgMs: 5000 }));
check("one success out of one is not a perfect model",
  score({ ok: 1, fail: 0, avgMs: 0 }) < 0.95, `${score({ ok: 1, fail: 0, avgMs: 0 })}`);
check("a model that always fails scores worst",
  score({ ok: 0, fail: 30, avgMs: 0 }) < score({ ok: 1, fail: 30, avgMs: 0 }));
check("latency cannot sink a model on its own",
  score({ ok: 100, fail: 0, avgMs: 999_999 }) > score({ ok: 0, fail: 100, avgMs: 0 }),
  "الحد 0.3");

// ── Recording ────────────────────────────────────────────────────
await clean();
await recordOk(P("a"), "m1", 800);
let [row] = await db.select().from(llmHealthTable).where(sql`provider = ${P("a")}`);
check("a success is counted", row?.ok === 1 && row?.avgMs === 800);

await recordOk(P("a"), "m1", 1600);
[row] = await db.select().from(llmHealthTable).where(sql`provider = ${P("a")}`);
check("latency is a moving average, not the latest", row?.avgMs === 1000, `${row?.avgMs}ms`);

await recordFail(P("a"), "m1", "503 busy");
[row] = await db.select().from(llmHealthTable).where(sql`provider = ${P("a")}`);
check("a failure is counted without wiping the successes", row?.fail === 1 && row?.ok === 2);
check("the first failure does not trigger a cooldown", row?.cooldownUntil === null, "تسامح مع العارض");
check("the error is kept, for the settings page", row?.lastError === "503 busy");

await recordFail(P("a"), "m1", "503 again");
[row] = await db.select().from(llmHealthTable).where(sql`provider = ${P("a")}`);
check("a second consecutive failure starts a cooldown", !!row?.cooldownUntil);
check("...and it is short at first",
  new Date(row!.cooldownUntil!).getTime() - Date.now() < 2 * 60_000, "دقيقة");

const firstCool = new Date(row!.cooldownUntil!).getTime();
await recordFail(P("a"), "m1", "x");
await recordFail(P("a"), "m1", "x");
[row] = await db.select().from(llmHealthTable).where(sql`provider = ${P("a")}`);
check("the cooldown grows with each further failure",
  new Date(row!.cooldownUntil!).getTime() > firstCool + 5 * 60_000, "تصاعدي");
check("...and the streak is tracked", row?.streakFails === 4);

await recordOk(P("a"), "m1", 900);
[row] = await db.select().from(llmHealthTable).where(sql`provider = ${P("a")}`);
check("one success clears the cooldown and the streak",
  row?.cooldownUntil === null && row?.streakFails === 0);

// ── Ranking ──────────────────────────────────────────────────────
await clean();
const C = (n: string, m = "m") => ({ provider: P(n), model: m, apiKey: "k" });

check("a single candidate is returned untouched",
  (await rank([C("solo")])).length === 1);

// Measured: one answers, one does not.
for (let i = 0; i < 10; i++) await recordOk(P("good"), "m", 900);
for (let i = 0; i < 10; i++) await recordFail(P("bad"), "m", "503");
let order = await rank([C("bad"), C("good")]);
check("the model that answers is tried first", order[0]?.provider === P("good"),
  `أولاً ${order[0]?.provider.replace("__test_", "")}`);

// The owner's own pick leads, even when it scores worse — it is a setting, not
// a suggestion.
order = await rank([C("good"), C("mine")], { provider: P("mine"), model: "m" });
check("the account's own choice is tried first", order[0]?.provider === P("mine"));

// ...but a pick in cooldown is an outage, not a preference.
await clean();
for (let i = 0; i < 4; i++) await recordFail(P("mine"), "m", "down");
for (let i = 0; i < 3; i++) await recordOk(P("other"), "m", 700);
order = await rank([C("mine"), C("other")], { provider: P("mine"), model: "m" });
check("a choice in cooldown yields to one that works", order[0]?.provider === P("other"));
check("...but is still kept as a last resort", order.some((c) => c.provider === P("mine")),
  "لا يُحذف");

// Everything cooling still has to produce an order: somebody must be asked.
await clean();
for (let i = 0; i < 4; i++) { await recordFail(P("x"), "m", "d"); await recordFail(P("y"), "m", "d"); }
order = await rank([C("x"), C("y")]);
check("when every candidate is cooling, none are dropped", order.length === 2);

// Two models on one provider are ranked separately — the whole reason the key
// is (provider, model) and not provider alone.
await clean();
for (let i = 0; i < 6; i++) await recordOk(P("multi"), "fast", 400);
for (let i = 0; i < 6; i++) await recordFail(P("multi"), "broken", "429");
order = await rank([{ provider: P("multi"), model: "broken", apiKey: "k" },
                    { provider: P("multi"), model: "fast", apiKey: "k" }]);
check("models on the same provider are ranked apart", order[0]?.model === "fast");

const report = await healthReport();
check("the report marks what is resting",
  report.some((r) => r.provider === P("multi") && r.model === "broken" && r.resting));
check("...and is sorted best first",
  report.findIndex((r) => r.model === "fast") < report.findIndex((r) => r.model === "broken"));

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
