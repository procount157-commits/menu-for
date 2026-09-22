// ── Adaptive pacing ───────────────────────────────────────────────
// Picking delayMin/delayMax by hand cannot hit a daily target: the right gap
// depends on how many messages are left, how much of today's allowance is
// unspent, and how much of the sending window remains — and all three move
// while the campaign runs. A campaign paused for two hours needs a different
// gap than it started with, and no fixed pair of numbers expresses that.
//
// So the gap is derived instead: spread whatever is still owed across whatever
// time is left, with the breaks the loop will take already subtracted.

/** Average cost of the loop's own breaks, mirroring LONG/MICRO_BREAK_EVERY. */
export const LONG_BREAK_EVERY  = 40;
export const MICRO_BREAK_EVERY = 12;
const LONG_BREAK_AVG_MS  = 210_000; // randomDelay(120s, 300s)
const MICRO_BREAK_AVG_MS =  60_000; // randomDelay(30s, 90s)

// Never send faster than this however the arithmetic comes out. If the window
// is too short for what is owed, the campaign under-delivers today rather than
// sprinting — the daily cap would stop it anyway, and sprinting is what gets
// numbers flagged.
export const MIN_GAP_MS = 12_000;
// And never crawl: past this, a tiny remaining list would idle for hours.
export const MAX_GAP_MS = 180_000;

export interface PacingInput {
  /** Contacts still unsent in this campaign. */
  remainingContacts: number;
  /** Today's allowance not yet spent (warm-up aware), across all campaigns. */
  dailyRemaining: number;
  /** Milliseconds until the sending window closes. */
  windowMsLeft: number;
  /** Multiplier from the delivery guard — 1 when healthy. */
  slowFactor?: number;
}

export interface PacingResult {
  /** Mean gap in ms; the caller jitters around this. */
  gapMs: number;
  /** Messages this plan intends to send before the window closes. */
  target: number;
  /** Time the loop's own breaks are expected to consume. */
  breakMs: number;
  /** True when the window cannot fit the target even at MIN_GAP_MS. */
  windowTooShort: boolean;
}

/** Break time `count` messages will incur, matching the loop's else-if order. */
export function estimateBreakMs(count: number): number {
  if (count <= 1) return 0;
  const longs = Math.floor(count / LONG_BREAK_EVERY);
  // A micro-break is skipped when a long break lands on the same message, so
  // discount the multiples of both.
  const micros = Math.floor(count / MICRO_BREAK_EVERY)
               - Math.floor(count / (LONG_BREAK_EVERY * MICRO_BREAK_EVERY / gcd(LONG_BREAK_EVERY, MICRO_BREAK_EVERY)));
  return longs * LONG_BREAK_AVG_MS + Math.max(0, micros) * MICRO_BREAK_AVG_MS;
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/**
 * Derive the gap to leave before the next message.
 *
 * Deliberately recomputed per message rather than fixed at start: it is what
 * lets a campaign that lost an hour to a disconnect redistribute the rest of
 * the day instead of finishing early and idle, or running past the window.
 */
export function computeGap(input: PacingInput): PacingResult {
  const slowFactor = input.slowFactor ?? 1;
  const target = Math.max(0, Math.min(input.remainingContacts, input.dailyRemaining));

  if (target <= 0) {
    return { gapMs: MIN_GAP_MS, target: 0, breakMs: 0, windowTooShort: false };
  }

  const breakMs  = estimateBreakMs(target);
  const usableMs = input.windowMsLeft - breakMs;

  // Not enough room even before gaps — go at the floor and let the daily cap
  // or the window close decide where it stops.
  if (usableMs <= 0) {
    return { gapMs: MIN_GAP_MS * slowFactor, target, breakMs, windowTooShort: true };
  }

  const raw = usableMs / target;
  const windowTooShort = raw < MIN_GAP_MS;
  const gapMs = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, raw)) * slowFactor;

  return { gapMs: Math.round(gapMs), target, breakMs, windowTooShort };
}
