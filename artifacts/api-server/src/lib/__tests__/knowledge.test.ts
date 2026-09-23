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

console.log("\n— أسئلة خارج النطاق: الصواب ألا يجيب —");
for (const q of [
  // Overlaps the pool entry on "خدمة" alone — one word out of four. This was
  // answered, confidently and wrongly, with the swimming-pool price.
  "هل عندكم خدمة نقل اثاث؟",
  "ممكن تصلحون المكيف؟",
  "السلام عليكم",
  "كم عمر الشركة؟",
] as const) {
  const a = await answerFromKnowledge(USER, q);
  check(q, a.reply === null, a.reply ? `أجاب خطأً: ${a.reply.slice(0, 40)}` : `رفض (${a.reason})`);
}

console.log("\n— الكلمات المفتاحية —");
await db.insert(knowledgeBaseTable).values({
  userId: USER, title: "التوصيل", content: "نصل إليك خلال ساعتين داخل المدينة.",
  keywords: "دليفري توصيل ارسال",
});
check("مرادف عامي في الكلمات المفتاحية يُطابق", (await topTitle("كم ياخذ الدليفري؟")) === "التوصيل");

console.log("\n— بلا مزوّد نماذج —");
const a = await answerFromKnowledge(USER, "كم سعر الفيلا؟");
check("يجيب من قاعدة المعرفة مباشرة", a.reply !== null && a.provider === "kb", `provider=${a.provider}`);
check("  ويذكر أي عنصر استُخدم", a.kbIds.length > 0, `kb=${a.kbIds.join(",")}`);

await clean();
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
