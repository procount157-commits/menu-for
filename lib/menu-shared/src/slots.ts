// ── Which booking times are still free ────────────────────────────
// Pure: the booking route passes the day's bookings in. Capacity is counted
// in bookings overlapping a slot (tables, chairs, stylists), not in people —
// a table for six is still one table.

import { openWindow, type WeekHours } from "./time";

export interface SlotRules {
  slotMin: number;
  capacityPerSlot: number;
  leadTimeMin: number;
  /** How long one booking holds its place: the service's duration, or one slot. */
  durationMin?: number | null;
}

export interface ExistingBooking { startsAt: Date; endsAt: Date }

export interface Slot { start: string; remaining: number }

export function availableSlots(
  date: string,
  hours: WeekHours,
  tz: string,
  rules: SlotRules,
  bookings: ExistingBooking[],
  now: Date = new Date(),
): Slot[] {
  const w = openWindow(hours, tz, date);
  if (!w) return [];
  const step = Math.max(5, rules.slotMin) * 60_000;
  const hold = Math.max(5, rules.durationMin || rules.slotMin) * 60_000;
  const earliest = now.getTime() + Math.max(0, rules.leadTimeMin) * 60_000;
  const out: Slot[] = [];
  for (let t = w.start.getTime(); t + hold <= w.end.getTime(); t += step) {
    if (t < earliest) continue;
    const s = t, e = t + hold;
    const taken = bookings.filter((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s).length;
    const remaining = rules.capacityPerSlot - taken;
    if (remaining > 0) out.push({ start: new Date(s).toISOString(), remaining });
  }
  return out;
}

/** Whether one more booking fits at `start` — the check the booking route makes under a lock. */
export function fits(start: Date, rules: SlotRules, bookings: ExistingBooking[]): boolean {
  const hold = Math.max(5, rules.durationMin || rules.slotMin) * 60_000;
  const s = start.getTime(), e = s + hold;
  return bookings.filter((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s).length < rules.capacityPerSlot;
}
