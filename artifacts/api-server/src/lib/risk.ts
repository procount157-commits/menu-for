// ── One number for how close this account is to a ban ─────────────
// The guards each watch one thing and each have a threshold: delivery under
// 55% pauses, failures over 30% hold, six reconnects throttle. Real trouble
// rarely trips one of them cleanly. It shows up as delivery a little low, a
// few opt-outs, a couple of known contacts who stopped receiving, and a number
// that has only been linked four days — none of which crosses a line alone,
// all of which together is a number about to be flagged.
//
// So the signals are scored together. Each contributes on a curve rather than
// at a threshold, the sum is a risk from 0 to 100, and the response scales
// with it: a little slower at 25, half the allowance at 50, stopped at 80.
// The point is to start easing off while easing off still works.
//
// Pure, so the policy can be argued with against a table of situations.

export interface RiskSignals {
  /** Delivery rate over mature sends, or null when there is no sample yet. */
  deliveryRate: number | null;
  deliverySample: number;
  /** Failed as a share of today's attempts. */
  failureRate: number;
  /** Opt-outs in 24h as a share of what was sent in 24h. */
  optOutRate: number;
  optOuts24h: number;
  sent24h: number;
  /** Known contacts — people who received from us before — who no longer do. */
  probableBlocks: number;
  blockSample: number;
  /** Distinct people who wrote back, over distinct people written to, 7d. Null below 30 sent. */
  replyRate: number | null;
  reconnects6h: number;
  /** Days since the number was first linked. */
  numberAgeDays: number;
  /** Share of the last 24h's sends that went to people with no prior thread. Null when nothing was sent. */
  strangerShare: number | null;
}

export type RiskLevel = "ok" | "caution" | "warning" | "high" | "critical";

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  /** Multiplier on every gap. 1 = as calculated. */
  throttle: number;
  /** Fraction of the day's allowance still permitted. 1 = all of it. */
  ceilingFactor: number;
  /** Minutes to stop sending altogether; 0 when none. */
  holdMinutes: number;
  /** One sentence per contributing signal, Arabic, for the owner. */
  reasons: string[];
}

// How much each signal can add. They sum to well over 100 on purpose: a number
// does not need every problem to be in trouble, and the clamp does the rest.
const CAP = { delivery: 40, failure: 20, optOut: 30, blocks: 25, churn: 12, strangers: 10, young: 6 };

// The sample sizes below which a signal is noise rather than evidence. A
// guard that reads five messages as a trend will stop a healthy campaign.
export const MIN_DELIVERY_SAMPLE = 25;
export const MIN_OPTOUT_SENT     = 30;
export const MIN_BLOCK_SAMPLE    = 10;
export const MIN_STRANGER_SENT   = 50;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function scoreRisk(s: RiskSignals): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  // Delivery: healthy runs 85–95% inside twenty minutes. Every point under 90
  // costs 1.5, so 75% is 22 and 55% hits the cap. This is the signal that
  // moves first when WhatsApp starts throttling, and it moves quietly.
  if (s.deliveryRate !== null && s.deliverySample >= MIN_DELIVERY_SAMPLE && s.deliveryRate < 0.9) {
    const add = clamp((0.9 - s.deliveryRate) * 150, 0, CAP.delivery);
    score += add;
    reasons.push(`التسليم ${pct(s.deliveryRate)} من ${s.deliverySample} رسالة ناضجة.`);
  }

  // Failures under 10% are the ordinary cost of a list; above it they are
  // either dead numbers eating the allowance or the number itself refused.
  if (s.failureRate > 0.1) {
    score += clamp((s.failureRate - 0.1) * 100, 0, CAP.failure);
    reasons.push(`${pct(s.failureRate)} من محاولات اليوم فشلت.`);
  }

  // Opt-outs are the strongest signal WhatsApp has of an unwanted sender and
  // the one nobody watches. 3% is worth 18 on its own; 5% is the cap.
  if (s.sent24h >= MIN_OPTOUT_SENT && s.optOutRate > 0) {
    score += clamp(s.optOutRate * 600, 0, CAP.optOut);
    reasons.push(`${s.optOuts24h} ألغوا الاشتراك خلال ٢٤ ساعة (${pct(s.optOutRate)} ممن وصلتهم).`);
  }

  // A known contact who used to receive and now does not has, in nearly every
  // case, blocked the number. Blocks are what enforcement keys on.
  if (s.blockSample >= MIN_BLOCK_SAMPLE && s.probableBlocks > 0) {
    const rate = s.probableBlocks / s.blockSample;
    score += clamp(rate * 200, 0, CAP.blocks);
    reasons.push(`${s.probableBlocks} من ${s.blockSample} جهة اتصال معروفة توقّفت عن الاستلام — حظر محتمل.`);
  }

  // Churn: a number that keeps re-registering looks like a number under
  // pressure. Five in six hours is a bad afternoon; more is a pattern.
  if (s.reconnects6h > 5) {
    score += clamp((s.reconnects6h - 5) * 3, 0, CAP.churn);
    reasons.push(`${s.reconnects6h} إعادة اتصال خلال ٦ ساعات.`);
  }

  // A number that only ever writes to strangers is what a spammer looks like.
  // Some of that is the job; all of it, at volume, is the signature.
  if (s.strangerShare !== null && s.sent24h >= MIN_STRANGER_SENT && s.strangerShare > 0.8) {
    score += clamp((s.strangerShare - 0.8) * 50, 0, CAP.strangers);
    reasons.push(`${pct(s.strangerShare)} من رسائل اليوم إلى أرقام لا محادثة سابقة معها.`);
  }

  // A number under a week old has no history to be judged against, and
  // WhatsApp gives it less benefit of the doubt.
  if (s.numberAgeDays < 7) {
    score += CAP.young;
    reasons.push(`الرقم مرتبط منذ ${s.numberAgeDays} ${s.numberAgeDays === 1 ? "يوم" : "أيام"} فقط.`);
  }

  // Credit: people writing back is the one thing that makes a bulk sender
  // look like a business. It offsets, it does not erase.
  if (s.replyRate !== null) {
    if (s.replyRate >= 0.10) { score -= 15; reasons.push(`${pct(s.replyRate)} ممن راسلناهم ردّوا — الرقم يبدو رقم عمل حقيقي.`); }
    else if (s.replyRate >= 0.05) { score -= 8; }
  }

  score = Math.round(clamp(score, 0, 100));

  const level: RiskLevel =
    score < 20 ? "ok" :
    score < 40 ? "caution" :
    score < 60 ? "warning" :
    score < 80 ? "high" : "critical";

  // The response. Continuous in spirit, stepped in practice so the owner can
  // predict it: a throttle that drifts by decimals every ten minutes is one
  // nobody can reason about.
  const response: Record<RiskLevel, Pick<RiskAssessment, "throttle" | "ceilingFactor" | "holdMinutes">> = {
    ok:       { throttle: 1,   ceilingFactor: 1,    holdMinutes: 0 },
    caution:  { throttle: 1.5, ceilingFactor: 1,    holdMinutes: 0 },
    warning:  { throttle: 2.2, ceilingFactor: 0.6,  holdMinutes: 0 },
    high:     { throttle: 3,   ceilingFactor: 0.35, holdMinutes: 0 },
    critical: { throttle: 3,   ceilingFactor: 0.2,  holdMinutes: 120 },
  };

  return { score, level, ...response[level], reasons };
}

export const RISK_LEVEL_AR: Record<RiskLevel, string> = {
  ok: "مطمئن", caution: "انتبه", warning: "تحذير", high: "خطر", critical: "حرج",
};
