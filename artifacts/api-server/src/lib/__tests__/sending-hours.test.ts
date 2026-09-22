// Checks the sending-hours window maths, including the wrap-past-midnight case.
function hourIn(tz: string, d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d));
}
function within(h: number, start: number, end: number): boolean {
  return start <= end ? h >= start && h < end : h >= start || h < end;
}
const cases: Array<[number, number, number, boolean]> = [
  // hour, start, end, expected
  [ 9, 9, 21, true  ], [20, 9, 21, true  ], [21, 9, 21, false],
  [ 8, 9, 21, false ], [ 3, 9, 21, false ], [ 0, 9, 21, false],
  // window that wraps midnight
  [23, 20,  2, true  ], [ 1, 20,  2, true ], [ 3, 20,  2, false], [19, 20, 2, false],
];
let pass = 0;
for (const [h, s, e, exp] of cases) {
  const got = within(h, s, e);
  const ok = got === exp; if (ok) pass++;
  console.log(`${ok ? "✅" : "❌"} hour ${String(h).padStart(2)} in ${s}:00-${e}:00 -> ${got} (expected ${exp})`);
}
const now = new Date();
console.log(`\nnow in Asia/Dubai: ${hourIn("Asia/Dubai", now)}:00 — sending allowed: ${within(hourIn("Asia/Dubai", now), 9, 21)}`);
console.log(`${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
