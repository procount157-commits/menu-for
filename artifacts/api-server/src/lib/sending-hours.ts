// ── Sending hours ─────────────────────────────────────────────────
// Shared by campaigns and by the follow-up worker. A marketing message at
// 03:00 earns blocks and reports out of all proportion to its reach, and
// block/report rate is what actually gets a number banned.
//
// Lives in its own module because the follow-up engine needs it too, and
// importing a route file from a lib would form a cycle.

export const SENDING_HOURS_ENABLED = process.env["SENDING_HOURS_ENABLED"] !== "false";
export const SENDING_TZ            = process.env["SENDING_TIMEZONE"] ?? "Asia/Dubai";
export const SENDING_HOUR_START    = Number(process.env["SENDING_HOUR_START"] ?? 9);   // inclusive
export const SENDING_HOUR_END      = Number(process.env["SENDING_HOUR_END"]   ?? 21);  // exclusive

/** Current hour (0–23) in the configured sending timezone. */
export function hourInSendingTz(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: SENDING_TZ, hour: "2-digit", hour12: false }).format(now),
  );
}

export function isWithinSendingHours(now = new Date()): boolean {
  if (!SENDING_HOURS_ENABLED) return true;
  const h = hourInSendingTz(now);
  // Handles a window that wraps past midnight (e.g. 20 -> 2) as well as a
  // normal daytime one.
  return SENDING_HOUR_START <= SENDING_HOUR_END
    ? h >= SENDING_HOUR_START && h < SENDING_HOUR_END
    : h >= SENDING_HOUR_START || h < SENDING_HOUR_END;
}

/**
 * Milliseconds until the sending window closes.
 *
 * With sending hours off this returns the time to midnight in the configured
 * zone, which keeps auto-pacing anchored to a daily boundary rather than
 * spreading a day's allowance over an open-ended horizon.
 */
export function msLeftInSendingWindow(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SENDING_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const nowSecs = num("hour") * 3600 + num("minute") * 60 + num("second");

  const endSecsRaw = (SENDING_HOURS_ENABLED ? SENDING_HOUR_END : 24) * 3600;
  const endSecs = endSecsRaw > nowSecs ? endSecsRaw : endSecsRaw + 24 * 3600;
  return (endSecs - nowSecs) * 1_000;
}
