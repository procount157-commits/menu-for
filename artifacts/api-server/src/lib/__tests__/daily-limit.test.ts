import { engagementFactor, ENGAGEMENT_MIN_SENT } from "../daily-limit";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// The ramp used to grow on days alone. Now what recipients did with the
// messages scales it — and only ever downward.
check("too few recipients to judge: the ramp runs as it is",
  engagementFactor({ sent: ENGAGEMENT_MIN_SENT - 1, repliers: 0, optOuts: 5 }) === 1);
check("a number nobody answers is a broadcast, and earns 60%",
  engagementFactor({ sent: 500, repliers: 2, optOuts: 0 }) === 0.6);
check("a little conversation earns 80%",
  engagementFactor({ sent: 500, repliers: 10, optOuts: 0 }) === 0.8);
check("a real business number earns the full ramp",
  engagementFactor({ sent: 500, repliers: 25, optOuts: 0 }) === 1);
check("2% asking to stop halves it whatever else is true",
  engagementFactor({ sent: 500, repliers: 100, optOuts: 10 }) === 0.5);
check("the factor never raises the allowance",
  [[100, 90, 0], [1000, 500, 0], [200, 200, 0]].every(([s, r, o]) => engagementFactor({ sent: s!, repliers: r!, optOuts: o! }) <= 1));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
