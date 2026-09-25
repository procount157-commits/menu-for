import { retrieve, answerFromKnowledge } from "../knowledge";
import { db, knowledgeBaseTable, businessProfileTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(52)} ${d}`); };

async function clean() {
  await db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.userId, USER));
  await db.delete(businessProfileTable).where(eq(businessProfileTable.userId, USER));
}
await clean();

await db.insert(knowledgeBaseTable).values([
  { userId: USER, title: "الأسعار", content: "تنظيف شقة غرفتين 250 درهم. فيلا 600 درهم. تنظيف السجاد 15 درهم للمتر المربع." },
  { userId: USER, title: "مواعيد العمل", content: "نعمل من السبت إلى الخميس، من 8 صباحاً حتى 8 مساءً. الجمعة إجازة." },
  { userId: USER, title: "مناطق التغطية", content: "نغطي دبي والشارقة فقط. لا نغطي أبوظبي أو العين حالياً." },
  { userId: USER, title: "طرق الدفع", content: "نقبل الدفع نقداً أو تحويل بنكي بعد إتمام الخدمة. لا نطلب دفعة مقدمة." },
  { userId: USER, title: "تنظيف المسابح", content: "نوفر خدمة تنظيف وصيانة المسابح للفلل بسعر 350 درهم للزيارة." },
]);

async function topTitle(q: string) {
  const r = await retrieve(USER, q);
  return r[0]?.entry.title ?? null;
}

console.log("— أسئلة داخل نطاق المعرفة —");
for (const [q, want] of [
  ["كم سعر تنظيف شقة غرفتين؟", "الأسعار"],
  // A question mark used to stay glued to the word, so "الجمعه؟" never matched
  // "الجمعه" and three questions in a row found nothing.
  ["هل تشتغلون الجمعة؟", "مواعيد العمل"],
  ["هل تغطون ابوظبي؟", "مناطق التغطية"],
  ["عندكم تنظيف مسابح؟", "تنظيف المسابح"],
  // "ادفع" and "الدفع" are the same root wearing different affixes.
  ["كيف ادفع؟", "طرق الدفع"],
  ["ابغى اعرف اسعاركم", "الأسعار"],
  ["ودي احجز تنظيف فيلا", "الأسعار"],
] as const) {
  const got = await topTitle(q);
  check(q, got === want, `→ ${got ?? "لا شيء"}`);
}

console.log("\n— أسئلة خارج النطاق: يحاور دون أن يخترع —");
// The bot is a salesperson, so silence is the wrong answer to a question it
// cannot answer — it should engage and route. What it must never do is invent
// the missing fact, so that is what these assert. Retrieval still refuses to
// match (checked separately below); the reply carries no specific claim.
const INVENTED = /\d+\s*(درهم|ريال|dollar|aed|٪|%)|يوم\s*\d|خلال\s*\d+\s*(يوم|ساعة|اسبوع)/i;
for (const q of [
  "هل عندكم خدمة نقل اثاث؟",
  "ممكن تصلحون المكيف؟",
  "كم عمر الشركة؟",
] as const) {
  const a = await answerFromKnowledge(USER, q);
  const invented = a.reply ? INVENTED.test(a.reply) : false;
  check(q, !invented, a.reply ? (invented ? `اخترع: ${a.reply.slice(0, 50)}` : "حاور بلا اختراع") : "صامت");
}

// Retrieval itself must still find nothing for these — the reply engages on
// the profile, not on a wrongly-matched entry.
for (const q of ["هل عندكم خدمة نقل اثاث؟", "ممكن تصلحون المكيف؟"] as const) {
  check(`  الاسترجاع لا يُطابق: ${q.slice(0, 22)}`, (await retrieve(USER, q)).length === 0);
}

console.log("\n— الكلمات المفتاحية —");
await db.insert(knowledgeBaseTable).values({
  userId: USER, title: "التوصيل", content: "نصل إليك خلال ساعتين داخل المدينة.",
  keywords: "دليفري توصيل ارسال",
});
check("مرادف عامي في الكلمات المفتاحية يُطابق", (await topTitle("كم ياخذ الدليفري؟")) === "التوصيل");

console.log("\n— الإجابة —");
const a = await answerFromKnowledge(USER, "كم سعر الفيلا؟");
// Deliberately provider-agnostic: with a model configured the answer is
// written in its own words, without one the entry is sent verbatim. Both are
// correct, and asserting one made the test fail the moment a key was added.
check("يجيب (نموذج أو نص المعلومة)", a.reply !== null && ["kb", "gemini", "groq", "zhipu", "anthropic", "qwen", "openrouter", "deepseek", "moonshot", "siliconflow"].includes(a.provider), `provider=${a.provider}`);
check("  ويذكر أي عنصر استُخدم", a.kbIds.length > 0, `kb=${a.kbIds.join(",")}`);

await clean();
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
