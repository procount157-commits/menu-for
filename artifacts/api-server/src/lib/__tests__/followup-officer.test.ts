import { hardRules, STEP_LABELS, type Evidence } from "../followup-officer";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

const e = (o: Partial<Evidence>): Evidence => ({
  phone: "971500000000", step: 0, segment: "curious", opens: 1, replies: 0,
  followUpsSent: 0, quietHours: 48, optedOut: false, lastIntent: null, ...o,
});

// ── Settled before anyone is asked ───────────────────────────────
check("someone who asked to stop is dropped, not debated",
  hardRules(e({ optedOut: true }))?.verdict === "drop");
check("...even if they open everything",
  hardRules(e({ optedOut: true, opens: 20, segment: "warm" }))?.verdict === "drop");
check("a declared 'not interested' is dropped",
  hardRules(e({ lastIntent: "not_interested" }))?.verdict === "drop");
check("an open complaint stops marketing follow-up",
  hardRules(e({ lastIntent: "complaint" }))?.verdict === "drop",
  "المتابعة تزيدها");

// ── A live conversation needs no reminder ────────────────────────
let r = hardRules(e({ replies: 2, quietHours: 3 }));
check("someone who replied 3 hours ago is held, not chased", r?.verdict === "hold");
check("...and the reason says why", /المحادثة حيّة/.test(r?.reason ?? ""));
check("someone who replied a week ago is open to discussion",
  hardRules(e({ replies: 2, quietHours: 200 })) === null, "يُناقَش");

// ── The complaint guard ──────────────────────────────────────────
check("three nudges with zero opens is where it stops",
  hardRules(e({ opens: 0, followUpsSent: 3 }))?.verdict === "drop");
check("two nudges with zero opens still gets discussed",
  hardRules(e({ opens: 0, followUpsSent: 2 })) === null);
check("three nudges is fine if they are actually opening",
  hardRules(e({ opens: 4, followUpsSent: 3 })) === null, "يقرأ فعلاً");

// ── Everything else is a judgement, not a rule ───────────────────
check("an ordinary case is left to the team",
  hardRules(e({})) === null);
check("a late rung is still a judgement, not an automatic stop",
  hardRules(e({ step: 6, opens: 3, followUpsSent: 6 })) === null,
  "المرحلة السابعة تُناقَش");

// A dropped contact must never carry a draft — the caller writes none, and
// nothing downstream should be able to resurrect one.
const drops = [e({ optedOut: true }), e({ lastIntent: "not_interested" }), e({ lastIntent: "complaint" })];
check("every hard stop gives a reason a person can read",
  drops.every((x) => (hardRules(x)?.reason ?? "").length > 10));

// ── The ladder itself ────────────────────────────────────────────
check("the ladder has seven rungs", STEP_LABELS.length === 7);
check("...starting at an hour and ending at a month",
  STEP_LABELS[0] === "بعد ساعة" && STEP_LABELS[6] === "بعد شهر");

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
