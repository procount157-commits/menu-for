import { extractFacts, nextStage, cardText, STAGES } from "../lead-card";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// ── Reading the customer ─────────────────────────────────────────
let f = extractFacts("ابغى احجز طاولة لـ٤ أشخاص يوم الخميس الساعة ٨ المسا، عيد ميلاد بنتي");
check("mode: a booking", f.licence === "booking");
check("party size from Arabic-Indic digits", f.size === "4 أشخاص", f.size);
check("day and time", f.staff === "الخميس 8 مساءً", f.staff);
check("occasion: a birthday", f.activity === "عيد ميلاد");

f = extractFacts("عندكم توصيل للبرشاء؟ وعندي حساسية من المكسرات");
check("mode: delivery", f.licence === "delivery");
check("the area, through «لل»", f.taxStatus === "البرشاء", f.taxStatus);
check("an allergy", f.accountant === "حساسية مكسرات", f.accountant);
check("what they ask about", f.pain === "يسأل عن التوصيل");

check("a tray for a date is a pre-order", extractFacts("ابي اوصي على صينية كنافة للجمعة 5 مساءً").licence === "preorder");
check("...with its day", extractFacts("ابي اوصي على صينية كنافة للجمعة 5 مساءً").staff === "الجمعة 5 مساءً");
check("crowded now is the queue", extractFacts("فيه زحمة الحين؟ احنا ٦ نفر").licence === "queue");
check("...and the party", extractFacts("فيه زحمة الحين؟ احنا ٦ نفر").size === "6 أشخاص");
check("takeaway is pickup", extractFacts("ابغى ٣ برجر سفري").licence === "pickup");
check("a count of items is not a party", !extractFacts("ابغى ٣ برجر سفري").size);
check("a count of people is not a time", !extractFacts("احنا ٤ أشخاص").staff);
check("English: a table for two tonight", extractFacts("table for 2 tonight at 9pm").size === "شخصين" && extractFacts("table for 2 tonight at 9pm").staff === "الليلة 9 مساءً");
check("a neighbourhood before its city", extractFacts("Do you deliver to Dubai Marina?").taxStatus === "المارينا");
check("vegetarian", extractFacts("نباتيين، فيه أكل بدون لحم؟").accountant === "نباتي");
check("asking a price", extractFacts("بكم الكنافة؟").pain === "يسأل عن السعر");
check("Chinese food is not a tray", extractFacts("مطعم صيني عندكم؟").licence !== "preorder");

check("a price objection", extractFacts("والله غالي شوي").objection === "غالي");
check("asking for a discount", extractFacts("فيه خصم؟").objection === "يطلب خصماً");
check("a deferral", extractFacts("خلني أشوف بعدين").objection === "يؤجّل");
check("'ثبت الحجز' is a go-ahead", extractFacts("تمام ثبت الحجز").agreed === true);
check("'على بركة الله' is a go-ahead", extractFacts("على بركة الله").agreed === true);
check("'كيف أحجز؟' is a question, not a go-ahead", !extractFacts("حلو، كيف أحجز؟").agreed);
check("'متى نجي' without a mark is still a question", !extractFacts("طيب متى نجي").agreed);
check("'بجي' as a statement is a go-ahead", extractFacts("تمام بجي بعد ساعة").agreed === true);
check("'موافق' is a yes even inside a question", extractFacts("موافق، متى أدفع العربون؟").agreed === true);
check("a bare greeting says nothing", Object.keys(extractFacts("السلام عليكم")).length === 0);
check("'عليكم' does not read as anything", Object.keys(extractFacts("وعليكم السلام ورحمة الله")).length === 0);

// ── The stage ────────────────────────────────────────────────────
const none = { licence: null, activity: null, size: null, pain: null, agreedAt: null };
check("first message: open", nextStage(1, none, "greeting", 1, {}) === 1);
check("second message with nothing known: discovery", nextStage(1, none, "question", 2, {}) === 2);
check("two facts known: details", nextStage(2, { ...none, licence: "booking", size: "4 أشخاص" }, "question", 3, {}) === 3);
check("a question named: the next step", nextStage(3, { ...none, licence: "booking", pain: "يبي يحجز" }, "question", 4, {}) === 4);
check("wants it now: the order", nextStage(4, { ...none, pain: "يسأل عن السعر" }, "interested", 5, {}) === 5);
check("an objection after the step: objection", nextStage(5, { ...none, pain: "يسأل عن السعر" }, "question", 6, { objection: "غالي" }) === 6);
check("...which passes with the next message", nextStage(6, { ...none, pain: "يسأل عن السعر" }, "question", 7, {}) === 5);
check("an objection before the step is not stage 6", nextStage(2, none, "question", 3, { objection: "غالي" }) === 2);
check("a go-ahead: confirm, from anywhere", nextStage(3, none, "question", 4, { agreed: true }) === 7);
check("...and it stays confirmed", nextStage(7, { ...none, agreedAt: new Date() }, "question", 9, {}) === 7);
check("a complaint does not move the conversation", nextStage(4, { ...none, pain: "x" }, "complaint", 5, {}) === 4);
check("the stage never goes backwards on a quiet message", nextStage(5, { ...none, pain: "x" }, "greeting", 6, {}) === 5);

// ── The card in the prompt ───────────────────────────────────────
const card: any = { stage: 4, licence: "booking", activity: "عيد ميلاد", size: "4 أشخاص", staff: "الخميس 8 مساءً",
  taxStatus: null, accountant: null, pain: "يبي يحجز", objection: null };
const t = cardText(card);
check("the card names what is known", /حجز/.test(t) && /4 أشخاص/.test(t) && /الخميس 8 مساءً/.test(t) && /عيد ميلاد/.test(t));
const partial = cardText({ ...card, size: null, staff: null, stage: 3 });
check("...and what this kind of request still needs", /لم تعرف بعد: العدد، الوقت/.test(partial), partial.split("\n")[2]);
check("...but not what is known", !/لم تعرف بعد[^\n]*طلب ولا دور/.test(partial));
check("a delivery asks for the area, not the party", /لم تعرف بعد: المنطقة/.test(cardText({ ...card, licence: "delivery", size: null, staff: null, stage: 2 })));
check("...and the stage with its goal", new RegExp(`المرحلة الآن: 4 — ${STAGES[3]!.name}`).test(t) && /رابط واحد/.test(t));
check("...and forbids re-asking", /لا تسأل عمّا فيها/.test(t));
check("an allergy is never reassured", /لا تطمئنه/.test(cardText({ ...card, accountant: "حساسية مكسرات" })));
const closed = cardText({ ...card, stage: 7 });
check("a confirmed card stops the offering", /وافق/.test(closed) && !/لم تعرف بعد/.test(closed));
const obj = cardText({ ...card, stage: 6, objection: "غالي" });
check("an objection is quoted", /اعترض للتو: «غالي»/.test(obj));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
