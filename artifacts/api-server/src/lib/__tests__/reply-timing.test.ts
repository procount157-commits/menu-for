import { thinkTime, pick } from "../reply-timing";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };
const mid = () => 0.5;   // deterministic middle of every range

// ── The three paces ──────────────────────────────────────────────
const active = thinkTime({ minutesSinceTheirLast: 1, incomingLength: 30, rand: mid });
const warm   = thinkTime({ minutesSinceTheirLast: 20, incomingLength: 30, rand: mid });
const cold   = thinkTime({ minutesSinceTheirLast: 300, incomingLength: 30, rand: mid });

check("a live exchange gets a short pause", active.pace === "active" && active.ms < 15_000, `${Math.round(active.ms/1000)}ث`);
check("a normal gap gets a longer one", warm.ms > active.ms, `${Math.round(warm.ms/1000)}ث`);
check("a cold conversation takes longest", cold.ms > warm.ms, `${Math.round(cold.ms/1000)}ث`);
check("a first contact is treated as cold",
  thinkTime({ minutesSinceTheirLast: null, incomingLength: 30, rand: mid }).pace === "cold");

// The whole point: never instant.
const shortest = thinkTime({ minutesSinceTheirLast: 0, incomingLength: 1, rand: () => 0 });
check("even the fastest reply waits several seconds", shortest.ms >= 4_000, `${shortest.ms}ms`);

// And never so long the customer gives up.
const longest = thinkTime({ minutesSinceTheirLast: 9_999, incomingLength: 5_000, outsideHours: true, rand: () => 1 });
check("and never longer than two and a half minutes", longest.ms <= 150_000, `${Math.round(longest.ms/1000)}ث`);

// ── Reading time ─────────────────────────────────────────────────
const brief = thinkTime({ minutesSinceTheirLast: 1, incomingLength: 20, rand: mid });
const essay = thinkTime({ minutesSinceTheirLast: 1, incomingLength: 600, rand: mid });
check("a long message takes longer to read before answering", essay.ms > brief.ms,
  `${Math.round(brief.ms/1000)}ث → ${Math.round(essay.ms/1000)}ث`);
check("a short one adds no reading time",
  thinkTime({ minutesSinceTheirLast: 1, incomingLength: 100, rand: mid }).ms === brief.ms);

// ── Night ────────────────────────────────────────────────────────
const day   = thinkTime({ minutesSinceTheirLast: 20, incomingLength: 30, rand: mid });
const night = thinkTime({ minutesSinceTheirLast: 20, incomingLength: 30, outsideHours: true, rand: mid });
check("replies are slower at night, not absent", night.ms > day.ms && night.ms < 150_000,
  `${Math.round(day.ms/1000)}ث → ${Math.round(night.ms/1000)}ث`);

// ── It has to vary ───────────────────────────────────────────────
// A constant delay is as much a signature as no delay.
const draws = new Set(Array.from({ length: 40 }, () => pick("warm")));
check("two replies in a row do not wait the same time", draws.size > 30, `${draws.size}/40 مختلفة`);

const lo = pick("warm", () => 0), hi = pick("warm", () => 1);
check("the spread is wide enough to be noticeable", hi - lo >= 20_000,
  `${Math.round(lo/1000)}–${Math.round(hi/1000)}ث`);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
