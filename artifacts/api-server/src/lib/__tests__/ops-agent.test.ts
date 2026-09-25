import { decide, type OpsSignals } from "../ops-agent";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

const base: OpsSignals = {
  connected: true, status: "connected", silentMin: 2, reconnects6h: 1,
  deliveryLevel: "healthy", deliveryRate: 0.95, accountLevel: "healthy",
  sentToday: 100, dailyLimit: 1000, failureRate: 0.02, activeCampaigns: 1,
};
const at = (o: Partial<OpsSignals>) => decide({ ...base, ...o });
const kinds = (d: ReturnType<typeof decide>) => d.actions.map((a) => a.kind).sort();
const val = (d: ReturnType<typeof decide>, k: string) => d.actions.find((a) => a.kind === k)?.value;

// ── A quiet account is left alone ────────────────────────────────
let d = at({});
check("a healthy account gets no actions", d.actions.length === 0 && d.level === "ok");
check("...and still says something", d.findings.length === 1 && /طبيعي/.test(d.findings[0]!));

// ── Connection ───────────────────────────────────────────────────
d = at({ connected: false, status: "disconnected" });
check("a disconnected session is critical", d.level === "critical");
check("...and asks for a reconnect", kinds(d).includes("reconnect"));
check("...and holds sending, so attempts are not burnt on a dead socket",
  kinds(d).includes("hold"));

d = at({ silentMin: 90 });
check("connected but silent for 90m is a warning", d.level === "warning");
check("...and triggers a reconnect", kinds(d).includes("reconnect"));
check("a short silence is not", at({ silentMin: 10 }).actions.length === 0);

d = at({ reconnects6h: 9 });
check("reconnect churn is itself a risk", d.level === "warning" && kinds(d).includes("throttle"));
check("a couple of reconnects are normal", at({ reconnects6h: 3 }).actions.length === 0);

// ── Delivery ─────────────────────────────────────────────────────
d = at({ deliveryLevel: "degraded" });
check("degraded delivery slows sending", val(d, "throttle") === 1.8 && d.level === "warning");

d = at({ deliveryLevel: "high_risk" });
check("high risk is critical", d.level === "critical");
check("...throttles harder", val(d, "throttle") === 3);
check("...and cuts the daily ceiling", val(d, "ceiling") === 400, `${val(d, "ceiling")}`);

d = at({ deliveryLevel: "high_risk", dailyLimit: 60 });
check("the ceiling never drops below a usable floor", val(d, "ceiling") === 50);

d = at({ deliveryLevel: "critical" });
check("critical delivery stops sending entirely", kinds(d).includes("hold"));
check("...and drops the ceiling, which a hold makes redundant",
  !kinds(d).includes("ceiling"), "بلا ضجيج");

d = at({ accountLevel: "high_risk" });
check("account health is read as well as per-campaign delivery",
  d.level === "critical" && kinds(d).includes("throttle"));

// ── Failures ─────────────────────────────────────────────────────
check("a 20% failure rate throttles", val(at({ failureRate: 0.2 }), "throttle") === 2);
check("a 40% failure rate holds", kinds(at({ failureRate: 0.4 })).includes("hold"));
check("a 5% failure rate is ordinary", at({ failureRate: 0.05 }).actions.length === 0);

// ── Quota ────────────────────────────────────────────────────────
d = at({ sentToday: 950, dailyLimit: 1000 });
check("nearly-spent quota is reported", d.findings.some((f) => /حصة اليوم/.test(f)));
check("...but needs no action — the limit already stops it", d.actions.length === 0);

// ── Combining ────────────────────────────────────────────────────
d = at({ deliveryLevel: "degraded", failureRate: 0.2, reconnects6h: 9 });
check("three findings produce one throttle, not three",
  d.actions.filter((a) => a.kind === "throttle").length === 1);
check("...and it is the strongest of them", val(d, "throttle") === 2, `${val(d, "throttle")}×`);
check("...while every finding is still reported", d.findings.length === 3);

d = at({ connected: false, deliveryLevel: "critical", failureRate: 0.5 });
check("the worst case holds once", d.actions.filter((a) => a.kind === "hold").length === 1);
check("...for the longest of the reasons", val(d, "hold") === 120, `${val(d, "hold")} دقيقة`);
check("...and is critical", d.level === "critical");

// Every action must be able to explain itself — it goes in front of an owner.
check("every action carries a reason",
  at({ connected: false, deliveryLevel: "high_risk" }).actions.every((a) => a.why.length > 3));

// Nothing here may ever speed the account up. That is the whole policy.
const all = [at({}), at({ connected: false }), at({ deliveryLevel: "critical" }),
             at({ failureRate: 0.9 }), at({ reconnects6h: 20 }), at({ deliveryLevel: "degraded" })];
check("no decision can ever make the account send faster",
  all.every((x) => x.actions.every((a) => a.kind !== "throttle" || (a.value ?? 1) >= 1)));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
