import { detectAutoresponder } from "../autoresponder";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.slice(0, 50).padEnd(52)} ${d}`); };

// Every one of these was actually sent to this account by another company's
// bot, and was replied to.
console.log("— ردود آلية حقيقية وصلت للحساب —");
for (const t of [
  "Welcome to clean24. How can i help you?",
  "Thank you for contacting hygiene plus. Our team will get back to you shortly.",
  "Thanks for reaching out to Golden Cleaning. We will contact you during business hours.",
  "Thank you for contacting KKA Cleaning services.",
  "لقد قمت بتوصيلك بفريقنا. سيتواصل معك أحد المختصين قريباً.",
  "شكراً لتواصلك معنا، سنعاود التواصل في أقرب وقت.",
] as const) {
  const v = detectAutoresponder(t, { secondsSinceOurMessage: 3, isFirstFromThem: true });
  check(t, v.isAuto, `${v.confidence} — ${v.signals[0] ?? ""}`);
}

console.log("\n— بشر حقيقيون: يجب ألّا يُصنَّفوا آليين —");
for (const t of [
  "السلام عليكم، كم سعر الخدمة؟",
  "ابغى اسجل شركتي بالضريبه",
  "مرحبا",
  "وش الاوراق المطلوبه؟",
  "اوك تمام ارسل لي التفاصيل",
] as const) {
  const v = detectAutoresponder(t, { secondsSinceOurMessage: 900 });
  check(t, !v.isAuto, `${v.confidence}`);
}

console.log("\n— الحالات الحدّية —");
// "Welcome to X" from a person who also asks something is a human.
const mixed = detectAutoresponder("Welcome to our office! How can I help you today with your tax?", { secondsSinceOurMessage: 600 });
check("قالب + سؤال بعد وقت = بشر", !mixed.isAuto, `${mixed.confidence}`);
// Speed alone must never be enough — an eager human replies fast too.
const fastHuman = detectAutoresponder("ايه تمام ابغى اعرف اكثر", { secondsSinceOurMessage: 2 });
check("رد سريع بلا قالب ليس آلياً", !fastHuman.isAuto, `${fastHuman.confidence}`);
// A menu is unambiguous whenever it arrives.
const menu = detectAutoresponder("للمبيعات اضغط 1 وللدعم اضغط 2", { secondsSinceOurMessage: 3000 });
check("قائمة خيارات آلية مهما تأخرت", menu.isAuto, `${menu.confidence}`);
check("نص فارغ لا يُصنَّف", !detectAutoresponder("").isAuto);

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
