// ── Which shops are about to leave ────────────────────────────────
// For the platform owner: a shop that stopped logging in, stopped taking
// orders, never linked WhatsApp, or whose plan is ending is a phone call
// worth making this week. Each reason is said in words, so the call has a
// subject.

export interface ChurnInput {
  status: string; plan: string; plan_expires_at: string | Date | null; last_login_at: string | Date | null;
  created_at: string | Date; onboarded_at: string | Date | null; items: number;
  tickets_7d: number; orders_7d: number; bookings_7d: number; wa: { linked: number; total: number };
}

export interface ChurnRisk { level: "high" | "watch" | "ok"; reasons: string[] }

const DAY = 24 * 3_600_000;
const days = (from: string | Date | null, now: number) => (from ? (now - new Date(from).getTime()) / DAY : Infinity);

/** Pure. */
export function churnRisk(o: ChurnInput, now = Date.now()): ChurnRisk {
  if (o.status === "suspended") return { level: "ok", reasons: [] };
  const high: string[] = [], watch: string[] = [];
  const exp = o.plan_expires_at ? new Date(o.plan_expires_at).getTime() : null;
  const paid = o.plan !== "free";
  if (paid && exp != null && exp <= now) high.push("انتهت الخطة ولم تُجدّد");
  else if (paid && exp != null && exp - now <= 7 * DAY) watch.push(`تنتهي الخطة خلال ${Math.max(1, Math.ceil((exp - now) / DAY))} أيام`);
  const quiet = days(o.last_login_at, now);
  if (quiet >= 14) high.push(o.last_login_at ? `لم يدخل منذ ${Math.floor(quiet)} يوماً` : "لم يدخل أبداً");
  else if (quiet >= 7) watch.push(`لم يدخل منذ ${Math.floor(quiet)} أيام`);
  const age = days(o.created_at, now);
  if (!o.onboarded_at) { if (age >= 3) watch.push("لم يكمل تجهيز المحل"); }
  else {
    const live = days(o.onboarded_at, now);
    if (live >= 7 && o.tickets_7d + o.orders_7d + o.bookings_7d === 0) high.push("لا طلبات ولا دور ولا حجوزات منذ 7 أيام");
    if (live >= 3 && o.wa.linked === 0) watch.push("واتساب غير مربوط");
    if (live >= 3 && o.items < 3) watch.push("المنيو شبه فارغ");
  }
  return { level: high.length ? "high" : watch.length ? "watch" : "ok", reasons: [...high, ...watch] };
}
