import { classifyIntent, normalizeArabic, type Intent } from "../intent";

let pass = 0, total = 0;
const fails: string[] = [];

function expect(text: string, want: Intent) {
  total++;
  const got = classifyIntent(text);
  const ok = got.intent === want;
  if (ok) pass++; else fails.push(`  "${text}"  →  ${got.intent} (أردنا ${want}) [${got.matched.join("،")}]`);
  console.log(`${ok ? "✅" : "❌"} ${text.slice(0, 40).padEnd(42)} → ${got.intent.padEnd(15)} ${got.confidence}`);
}

console.log("— طلب الإيقاف يتقدّم على كل شيء —");
expect("ايقاف", "opt_out");
expect("الغاء الاشتراك", "opt_out");
expect("لا تراسلني مرة ثانية", "opt_out");
expect("stop", "opt_out");
expect("شيلني من القائمة لو سمحت", "opt_out");
// Even mixed with a question, a stop request is still a stop request.
expect("كم السعر؟ وايقاف الرسائل بعدها", "opt_out");

console.log("\n— الشكاوى تسبق كل شيء عدا الإيقاف —");
expect("الطلب وصل متأخر وتالف", "complaint");
expect("عندي مشكله في الطلب", "complaint");
expect("الخدمه سيئه جدا", "complaint");
expect("ابغى ارجاع المنتج", "complaint");

console.log("\n— عدم الاهتمام —");
expect("لا شكرا", "not_interested");
expect("مو مهتم", "not_interested");
expect("ما ابغى شي", "not_interested");
expect("not interested", "not_interested");

console.log("\n— نية الشراء تتقدّم على السؤال —");
// The case the free model got wrong.
expect("ابغى اطلب اثنين كيف الدفع", "interested");
expect("ابي اشتري منتجين", "interested");
expect("كيف اطلب؟", "interested");
expect("ارسل لي التفاصيل", "interested");
expect("موافق", "interested");
expect("متى التوصيل للشارقة", "interested");

console.log("\n— الأسئلة —");
expect("كم السعر", "question");
expect("هل يوجد توصيل", "question");
expect("وش الالوان المتوفره؟", "question");
expect("how much is it", "question");

console.log("\n— التحية —");
expect("السلام عليكم", "greeting");
expect("مرحبا", "greeting");
expect("شكرا لك", "greeting");

console.log("\n— غير الواضح —");
expect("ok", "unclear");
expect("👍", "unclear");
expect("", "unclear");

console.log("\n— مصايد المطابقة الجزئية —");
// Every one of these was a real miss before cue matching respected word
// boundaries: "كم" hides inside عليكم، لكم، كمية and الحكم.
expect("السلام عليكم ورحمة الله", "greeting");
expect("شكرا لكم على الخدمة", "greeting");
expect("ابغى كمية كبيرة", "interested");
expect("الحكم عادل", "unclear");
expect("بكم القطعة؟", "question");
expect("وكم سعر التوصيل", "question");

console.log("\n— التطبيع العربي —");
total++; const n1 = normalizeArabic("أَهْلاً وَسَهْلاً") === "اهلا وسهلا";
if (n1) pass++; console.log(`${n1 ? "✅" : "❌"} التشكيل والهمزات تُطبَّع`);
total++; const n2 = normalizeArabic("إيقــاف") === "ايقاف";
if (n2) pass++; console.log(`${n2 ? "✅" : "❌"} التطويل يُزال`);
total++; const n3 = normalizeArabic("٥ قطع") === "5 قطع";
if (n3) pass++; console.log(`${n3 ? "✅" : "❌"} الأرقام العربية تُوحَّد`);
// Spelling variants must not defeat matching.
total++; const n4 = classifyIntent("إلغاء الإشتراك").intent === "opt_out";
if (n4) pass++; console.log(`${n4 ? "✅" : "❌"} الهمزات لا تُفشل المطابقة`);

console.log("\n— الثقة —");
total++; const c1 = classifyIntent("ايقاف").confidence > classifyIntent("ممكن تفكر في ايقاف هذا الشي يوم من الايام").confidence;
if (c1) pass++; console.log(`${c1 ? "✅" : "❌"} الرسالة القصيرة الصريحة أعلى ثقة من الإشارة العابرة`);

if (fails.length) { console.log("\nالإخفاقات:"); fails.forEach(f => console.log(f)); }
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
