// ── When a reply starts ───────────────────────────────────────────
// The typing indicator was already there and running for a plausible length of
// time. What gave it away was that it began the instant the customer's message
// landed: nobody notices a WhatsApp message, opens it and starts typing inside
// half a second, and the one thing every automated account has in common is
// that it answers immediately.
//
// So there is a pause before the indicator appears, and its length depends on
// what a person would plausibly be doing. Mid-conversation they have the chat
// open and answer quickly; after an hour of silence they were doing something
// else and take longer to come back.
//
// This is also the cheapest ban protection in the system. A number that
// replies in under a second, every time, at any hour, is describing itself.

/** Seconds, as [min, max] — a range, because a fixed delay is a signature too. */
const WINDOWS = {
  // They messaged within the last couple of minutes: the chat is open in front
  // of them and a long pause reads as being ignored.
  active:   [4, 14],
  // A normal gap. Long enough to be human, short enough to keep them engaged.
  warm:     [15, 50],
  // The conversation went quiet, or this is a first contact. A person was
  // doing something else and is coming back to it.
  cold:     [30, 110],
} as const;

export type Pace = keyof typeof WINDOWS;

export function pick(pace: Pace, rand = Math.random): number {
  const [lo, hi] = WINDOWS[pace];
  return Math.round((lo + rand() * (hi - lo)) * 1_000);
}

/**
 * How long to wait before starting to type.
 *
 * `minutesSinceTheirLast` is the gap before the message being answered — how
 * long the conversation had been quiet, not how long ago it arrived.
 */
export function thinkTime(opts: {
  minutesSinceTheirLast: number | null;
  /** Their message. A long one takes longer to read. */
  incomingLength: number;
  /** Outside working hours a person is slower, not absent. */
  outsideHours?: boolean;
  rand?: () => number;
}): { ms: number; pace: Pace } {
  const rand = opts.rand ?? Math.random;
  const gap = opts.minutesSinceTheirLast;

  const pace: Pace = gap === null ? "cold"
    : gap <= 2 ? "active"
    : gap <= 45 ? "warm"
    : "cold";

  let ms = pick(pace, rand);

  // Reading time, for a message long enough to need it. A paragraph takes a
  // few seconds to take in before any reply could start.
  if (opts.incomingLength > 120) {
    ms += Math.min(12_000, (opts.incomingLength - 120) * 25);
  }

  // Slower at night, but still answering — a business that replies at 3am as
  // fast as at noon is not staffed by people.
  if (opts.outsideHours) ms = Math.round(ms * 1.6);

  // Two minutes is where a waiting customer starts to assume nobody is there.
  return { ms: Math.min(150_000, ms), pace };
}
