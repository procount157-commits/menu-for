import { extractFacts, nextStage, cardText, STAGES } from "../lead-card";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// ── Reading the customer ─────────────────────────────────────────
let f = extractFacts("رخصتنا فري زون في عجمان، شركة مقاولات، يطلع عندنا تقريباً ٤٠ فاتورة بالشهر و١٢ موظف");
check("licence: free zone", f.licence === "freezone");
check("activity: contracting", f.activity === "مقاولات");
check("size from Arabic-Indic digits", f.size === "40 فاتورة بالشهر", f.size);
check("staff count", f.staff === "12 موظف", f.staff);

f = extractFacts("احنا مين لاند، مطعم، وعندي محاسب بس فيه غرامات متراكمة من الضريبة");
check("licence: mainland", f.licence === "mainland");
check("activity: restaurant", f.activity === "مطاعم");
check("has an accountant", f.accountant === "عنده محاسب");
check("pain: fines", f.pain === "غرامات");
check("...and 'عندي محاسب' is also the objection", f.objection === "عنده محاسب");

check("a price objection", extractFacts("والله غالي شوي").objection === "غالي");
check("a deferral", extractFacts("خلني أشوف بعدين").objection === "يؤجّل");
check("'send me details' is an objection, not a fact", extractFacts("ارسل لي التفاصيل").objection === "يطلب التفاصيل");
check("an agreement", extractFacts("تمام موافق، نبدأ من الأحد").agreed === true);
check("'على بركة الله' is an agreement", extractFacts("على بركة الله").agreed === true);
check("a bare greeting says nothing", Object.keys(extractFacts("السلام عليكم")).length === 0);
check("'عليكم' does not read as anything", !extractFacts("وعليكم السلام ورحمة الله").activity);
check("unregistered for tax", extractFacts("لا مو مسجلين في الضريبة").taxStatus === "غير مسجل في الضريبة");
check("registered for tax", extractFacts("مسجلين بالضريبة من سنتين").taxStatus === "مسجل في الضريبة");
check("revenue as a size", /مليون/.test(extractFacts("ايرادنا تقريبا ٢ مليون").size ?? ""));

// ── The stage ────────────────────────────────────────────────────
const none = { licence: null, activity: null, size: null, pain: null, agreedAt: null };
check("first message: open", nextStage(1, none, "greeting", 1, {}) === 1);
check("second message with nothing known: discovery", nextStage(1, none, "question", 2, {}) === 2);
check("two facts known: diagnosis", nextStage(2, { ...none, licence: "freezone", activity: "مقاولات" }, "question", 3, {}) === 3);
check("a pain named: value", nextStage(3, { ...none, licence: "freezone", pain: "غرامات" }, "question", 4, {}) === 4);
check("interest: offer", nextStage(4, { ...none, pain: "غرامات" }, "interested", 5, {}) === 5);
check("an objection after the offer: objection", nextStage(5, { ...none, pain: "غرامات" }, "question", 6, { objection: "غالي" }) === 6);
check("...which passes with the next message", nextStage(6, { ...none, pain: "غرامات" }, "question", 7, {}) === 5);
check("an objection before any value is not stage 6", nextStage(2, none, "question", 3, { objection: "غالي" }) === 2);
check("agreement: close, from anywhere", nextStage(3, none, "question", 4, { agreed: true }) === 7);
check("...and it stays closed", nextStage(7, { ...none, agreedAt: new Date() }, "question", 9, {}) === 7);
check("a complaint does not move the sale", nextStage(4, { ...none, pain: "x" }, "complaint", 5, {}) === 4);
check("the stage never goes backwards on a quiet message", nextStage(5, { ...none, pain: "x" }, "greeting", 6, {}) === 5);

// ── The card in the prompt ───────────────────────────────────────
const card: any = { stage: 4, licence: "freezone", activity: "مقاولات", size: "40 فاتورة بالشهر", staff: null,
  taxStatus: null, accountant: null, pain: "غرامات", objection: null };
const t = cardText(card);
check("the card names what is known", /فري زون/.test(t) && /مقاولات/.test(t) && /غرامات/.test(t));
const partial = cardText({ ...card, size: null, pain: null, stage: 3 });
check("...and what is still missing", /لم تعرف بعد: الحجم، ما يقلقه/.test(partial), partial.split("\n")[2]);
check("...but not what is known", !/لم تعرف بعد[^\n]*الرخصة/.test(partial));
check("...and the stage with its goal", new RegExp(`المرحلة الآن: 4 — ${STAGES[3]!.name}`).test(t) && /لا سعر بعد/.test(t));
check("...and forbids re-asking", /لا تسأل عمّا فيها/.test(t));
const closed = cardText({ ...card, stage: 7 });
check("a closed card stops the selling", /وافق/.test(closed) && !/لم تعرف بعد/.test(closed));
const obj = cardText({ ...card, stage: 6, objection: "غالي" });
check("an objection is quoted", /اعترض للتو: «غالي»/.test(obj));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
