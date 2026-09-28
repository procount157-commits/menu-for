import { computeGap, estimateBreakMs, diurnalFactor, MIN_GAP_MS, MAX_GAP_MS } from "../pacing";

const H = 3_600_000;
let pass = 0, total = 0;

function check(name: string, cond: boolean, detail: string) {
  total++; if (cond) pass++;
  console.log(`${cond ? "✅" : "❌"} ${name.padEnd(52)} ${detail}`);
}

// The headline case: a full day's allowance across a full sending window.
const full = computeGap({ remainingContacts: 5000, dailyRemaining: 1500, dailyLimit: 1500, windowMsLeft: 12 * H });
const perMsg = (full.gapMs + full.breakMs / full.target) / 1000;
check("1500 in a 12h window -> target capped by allowance", full.target === 1500, `target=${full.target}`);
check("  gap lands in a sane band", full.gapMs > 15_000 && full.gapMs < 25_000, `gap=${(full.gapMs/1000).toFixed(1)}s`);
check("  total pace fills the window, not less", Math.abs(perMsg * 1500 - 12 * H / 1000) < 60, `${(perMsg*1500/3600).toFixed(2)}h for 1500`);
check("  window is sufficient", !full.windowTooShort, `tooShort=${full.windowTooShort}`);

// Short list, lots of time — must not idle for hours between messages.
const tiny = computeGap({ remainingContacts: 5, dailyRemaining: 1500, dailyLimit: 1500, windowMsLeft: 12 * H });
check("5 contacts, 12h left -> unhurried pace, NOT stretched", tiny.gapMs <= 25_000, `gap=${(tiny.gapMs/1000).toFixed(1)}s`);

// The regression that prompted this: a short list with hours left was being
// spread across the window and hit the ceiling at one message every 3 minutes.
const shortList = computeGap({ remainingContacts: 24, dailyRemaining: 1476, dailyLimit: 1500, windowMsLeft: 2.9 * H });
const minutesFor24 = (shortList.gapMs * 24 + estimateBreakMs(24)) / 60_000;
check("24 contacts finish in minutes, not hours", minutesFor24 < 15, `${minutesFor24.toFixed(1)} min for 24`);
check("  and the gap is not at the ceiling", shortList.gapMs < MAX_GAP_MS, `gap=${(shortList.gapMs/1000).toFixed(1)}s`);

// Warm-up: a day-0 number has a 50/day allowance, so it should be gentler.
const warm = computeGap({ remainingContacts: 50, dailyRemaining: 50, dailyLimit: 50, windowMsLeft: 12 * H });
check("day-0 allowance of 50 paces slower than a full load", warm.gapMs > full.gapMs, `${(warm.gapMs/1000).toFixed(0)}s vs ${(full.gapMs/1000).toFixed(0)}s`);
check("  but still capped so it stays usable", warm.gapMs <= MAX_GAP_MS, `gap=${(warm.gapMs/1000).toFixed(0)}s`);

// Impossible ask — must refuse to sprint.
const rush = computeGap({ remainingContacts: 1500, dailyRemaining: 1500, dailyLimit: 1500, windowMsLeft: 1 * H });
check("1500 in 1h -> floors at MIN_GAP, flags too-short", rush.gapMs === MIN_GAP_MS && rush.windowTooShort, `gap=${rush.gapMs/1000}s tooShort=${rush.windowTooShort}`);

// Allowance nearly spent — target follows the smaller of the two.
const nearCap = computeGap({ remainingContacts: 900, dailyRemaining: 40, dailyLimit: 1500, windowMsLeft: 6 * H });
check("40 left of allowance -> target=40 not 900", nearCap.target === 40, `target=${nearCap.target}`);

// Delivery guard engaged.
const base = computeGap({ remainingContacts: 600, dailyRemaining: 600, dailyLimit: 1500, windowMsLeft: 8 * H });
const slow = computeGap({ remainingContacts: 600, dailyRemaining: 600, dailyLimit: 1500, windowMsLeft: 8 * H, slowFactor: 2.5 });
check("slowFactor 2.5 stretches the gap", Math.abs(slow.gapMs - base.gapMs * 2.5) < 2, `${(base.gapMs/1000).toFixed(1)}s -> ${(slow.gapMs/1000).toFixed(1)}s`);

// Nothing owed.
const done = computeGap({ remainingContacts: 0, dailyRemaining: 1500, dailyLimit: 1500, windowMsLeft: 5 * H });
check("nothing remaining -> target 0", done.target === 0, `target=${done.target}`);

// Break estimate must match the loop's own cadence.
check("break estimate for 40 msgs = 1 long + 3 micro", estimateBreakMs(40) === 210_000 + 3 * 60_000, `${estimateBreakMs(40)/1000}s`);
check("break estimate for 120 msgs discounts the overlap", estimateBreakMs(120) === 3 * 210_000 + (10 - 1) * 60_000, `${estimateBreakMs(120)/1000}s`);

// ── Time of day ───────────────────────────────────────────────────
check("the day has a rhythm: lunch is slower than late morning", diurnalFactor(14) > diurnalFactor(11), `${diurnalFactor(11)} vs ${diurnalFactor(14)}`);
check("  and nothing in the window is faster than the base pace",
  Array.from({ length: 24 }, (_, h) => diurnalFactor(h)).every((f) => f >= 1), "no hour < 1");
const avg = Array.from({ length: 12 }, (_, i) => diurnalFactor(9 + i)).reduce((a, b) => a + b, 0) / 12;
check("  the average over the window still fits 1500 a day", avg < 1.25 && (19 * avg) < 24, `avg=${avg.toFixed(2)}`);

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
