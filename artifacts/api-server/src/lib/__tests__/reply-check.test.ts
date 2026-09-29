import { checkReply, needsRewrite, claims, rewritePrompt } from "../reply-check";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };
const ctx = { customer: "عندنا شركة مقاولات فري زون، كم تاخذون؟" };

const good = checkReply("مقاولات بفري زون، التسعير عندكم يختلف حسب عدد المشاريع المفتوحة. كم مشروع شغّال الحين؟", ctx);
check("a good reply scores 100", good.score === 100 && good.issues.length === 0, JSON.stringify(good.issues));
check("...and is not rewritten", !needsRewrite(good));

check("too long", checkReply("سطر\nسطر\nسطر\nسطر\nسطر", ctx).issues.some((i) => i.code === "long"));
check("two questions", checkReply("رخصتكم وين؟ وكم فاتورة؟", ctx).issues.some((i) => i.code === "questions"));
check("a numbered list", checkReply("١. التسجيل\n2. الإقرار", ctx).issues.some((i) => i.code === "list"));
const rob = checkReply("يسعدني تواصلك معنا، لا تتردد في السؤال.", ctx);
check("robotic phrases are named", rob.issues.some((i) => i.code === "robotic" && /يسعدني/.test(i.note)));
check("revealing it is a bot", checkReply("أنا ذكاء اصطناعي وأقدر أساعدك", ctx).issues.some((i) => i.code === "reveal"));

const known = { ...ctx, known: { licence: "freezone", activity: "مقاولات" } };
check("re-asking the licence", checkReply("تمام. رخصتك مين لاند ولا فري زون؟", known).issues.some((i) => i.code === "reask"));
check("mentioning the licence without asking is fine", !checkReply("بما إنك فري زون، الالتزامات أخف.", known).issues.some((i) => i.code === "reask"));

check("a price not in the knowledge is invented", checkReply("الباقة بـ1500 درهم شهرياً.", ctx).issues.some((i) => i.code === "invented"));
check("a price that is in the knowledge is fine", !checkReply("الباقة بـ1500 درهم شهرياً.", { ...ctx, facts: "الباقة الأساسية 1500 درهم شهرياً" }).issues.some((i) => i.code === "invented"));
check("a number the customer said is fine", !checkReply("٤٠ فاتورة بالشهر حجم مريح.", { customer: "عندي 40 فاتورة بالشهر" }).issues.some((i) => i.code === "invented"));
check("claims reads money, percent and durations", claims("خصم 10% والتسليم خلال 5 أيام بسعر 2,000 درهم").sort().join(",") === ["10", "2000", "5"].sort().join(","), claims("خصم 10% والتسليم خلال 5 أيام بسعر 2,000 درهم").join(","));

check("same opening as last time", checkReply("تمام، نبدأ بالتسجيل.", { ...ctx, previous: "تمام، وصلت." }).issues.some((i) => i.code === "same-open"));
check("...alone is not worth a rewrite", !needsRewrite(checkReply("تمام، نبدأ بالتسجيل.", { ...ctx, previous: "تمام، وصلت." })));
check("English to an Arabic customer", checkReply("Sure, we can help with your registration today.", ctx).issues.some((i) => i.code === "language"));
check("selling after a yes", checkReply("ممتاز! وعندنا خصم على الباقة السنوية.", { ...ctx, stage: 7 }).issues.some((i) => i.code === "oversell"));

const bad = checkReply("يسعدني! 1. السعر 999 درهم\n2. رخصتك؟ ونشاطك؟", known);
check("several faults stack", bad.score <= 30, `${bad.score}`);
const prompt = rewritePrompt("x", bad, known);
check("the rewrite prompt lists every fault with its fix", bad.issues.every((i) => prompt.includes(i.fix)));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
