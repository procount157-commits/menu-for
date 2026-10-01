import { harvest, interviewPrompt, nextQuestion, opening, QUESTIONS, STOP } from "../onboarding";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// ── The questions ────────────────────────────────────────────────
check("ten questions", QUESTIONS.length === 10);
check("the opening asks the first one and nothing else", opening("شمّة").includes(QUESTIONS[0]!) && !opening("شمّة").includes(QUESTIONS[1]!));
check("after three answers the fourth is next", nextQuestion(3)?.n === 4);
check("after ten there is no next", nextQuestion(10) === null);
check("'خلاص' stops it", STOP.test("خلاص") && STOP.test("  كفاية. ") && !STOP.test("خلاص عندي سؤال"));

const p = interviewPrompt({ name: "شمّة", persona: "مديرة" }, 3, false);
check("the prompt names the next question", p.includes(`رقم ٤: ${QUESTIONS[3]}`));
check("...and insists on one at a time", /سؤال واحد فقط/.test(p));
check("...and never on the closing format", !p.includes("[الملف]"));
const last = interviewPrompt(null, 10, true);
check("the closing prompt asks for the blocks", last.includes("[الملف]") && last.includes("[/معرفة]"));

// ── Reading the closing message ──────────────────────────────────
const text = `شكراً لك.
[الملف]
الاسم: مطعم بيت الجدة
النشاط: مطعم إماراتي شعبي
الوصف: مطعم في دبي يخدم العوائل.
يتميز بالهريس والمجبوس.
القيود: لا يعد بوقت توصيل.
لا يذكر خصماً غير مكتوب.
[/الملف]
[معرفة]
عنوان: الطلب المسبق للعزايم
محتوى: نجهّز صواني العزايم بطلب مسبق.
يحتاج يوماً واحداً قبل الموعد.
---
عنوان: ساعات العمل
محتوى: من ٩ إلى ٦، السبت إلى الخميس.
---
عنوان: بلا محتوى
[/معرفة]
كتبتُ الملف، راجعه في صفحة المعرفة.`;
const h = harvest(text)!;
check("the profile is read", h.profile.name === "مطعم بيت الجدة" && h.profile.industry === "مطعم إماراتي شعبي");
check("...multi-line fields kept whole", h.profile.description?.includes("يتميز بالهريس") === true && h.profile.guardrails?.includes("لا يذكر خصماً") === true);
check("...and nothing bleeds between fields", !h.profile.description?.includes("القيود"));
check("two entries, the empty one dropped", h.entries.length === 2, `${h.entries.length}`);
check("...with multi-line content", h.entries[0]?.content.includes("يوماً واحداً") === true);
check("a normal reply is not a harvest", harvest("سؤال ٤: من زباينكم عادةً؟") === null);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
