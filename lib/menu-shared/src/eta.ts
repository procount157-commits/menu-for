// ── How long the wait is ──────────────────────────────────────────
// The number a customer is promised is the thing they will hold the
// restaurant to, so it is estimated from what the queue is actually doing
// today rather than from a setting — and shown as a range, because one
// table that takes forty minutes is normal and a single number cannot say so.
//
// Pure, like pacing.ts: the queue engine passes the call times in.

/** Gaps longer than this mean the queue was empty, not that service was slow. */
export const IDLE_GAP_MIN = 45;
/** How many recent gaps the estimate looks at. */
export const SAMPLE_SIZE = 20;
/** Weight of the owner's own estimate, in gaps: with 5 gaps measured it counts half. */
export const PRIOR_WEIGHT = 5;

export interface ServiceInterval {
  /** Minutes between one customer being called and the next. */
  minutes: number;
  /** How many measured gaps went into it. */
  samples: number;
}

/**
 * The time between calls, from today's call times (epoch ms, any order) and
 * the owner's estimate.
 *
 * A mean, with the slowest tenth capped at the 90th percentile: one table
 * that took forty minutes does not move it, and — the case a median gets
 * wrong — staff calling three tables within seconds of each other count as
 * three people served in that time rather than as three zero-minute gaps
 * that drag the estimate to nothing. Blended toward the owner's number while
 * there is little evidence.
 */
export function serviceInterval(callTimes: number[], manualMin: number): ServiceInterval {
  const manual = Math.max(0.5, Number(manualMin) || 5);
  const sorted = [...callTimes].filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = (sorted[i]! - sorted[i - 1]!) / 60_000;
    if (g >= 0 && g <= IDLE_GAP_MIN) gaps.push(g);
  }
  const recent = gaps.slice(-SAMPLE_SIZE);
  const n = recent.length;
  if (n === 0) return { minutes: round1(manual), samples: 0 };
  const sorted2 = [...recent].sort((a, b) => a - b);
  const cap = sorted2[Math.floor(0.9 * (n - 1))]!;
  const mean = recent.reduce((s, g) => s + Math.min(g, cap), 0) / n;
  const w = n / (n + PRIOR_WEIGHT);
  return { minutes: round1(Math.max(0.5, w * mean + (1 - w) * manual)), samples: n };
}

export interface EtaRange {
  /** Expected minutes until called. */
  expected: number;
  low: number;
  high: number;
  /** Under five minutes: show "soon" rather than "0–5". */
  soon: boolean;
}

/** The wait for someone with `ahead` people in front of them. */
export function etaFor(ahead: number, intervalMin: number, adjustMin = 0): EtaRange {
  const a = Math.max(0, Math.floor(ahead));
  const expected = Math.max(0, a * intervalMin + (a > 0 ? adjustMin : 0));
  if (expected < 5) return { expected: round1(expected), low: 0, high: 5, soon: true };
  const low = Math.max(0, Math.floor((expected * 0.8) / 5) * 5);
  let high = Math.ceil((expected * 1.3) / 5) * 5;
  if (high <= low) high = low + 5;
  return { expected: round1(expected), low, high, soon: false };
}

export function formatEta(r: EtaRange, lang: "ar" | "en" = "ar"): string {
  if (r.soon) return lang === "ar" ? "أقل من 5 دقائق" : "under 5 min";
  if (r.high >= 120) {
    const h = Math.round(r.expected / 6) / 10;
    return lang === "ar" ? `~${h} ساعة` : `~${h} h`;
  }
  return lang === "ar" ? `~${r.low}–${r.high} دقيقة` : `~${r.low}–${r.high} min`;
}

/** How far off a promise was: positive means the customer waited longer than told. */
export function etaError(promisedMin: number, waitedMin: number): number {
  return round1(waitedMin - promisedMin);
}

function round1(n: number) { return Math.round(n * 10) / 10; }
