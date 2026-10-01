import { checkReply, needsRewrite, claims, rewritePrompt } from "../reply-check";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };
const ctx = { customer: "ابغى احجز طاولة لعيد ميلاد، كم الحد الأقصى للأشخاص؟" };

const good = checkReply("عيد ميلاد، حلو. الحجز من هالرابط، كم شخص بتكونون؟", ctx);
check("a good reply scores 100", good.score === 100 && good.issues.length === 0, JSON.stringify(good.issues));
check("...and is not rewritten", !needsRewrite(good));

check("too long", checkReply("سطر\nسطر\nسطر\nسطر\nسطر", ctx).issues.some((i) => i.code === "long"));
check("two questions", checkReply("كم شخص؟ وأي ساعة؟", ctx).issues.some((i) => i.code === "questions"));
check("a numbered list", checkReply("١. المنيو\n2. الحجز", ctx).issues.some((i) => i.code === "list"));
const rob = checkReply("يسعدني تواصلك معنا، لا تتردد في السؤال.", ctx);
check("robotic phrases are named", rob.issues.some((i) => i.code === "robotic" && /يسعدني/.test(i.note)));
check("revealing it is a bot", checkReply("أنا ذكاء اصطناعي وأقدر أساعدك", ctx).issues.some((i) => i.code === "reveal"));

const known = { ...ctx, known: { licence: "booking", activity: "عيد ميلاد", size: "4 أشخاص", staff: "الخميس 8 مساءً" } };
check("re-asking the party size", checkReply("تمام. كم شخص بتكونون؟", known).issues.some((i) => i.code === "reask"));
check("re-asking the time", checkReply("أبشر، أي ساعة تناسبك؟", known).issues.some((i) => i.code === "reask"));
check("mentioning the party without asking is fine", !checkReply("طاولة لأربعة الخميس ٨ مساءً، تمام.", known).issues.some((i) => i.code === "reask"));

check("a price not in the knowledge is invented", checkReply("الكنافة بـ25 درهم.", ctx).issues.some((i) => i.code === "invented"));
check("a price that is in the knowledge is fine", !checkReply("الكنافة بـ25 درهم.", { ...ctx, facts: "صنف: كنافة — 25 درهم" }).issues.some((i) => i.code === "invented"));
check("a number the customer said is fine", !checkReply("نجهّزها خلال ٢ ساعات.", { customer: "أبغاها خلال 2 ساعات" }).issues.some((i) => i.code === "invented"));
check("claims reads money, percent and durations", claims("خصم 10% والتوصيل خلال 2 ساعات والصينية بـ 1,200 درهم").sort().join(",") === ["10", "1200", "2"].sort().join(","), claims("خصم 10% والتوصيل خلال 2 ساعات والصينية بـ 1,200 درهم").join(","));

check("same opening as last time", checkReply("تمام، حجزت لكم.", { ...ctx, previous: "تمام، وصلت." }).issues.some((i) => i.code === "same-open"));
check("...alone is not worth a rewrite", !needsRewrite(checkReply("تمام، حجزت لكم.", { ...ctx, previous: "تمام، وصلت." })));
check("English to an Arabic customer", checkReply("Sure, you can book your table from this link.", ctx).issues.some((i) => i.code === "language"));
check("selling after a yes", checkReply("ممتاز! وعندنا كمان كيكة تحب تضيفها؟", { ...ctx, stage: 7 }).issues.some((i) => i.code === "oversell"));

const bad = checkReply("يسعدني! 1. السعر 999 درهم\n2. كم شخص؟ وأي ساعة؟", known);
check("several faults stack", bad.score <= 30, `${bad.score}`);
const prompt = rewritePrompt("x", bad, known);
check("the rewrite prompt lists every fault with its fix", bad.issues.every((i) => prompt.includes(i.fix)));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
