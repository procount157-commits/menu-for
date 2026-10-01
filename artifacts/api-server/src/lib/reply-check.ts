// ── The check before a reply leaves ──────────────────────────────
// The writing skill tells the model the rules; this makes sure it followed
// them. Every rule here is one the owner has already complained about or a
// mistake that loses a customer: a reply that runs to seven lines, asks three
// questions, opens with «يسعدني», asks how many people when the card already
// says four, or quotes a price that is nowhere on the shop's own menu.
//
// Rules, not a model: they run on every reply for free, and a rewrite — the
// one extra call — happens only when something is actually wrong.

import { normalizeArabic } from "./intent";

export interface CheckContext {
  /** What the customer just wrote. */
  customer: string;
  /** The employee's previous reply in this thread, if any. */
  previous?: string | null;
  /** What the card already knows. */
  known?: { licence?: string | null; activity?: string | null; size?: string | null; staff?: string | null };
  /** 1..7 */
  stage?: number;
  /** Everything the reply may state as fact — the knowledge entries used. */
  facts?: string;
}

export interface Issue { code: string; note: string; fix: string }
export interface CheckResult { score: number; issues: Issue[] }

// The phrases the writing skill forbids, normalised. They are what makes a
// reply read as a template, and a customer who has seen one bot has seen
// them all.
const ROBOTIC = [
  "يسعدني", "يسرني", "لا تتردد", "نحن هنا لخدمتك", "سأكون سعيدا", "شكرا لتواصلك", "نتشرف",
  "في انتظار ردكم", "اتمني ان يكون ذلك واضحا", "دعني اوضح لك", "بناء علي ما ذكرت", "هل هناك اي شيء اخر",
  "لا تتردد في التواصل", "بكل سرور", "عزيزي العميل", "عزيزي الزبون", "عميلنا العزيز",
];
const SELF_REVEAL = /(ذكاء اصطناعي|نموذج لغوي|كبوت|انا بوت|as an ai|language model|chatgpt|openai)/i;

const lines = (t: string) => t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
const firstWord = (t: string) => normalizeArabic(t).split(/\s+/)[0] ?? "";
const arabicShare = (t: string) => {
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  return letters ? (t.match(/[؀-ۿ]/g) ?? []).length / letters : 0;
};

/** Money, percentages and durations in a text, as bare numbers. */
export function claims(t: string): string[] {
  // Thousands separators first: the normaliser turns punctuation into spaces
  // and "2,000" would come out as "2" and "000".
  t = t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/(\d)[,٬](\d{3})/g, "$1$2");
  const n = normalizeArabic(t);
  const out = new Set<string>();
  const re = /(\d[\d,.]*)\s*(درهم|ريال|aed|sar|usd|\$|%|٪|بالمئه|بالمائه|يوم|ايام|اسبوع|اسابيع|شهر|اشهر|ساعه|ساعات)/giu;
  for (const m of n.matchAll(re)) out.add(m[1]!.replace(/[,.]0+$/, "").replace(/,/g, ""));
  for (const m of t.matchAll(/(\d[\d,.]*)\s*%/g)) out.add(m[1]!.replace(/,/g, ""));
  return [...out];
}

export function checkReply(reply: string, ctx: CheckContext): CheckResult {
  const issues: Issue[] = [];
  const text = reply.trim();
  const n = normalizeArabic(text);

  const ls = lines(text);
  if (ls.length > 4 || text.length > 480) {
    issues.push({ code: "long", note: `طويل (${ls.length} أسطر، ${text.length} حرفاً)`, fix: "اختصره إلى سطرين أو ثلاثة، وقل المقصود فقط." });
  }
  const questions = (text.match(/[؟?]/g) ?? []).length;
  if (questions > 1) {
    issues.push({ code: "questions", note: `${questions} أسئلة في رسالة واحدة`, fix: "اترك سؤالاً واحداً فقط — الأهم للمرحلة." });
  }
  if (ls.some((l) => /^(\d+[.)]|[-•*▪])\s+/.test(l)) || /^#+\s/m.test(text)) {
    issues.push({ code: "list", note: "ترقيم أو نقاط أو عناوين", fix: "اكتبها جملاً متصلة كرسالة واتساب، بلا ترقيم." });
  }
  const robotic = ROBOTIC.filter((p) => n.includes(normalizeArabic(p)));
  if (robotic.length) {
    issues.push({ code: "robotic", note: `عبارات آلية: ${robotic.join("، ")}`, fix: `احذف: ${robotic.join("، ")}. ابدأ من شيء قاله العميل.` });
  }
  if (SELF_REVEAL.test(text)) {
    issues.push({ code: "reveal", note: "يشير إلى أنه آلة", fix: "لا تذكر أنك برنامج أو ذكاء اصطناعي." });
  }

  // Asking for what the card already holds.
  const k = ctx.known ?? {};
  const asks = (re: RegExp) => ls.some((l) => /[؟?]/.test(l) && re.test(normalizeArabic(l)));
  if (k.licence && asks(/(توصيل ولا|سفري ولا|استلام ولا|ولا توصيل|ولا سفري|تطلب ولا تحجز|طلب ولا حجز|delivery or|pick ?up or)/)) {
    issues.push({ code: "reask", note: "يسأل عن نوع الطلب وهو معروف", fix: `نوع الطلب معروف (${k.licence}) — لا تسأل عنه، ابنِ عليه.` });
  }
  if (k.activity && asks(/(المناسبه|وش المناسبه|occasion)/)) {
    issues.push({ code: "reask", note: "يسأل عن المناسبة وهي معروفة", fix: `المناسبة معروفة (${k.activity}) — لا تسأل عنها.` });
  }
  if (k.size && asks(/(كم شخص|كم عددكم|كم نفر|كم واحد|كم بتكونون|عدد الاشخاص|how many)/)) {
    issues.push({ code: "reask", note: "يسأل عن العدد وهو معروف", fix: `العدد معروف (${k.size}) — لا تسأل عنه.` });
  }
  if (k.staff && asks(/(اي وقت|اي ساعه|الساعه كم|متي تبي|متي تحب|اي يوم|what time|which day)/)) {
    issues.push({ code: "reask", note: "يسأل عن الوقت وهو معروف", fix: `الوقت معروف (${k.staff}) — لا تسأل عنه.` });
  }

  // Numbers the shop never gave it: a price, a delivery fee, a wait in minutes.
  const allowed = new Set([...claims(ctx.facts ?? ""), ...claims(ctx.customer)]);
  const invented = claims(text).filter((c) => !allowed.has(c));
  if (invented.length) {
    issues.push({ code: "invented", note: `رقم غير موجود في معلومات المحل: ${invented.join("، ")}`, fix: "احذف الرقم. إن سُئلت عنه فقل «بتأكد لك من المحل» أو أرسل رابط المنيو." });
  }

  // Same opening word as last time reads as a template.
  if (ctx.previous && firstWord(text) && firstWord(text) === firstWord(ctx.previous)) {
    issues.push({ code: "same-open", note: `يبدأ بنفس كلمة الرد السابق («${text.split(/\s+/)[0]}»)`, fix: "ابدأ بكلمة مختلفة — من شيء قاله العميل الآن." });
  }

  // Answering Arabic in English or the reverse.
  const cAr = arabicShare(ctx.customer), rAr = arabicShare(text);
  if (ctx.customer.trim().length > 6 && ((cAr > 0.6 && rAr < 0.3) || (cAr < 0.2 && rAr > 0.6))) {
    issues.push({ code: "language", note: "بلغة غير لغة العميل", fix: cAr > 0.6 ? "العميل كتب عربياً — رُدّ بالعربية." : "العميل كتب إنجليزياً — رُدّ بالإنجليزية." });
  }

  // Offering more after a yes.
  if (ctx.stage === 7 && /(خصم|عرض خاص|عندنا كمان|جرب كمان|تبي تضيف|تحب تضيف|باقه|باقات)/.test(n)) {
    issues.push({ code: "oversell", note: "يعرض من جديد بعد أن وافق الزبون", fix: "الزبون وافق — أكّد التفاصيل في سطر فقط، بلا عرض جديد." });
  }

  const weights: Record<string, number> = { long: 15, questions: 15, list: 10, robotic: 20, reveal: 40, reask: 20, invented: 30, "same-open": 5, language: 30, oversell: 20 };
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + (weights[i.code] ?? 10), 0));
  return { score, issues };
}

/** Worth a rewrite: anything but a cosmetic same-opening. */
export function needsRewrite(r: CheckResult): boolean {
  return r.issues.some((i) => i.code !== "same-open");
}

/** The instruction the rewrite call gets: the draft, and exactly what is wrong with it. */
export function rewritePrompt(draft: string, r: CheckResult, ctx: CheckContext): string {
  return [
    "أنت تُراجع رد مضيّف المحل على واتساب قبل إرساله. أعد كتابته ليصلح المشكلات أدناه فقط، مع الحفاظ على معناه وهدفه ولهجته.",
    "اكتب الرد المصحّح وحده، بلا مقدمة ولا شرح ولا علامات تنصيص.",
    "",
    `رسالة الزبون: ${ctx.customer.slice(0, 600)}`,
    "",
    `الرد المقترح:\n${draft}`,
    "",
    "المشكلات وطريقة إصلاحها:",
    ...r.issues.map((i) => `- ${i.note} ← ${i.fix}`),
  ].join("\n");
}
