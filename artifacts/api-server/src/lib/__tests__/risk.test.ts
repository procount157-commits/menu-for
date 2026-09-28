import { scoreRisk, type RiskSignals } from "../risk";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

const healthy: RiskSignals = {
  deliveryRate: 0.93, deliverySample: 120, failureRate: 0.03,
  optOutRate: 0, optOuts24h: 0, sent24h: 300,
  probableBlocks: 0, blockSample: 40, replyRate: 0.04,
  reconnects6h: 1, numberAgeDays: 30, strangerShare: 0.6,
};
const at = (o: Partial<RiskSignals>) => scoreRisk({ ...healthy, ...o });

// ── A healthy number is left alone ───────────────────────────────
let r = at({});
check("a healthy number scores 0", r.score === 0 && r.level === "ok", `${r.score}`);
check("...and nothing slows it", r.throttle === 1 && r.ceilingFactor === 1 && r.holdMinutes === 0);
check("...and has nothing to explain", r.reasons.length === 0);

// ── Single signals on a curve, not a cliff ───────────────────────
check("delivery at 85% is a small cost", at({ deliveryRate: 0.85 }).score < 10, `${at({ deliveryRate: 0.85 }).score}`);
check("delivery at 75% is caution", at({ deliveryRate: 0.75 }).level === "caution");
check("delivery at 55% is warning on its own", at({ deliveryRate: 0.55 }).level === "warning");
check("delivery worse than 55% cannot add more than its cap",
  at({ deliveryRate: 0.1 }).score === at({ deliveryRate: 0.55 }).score);
check("a delivery sample under 25 is not evidence", at({ deliveryRate: 0.2, deliverySample: 10 }).score === 0);
check("no delivery sample at all is not evidence", at({ deliveryRate: null, deliverySample: 0 }).score === 0);

check("3% opt-outs is a real cost", at({ optOutRate: 0.03, optOuts24h: 9 }).score >= 15);
check("5% opt-outs hits the cap", at({ optOutRate: 0.05, optOuts24h: 15 }).score === 30);
check("opt-outs need 30 sent to count", at({ optOutRate: 0.1, optOuts24h: 1, sent24h: 10 }).score === 0);

check("blocks from known contacts count", at({ probableBlocks: 5, blockSample: 40 }).score > 0);
check("...but not on a tiny sample", at({ probableBlocks: 2, blockSample: 4 }).score === 0);

check("five reconnects are normal", at({ reconnects6h: 5 }).score === 0);
check("nine are not", at({ reconnects6h: 9 }).score > 0);

check("a young number carries a small standing risk", at({ numberAgeDays: 2 }).score > 0 && at({ numberAgeDays: 2 }).level === "ok");
check("writing only to strangers, at volume, costs", at({ strangerShare: 0.98, sent24h: 200 }).score > 0);
check("...but not at low volume", at({ strangerShare: 0.98, sent24h: 20 }).score === 0);

// ── They add up ──────────────────────────────────────────────────
r = at({ deliveryRate: 0.78, optOutRate: 0.02, optOuts24h: 6, probableBlocks: 3, blockSample: 40, numberAgeDays: 4 });
check("several small problems make one real one", r.level === "warning" || r.level === "high", `${r.score} ${r.level}`);
check("...each of which is named", r.reasons.length >= 4, `${r.reasons.length}`);

r = at({ deliveryRate: 0.45, optOutRate: 0.05, optOuts24h: 15, failureRate: 0.3 });
check("a collapsing number is critical", r.level === "critical", `${r.score}`);
check("...and is held", r.holdMinutes === 120);

// ── Engagement offsets ───────────────────────────────────────────
const quiet = at({ deliveryRate: 0.8, replyRate: 0 });
const chatty = at({ deliveryRate: 0.8, replyRate: 0.12 });
check("people writing back lowers the risk", chatty.score < quiet.score, `${quiet.score} → ${chatty.score}`);
check("...but never below zero", at({ replyRate: 0.5 }).score === 0);

// ── The response only ever slows down ────────────────────────────
const all = [at({}), at({ deliveryRate: 0.7 }), at({ deliveryRate: 0.5 }), at({ deliveryRate: 0.3, optOutRate: 0.05, optOuts24h: 15 })];
check("throttle never speeds up", all.every((x) => x.throttle >= 1));
check("ceiling never rises", all.every((x) => x.ceilingFactor <= 1));
check("the response is monotonic in the score",
  all.every((x, i) => i === 0 || (x.throttle >= all[i - 1]!.throttle && x.ceilingFactor <= all[i - 1]!.ceilingFactor)));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
