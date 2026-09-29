// ── Deliverability, read as signals ───────────────────────────────
// Email has the same failure the WhatsApp side has: sends keep succeeding
// while a mailbox provider quietly stops delivering. What can be read back
// is bounces, complaints, opens and replies, and the rules here turn them
// into "slow down" or "stop". Pure, like the ban-risk score.

export interface EmailSignals {
  sent24h: number;
  bounced24h: number;
  complaints24h: number;
  unsubscribed24h: number;
  opened24h: number;
  replied24h: number;
  /** Days since the sending address first sent through this system. */
  senderAgeDays: number;
}

export interface EmailVerdict {
  level: "ok" | "warning" | "critical";
  /** 0 keeps sending; >0 pauses for this many minutes. */
  holdMinutes: number;
  /** Multiplier on the gap between sends. */
  throttle: number;
  reasons: string[];
}

// Mailbox providers publish their expectations plainly: keep complaints
// under 0.1%, bounces under 2%, and warm a new address up. These lines are
// set at half of where trouble starts.
export const BOUNCE_WARN = 0.03, BOUNCE_STOP = 0.06;
export const COMPLAINT_WARN = 0.001, COMPLAINT_STOP = 0.003;
export const MIN_SAMPLE = 30;

export function assessEmail(s: EmailSignals): EmailVerdict {
  const reasons: string[] = [];
  let level: EmailVerdict["level"] = "ok";
  let hold = 0, throttle = 1;
  const worse = (l: EmailVerdict["level"]) => { const r = { ok: 0, warning: 1, critical: 2 }; if (r[l] > r[level]) level = l; };

  if (s.sent24h >= MIN_SAMPLE) {
    const b = s.bounced24h / s.sent24h;
    if (b >= BOUNCE_STOP) { worse("critical"); hold = Math.max(hold, 240); reasons.push(`${Math.round(b * 100)}% من رسائل اليوم ارتدّت — القائمة تحتاج تنظيفاً قبل أي إرسال.`); }
    else if (b >= BOUNCE_WARN) { worse("warning"); throttle = Math.max(throttle, 2); reasons.push(`${Math.round(b * 100)}% ارتداد — أبطأنا الإرسال.`); }

    const c = s.complaints24h / s.sent24h;
    if (c >= COMPLAINT_STOP) { worse("critical"); hold = Math.max(hold, 720); reasons.push(`بلاغات إزعاج ${(c * 100).toFixed(2)}% — أوقفنا الإرسال ١٢ ساعة.`); }
    else if (c >= COMPLAINT_WARN) { worse("warning"); throttle = Math.max(throttle, 2); reasons.push(`بلاغات إزعاج ${(c * 100).toFixed(2)}%.`); }

    const u = s.unsubscribed24h / s.sent24h;
    if (u >= 0.02) { worse("warning"); throttle = Math.max(throttle, 1.5); reasons.push(`${Math.round(u * 100)}% ألغوا الاشتراك خلال يوم — راجع المحتوى والقائمة.`); }
  }

  if (s.senderAgeDays < 7) { throttle = Math.max(throttle, 1.5); reasons.push(`عنوان الإرسال جديد (${s.senderAgeDays} أيام) — إحماء.`); }

  if (s.sent24h >= 100 && s.opened24h / s.sent24h < 0.05 && s.replied24h === 0) {
    worse("warning");
    reasons.push(`أقل من ٥٪ فتحوا وصفر ردود على ${s.sent24h} رسالة — إما تصل إلى الرسائل غير المرغوبة أو القائمة لا تريدك.`);
  }

  return { level, holdMinutes: hold, throttle, reasons };
}

/** The gap between two sends for one account, from the hourly cap, jittered. */
export function sendGapMs(hourlyCap: number, throttle = 1, rand = Math.random): number {
  const base = Math.max(20_000, Math.round(3_600_000 / Math.max(1, hourlyCap)));
  const jitter = 0.7 + rand() * 0.6;
  return Math.round(base * jitter * throttle);
}
