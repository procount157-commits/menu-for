import { cardFrom } from "../arena";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// The arena builds the card from the conversation alone, the same way the
// live path builds it message by message.
let c = cardFrom([{ role: "user", content: "السلام عليكم" }], ["greeting"]);
check("a greeting leaves the card empty at stage 1", c.stage === 1 && !c.licence);

c = cardFrom([
  { role: "user", content: "شركة مقاولات فري زون وعندنا ٤٠ فاتورة بالشهر" },
  { role: "assistant", content: "…" },
  { role: "user", content: "عندنا غرامات متأخرة" },
  { role: "assistant", content: "…" },
  { role: "user", content: "مهتم، كيف نبدأ؟" },
], ["question", "question", "interested"]);
check("facts accumulate across turns", c.licence === "freezone" && c.activity === "مقاولات" && c.size === "40 فاتورة بالشهر" && c.pain === "غرامات");
check("...and the stage reaches the offer", c.stage === 5, `${c.stage}`);

c = cardFrom([
  { role: "user", content: "شركة تجارة مين لاند وعندنا غرامة" },
  { role: "user", content: "مهتم" },
  { role: "user", content: "بس غالي" },
], ["question", "interested", "question"]);
check("an objection after interest is stage 6", c.stage === 6 && c.objection === "غالي", `${c.stage} ${c.objection}`);

c = cardFrom([{ role: "user", content: "تمام موافق نبدأ" }], ["interested"]);
check("agreement closes", c.stage === 7);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
