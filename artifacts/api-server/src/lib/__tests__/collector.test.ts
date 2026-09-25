import { classify, SEGMENT_AR, type ContactFacts } from "../collector-agent";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);
const f = (o: Partial<ContactFacts>): ContactFacts => ({
  phone: "971500000000", sent: 1, delivered: 1, read: 0, replied: 0,
  lastReadAt: null, lastReplyAt: null, refused: false, ...o,
});
const c = (o: Partial<ContactFacts>) => classify(f(o), NOW);

// ── Refusal beats everything ─────────────────────────────────────
check("someone who asked to stop is never chased",
  c({ refused: true, read: 9, lastReadAt: daysAgo(0) }).segment === "refused");
check("...and scores zero however interested they looked",
  c({ refused: true, read: 9, lastReadAt: daysAgo(0) }).score === 0);

// ── Already talking ──────────────────────────────────────────────
let r = c({ replied: 2, read: 3, lastReadAt: daysAgo(0) });
check("someone who replied is 'hot'", r.segment === "hot");
check("...but scores low, because chasing them is pestering", r.score === 20,
  "المحادثة قائمة");

// ── Undeliverable ────────────────────────────────────────────────
check("sent but never delivered means the number is unreachable",
  c({ sent: 3, delivered: 0 }).segment === "unreachable");
check("...and is worth nothing to chase", c({ sent: 3, delivered: 0 }).score === 0);

// ── Delivered, never opened ──────────────────────────────────────
r = c({ delivered: 3, read: 0 });
check("delivered but unopened is its own segment", r.segment === "delivered");
check("...and ranks below anyone who opened", r.score < c({ read: 1, lastReadAt: daysAgo(30) }).score);

// ── The interesting ones ─────────────────────────────────────────
check("one open, no reply, is 'curious'",
  c({ read: 1, lastReadAt: daysAgo(2) }).segment === "curious");
check("two opens, no reply, is 'warm'",
  c({ read: 2, lastReadAt: daysAgo(2) }).segment === "warm");

// The second open is the whole point: one can be a notification glance.
const one = c({ read: 1, lastReadAt: daysAgo(2) }).score;
const two = c({ read: 2, lastReadAt: daysAgo(2) }).score;
const four = c({ read: 4, lastReadAt: daysAgo(2) }).score;
check("opening twice outranks opening once", two > one, `${two} > ${one}`);
check("...and four times outranks twice", four > two, `${four} > ${two}`);

// Recency, because interest decays.
const today = c({ read: 2, lastReadAt: daysAgo(0) }).score;
const lastWeek = c({ read: 2, lastReadAt: daysAgo(6) }).score;
const lastMonth = c({ read: 2, lastReadAt: daysAgo(40) }).score;
check("an open today outranks one last week", today > lastWeek, `${today} > ${lastWeek}`);
check("...which outranks one last month", lastWeek > lastMonth, `${lastWeek} > ${lastMonth}`);
check("a month-old open is no longer a lead", lastMonth < 50, `${lastMonth}`);

// The ordering that actually matters for the chase list.
check("someone who opened twice today tops the list",
  c({ read: 2, lastReadAt: daysAgo(0) }).score > c({ read: 1, lastReadAt: daysAgo(0) }).score);
check("...and beats a heavy reader who has gone cold",
  c({ read: 2, lastReadAt: daysAgo(0) }).score > c({ read: 5, lastReadAt: daysAgo(45) }).score,
  "الحداثة تُرجّح");

// ── Bounds ───────────────────────────────────────────────────────
const extremes = [
  c({ read: 99, lastReadAt: daysAgo(0) }), c({ read: 1, lastReadAt: daysAgo(999) }),
  c({ read: 0, delivered: 0, sent: 0 }), c({ replied: 50 }),
];
check("every score stays inside 0..100", extremes.every((x) => x.score >= 0 && x.score <= 100));
check("every contact gets a reason a person can read",
  extremes.every((x) => (x.reason ?? "").length > 8));
check("every segment has an Arabic label",
  extremes.every((x) => !!SEGMENT_AR[x.segment]));

// A contact with no campaign history at all must not crash or look promising.
r = c({ sent: 0, delivered: 0, read: 0 });
check("a contact we never messaged is not a lead", r.score <= 10, `${r.score}`);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
