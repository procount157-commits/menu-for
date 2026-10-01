// ── Local time in the shop's timezone ─────────────────────────────
// The server runs in UTC, the shop runs in Dubai, and a restaurant that
// closes at 2am is still on Thursday's service at 1am Friday. Everything that
// asks "what day is it" or "are we open" goes through here.

export interface DayHours { open: string; close: string; closed?: boolean }
export type WeekHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayHours>>;

/** The service day rolls over at this local hour, not at midnight. */
export const DAY_ROLLOVER_HOUR = 4;

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(tz: string, at: Date = new Date()): LocalParts {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(at)) p[x.type] = x.value;
  return {
    year: +p.year!, month: +p.month!, day: +p.day!,
    hour: +p.hour! % 24, minute: +p.minute!, weekday: WD[p.weekday!] ?? 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' of the local calendar date. */
export function localDate(tz: string, at: Date = new Date()): string {
  const p = localParts(tz, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The business day a moment belongs to: 1am Friday is still Thursday's service. */
export function serviceDay(tz: string, at: Date = new Date()): string {
  return localDate(tz, new Date(at.getTime() - DAY_ROLLOVER_HOUR * 3_600_000));
}

/** The offset of `tz` from UTC at `at`, in minutes (Dubai: +240). */
export function tzOffsetMin(tz: string, at: Date): number {
  const p = localParts(tz, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The UTC instant of a local wall-clock time in `tz`. */
export function zonedToUtc(tz: string, date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  // Two passes settle the offset across a DST edge; the Gulf has none, but the
  // shop's timezone is a setting.
  let t = guess - tzOffsetMin(tz, new Date(guess)) * 60_000;
  t = guess - tzOffsetMin(tz, new Date(t)) * 60_000;
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

const toMin = (hhmm: string) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** The opening window of a local date as UTC instants, or null when closed that day. */
export function openWindow(hours: WeekHours, tz: string, date: string): { start: Date; end: Date } | null {
  const h = hours[String(weekdayOf(date)) as keyof WeekHours];
  if (!h || h.closed || !h.open || !h.close) return null;
  const start = zonedToUtc(tz, date, h.open);
  let end = zonedToUtc(tz, date, h.close);
  if (toMin(h.close) <= toMin(h.open)) end = zonedToUtc(tz, addDays(date, 1), h.close);
  return { start, end };
}

/**
 * Whether the shop is open at `at`. With no hours set at all it is treated as
 * open — a new shop that has not filled them in should not show "closed".
 */
export function isOpenAt(hours: WeekHours | null | undefined, tz: string, at: Date = new Date()): { open: boolean; known: boolean; closesAt?: Date; opensAt?: Date } {
  if (!hours || Object.keys(hours).length === 0) return { open: true, known: false };
  const today = localDate(tz, at);
  for (const d of [addDays(today, -1), today]) {
    const w = openWindow(hours, tz, d);
    if (w && at >= w.start && at < w.end) return { open: true, known: true, closesAt: w.end };
  }
  for (let i = 0; i < 8; i++) {
    const w = openWindow(hours, tz, addDays(today, i));
    if (w && w.start > at) return { open: false, known: true, opensAt: w.start };
  }
  return { open: false, known: true };
}

export function formatClock(at: Date, tz: string, lang: "ar" | "en" = "ar"): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
}

export function formatDayLabel(date: string, tz: string, lang: "ar" | "en" = "ar", now: Date = new Date()): string {
  const today = localDate(tz, now);
  if (date === today) return lang === "ar" ? "اليوم" : "Today";
  if (date === addDays(today, 1)) return lang === "ar" ? "غداً" : "Tomorrow";
  const at = zonedToUtc(tz, date, "12:00");
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "short" }).format(at);
}
