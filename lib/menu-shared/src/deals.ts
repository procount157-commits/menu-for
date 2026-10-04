// ── Coupons and timed deals ───────────────────────────────────────
// One rule set, shared by the menu (to show a deal and preview the cart) and
// the server (which decides). A deal with no code applies by itself while its
// window is open — «ساعة سعيدة»; one with a code applies when it is typed.

import { localParts } from "./time";
import { money } from "./pricing";

export interface Deal {
  id: number;
  code: string | null;
  title: string;
  kind: "pct" | "amount";
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  /** Weekdays it runs (0 Sunday … 6 Saturday); empty means every day. */
  days: number[];
  fromTime: string | null;
  toTime: string | null;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  maxUses: number | null;
  uses: number;
  isActive: boolean;
  phone?: string | null;
  branchId?: number | null;
}

const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const at = (d: string | Date | null) => (d ? new Date(d).getTime() : null);

/** Whether the deal is running at `now` in the shop's timezone. A window past midnight wraps. Pure. */
export function dealOpen(d: Pick<Deal, "isActive" | "days" | "fromTime" | "toTime" | "startsAt" | "endsAt" | "maxUses" | "uses">, tz: string, now = new Date()): boolean {
  if (!d.isActive) return false;
  const t = now.getTime();
  if (at(d.startsAt) != null && t < at(d.startsAt)!) return false;
  if (at(d.endsAt) != null && t >= at(d.endsAt)!) return false;
  if (d.maxUses != null && d.uses >= d.maxUses) return false;
  const p = localParts(tz, now);
  const m = p.hour * 60 + p.minute;
  if (d.fromTime && d.toTime) {
    const a = mins(d.fromTime), b = mins(d.toTime);
    const inside = a <= b ? m >= a && m < b : m >= a || m < b;
    if (!inside) return false;
    // Past midnight, the hours after 00:00 belong to the day the window opened.
    const day = a > b && m < b ? (p.weekday + 6) % 7 : p.weekday;
    if (d.days?.length && !d.days.includes(day)) return false;
  } else if (d.days?.length && !d.days.includes(p.weekday)) return false;
  return true;
}

/** What the deal takes off this subtotal (0 below its minimum). Pure. */
export function dealDiscount(d: Pick<Deal, "kind" | "value" | "minSubtotal" | "maxDiscount">, subtotal: number): number {
  if (subtotal <= 0 || subtotal < (d.minSubtotal || 0)) return 0;
  let off = d.kind === "pct" ? (subtotal * Math.min(100, Math.max(0, d.value))) / 100 : Math.max(0, d.value);
  if (d.maxDiscount != null && d.maxDiscount > 0) off = Math.min(off, d.maxDiscount);
  return money(Math.min(off, subtotal));
}

/** The automatic deal worth most on this subtotal, or null. Pure. */
export function bestAutoDeal<T extends Deal>(deals: T[], subtotal: number, tz: string, now = new Date()): { deal: T; discount: number } | null {
  let best: { deal: T; discount: number } | null = null;
  for (const d of deals) {
    if (d.code || d.phone || !dealOpen(d, tz, now)) continue;
    const off = dealDiscount(d, subtotal);
    if (off > 0 && (!best || off > best.discount)) best = { deal: d, discount: off };
  }
  return best;
}

/** «خصم 15%» / «خصم 10 د.إ» — the deal in a few words. Pure. */
export function dealLabel(d: Pick<Deal, "kind" | "value">, currencyLabel: string, lang: "ar" | "en" = "ar"): string {
  const v = Number.isInteger(d.value) ? String(d.value) : d.value.toFixed(2);
  if (d.kind === "pct") return lang === "ar" ? `خصم ${v}%` : `${v}% off`;
  return lang === "ar" ? `خصم ${v} ${currencyLabel}` : `${currencyLabel} ${v} off`;
}

/** Codes are typed in any case and with stray spaces. Pure. */
export const normaliseCode = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 24);
