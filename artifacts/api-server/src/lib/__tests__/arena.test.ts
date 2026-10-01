import { cardFrom } from "../arena";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// The arena builds the card from the conversation alone, the same way the
// live path builds it message by message.
let c = cardFrom([{ role: "user", content: "السلام عليكم" }], ["greeting"]);
check("a greeting leaves the card empty at stage 1", c.stage === 1 && !c.licence);

c = cardFrom([
  { role: "user", content: "ابغى احجز طاولة لـ٤ أشخاص" },
  { role: "assistant", content: "…" },
  { role: "user", content: "الخميس الساعة ٨ المسا، عيد ميلاد" },
  { role: "assistant", content: "…" },
  { role: "user", content: "حلو، كيف أحجز؟" },
], ["question", "question", "interested"]);
check("facts accumulate across turns", c.licence === "booking" && c.size === "4 أشخاص" && c.staff === "الخميس 8 مساءً" && c.activity === "عيد ميلاد", JSON.stringify({ l: c.licence, s: c.size, t: c.staff, a: c.activity }));
check("...and the stage reaches the order", c.stage === 5, `${c.stage}`);

c = cardFrom([
  { role: "user", content: "بكم البرجر؟ ابغى سفري" },
  { role: "user", content: "ابي اطلب" },
  { role: "user", content: "بس غالي" },
], ["question", "interested", "question"]);
check("an objection after interest is stage 6", c.stage === 6 && c.objection === "غالي", `${c.stage} ${c.objection}`);

c = cardFrom([{ role: "user", content: "تمام ثبت الحجز" }], ["interested"]);
check("a go-ahead confirms", c.stage === 7);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
