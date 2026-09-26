import { classifyDecision, MIN_EVIDENCE } from "../meeting";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(62)} ${d}`); };

// ── What the team may do on its own ──────────────────────────────
const behaviour = [
  "لا تذكر السعر قبل أن يخبرك بعدد فواتيره الشهرية.",
  "ابدأ بسؤال واحد عن نوع الرخصة قبل أي عرض.",
  "اعترف بالشكوى بكلمات العميل نفسه قبل أي شرح.",
  "نوّع افتتاحياتك ولا تبدأ كل رسالة بنفس التحية.",
  "اربط ما تعرضه بنشاطه هو لا بقائمة خدمات.",
];
for (const r of behaviour) {
  check(`سلوك يُطبَّق: «${r.slice(0, 34)}…»`, classifyDecision(r) === "behaviour");
}

// ── What it may only propose ─────────────────────────────────────
// Every one of these is a real sentence from the first meeting or a close
// variant. The one that froze follow-ups is the third.
const operational = [
  "أوقف إرسال أي رسائل جديدة حتى تُنظَّف قاعدة البيانات.",
  "جمّد المتابعات الثلاث المجدولة اليوم.",
  "لا يُوقِف أو يُرسل أي متابعة إلا بعد ما يقرأ تقرير فهد.",
  "لا ترسل أي رسالة حتى يصدر التقرير.",
  "خفّض الحد اليومي إلى النصف.",
  "علّق المتابعة لمن لم يفتح شيئاً.",
];
for (const r of operational) {
  check(`تشغيلي يُعرَض عليك: «${r.slice(0, 34)}…»`, classifyDecision(r) === "operational");
}

// The exact rule that deadlocked خالد — he waits for a report فهد never writes.
check("القاعدة التي جمّدت المتابعة فعلاً تُصنَّف تشغيلية",
  classifyDecision("لا يُوقِف أو يُرسل أي متابعة إلا بعد ما يقرأ تقرير فهد، ويكتفي بانتظار القرار.") === "operational",
  "لا تُطبَّق وحدها");

// ── The evidence gate ────────────────────────────────────────────
check("لا بد من نتائج مقيسة قبل أي قرار", MIN_EVIDENCE >= 3, `${MIN_EVIDENCE}`);
check("والعتبة ليست مرتفعة لدرجة تمنع الاجتماعات دائماً", MIN_EVIDENCE <= 12, `${MIN_EVIDENCE}`);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
