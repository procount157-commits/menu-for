import { effectiveLimits } from "../plans";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };
const NOW = new Date("2026-09-29T00:00:00Z");
const past = new Date("2026-09-01T00:00:00Z"), future = new Date("2026-12-01T00:00:00Z");

check("free has the free limits", effectiveLimits("free", null, false, NOW).contacts === 200);
check("pro has its own contact ceiling", effectiveLimits("pro", future, false, NOW).contacts === 5000);
check("business is unlimited", effectiveLimits("business", future, false, NOW).contacts === -1 && effectiveLimits("business", future, false, NOW).campaigns === -1);
check("an admin is unlimited whatever the plan", effectiveLimits("free", null, true, NOW).campaigns === -1);
const lapsed = effectiveLimits("pro", past, false, NOW);
check("a lapsed pro plan is expired", lapsed.expired);
check("...and falls back to the free limits, not to zero", lapsed.contacts === 200);
check("a paid plan with no expiry does not lapse", !effectiveLimits("basic", null, false, NOW).expired);
check("free never 'expires'", !effectiveLimits("free", past, false, NOW).expired);
check("an unknown plan name reads as free", effectiveLimits("gold", null, false, NOW).contacts === 200);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
