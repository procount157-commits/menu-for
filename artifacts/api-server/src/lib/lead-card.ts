// ── The lead card ─────────────────────────────────────────────────
// The conversation map tells the host to know where the conversation is,
// what it has already been told, and what the one goal of this message is.
// Until now it had to work all three out from the transcript on every reply,
// and a ten-message history rarely says "four people, Thursday at eight" in
// so many words — so it asked again, which is the single most reliable way
// to sound like a machine.
//
// So the facts are extracted by rules from the customer's own messages, the
// stage is computed from them, and both are written into the prompt as a
// card. Rules rather than a model call: extraction runs on every inbound
// message, the free tier cannot afford a second call per message, and the
// vocabulary — «توصيل», «كم شخص», «الخميس ٨ المسا», «حساسية» — is small and
// stable. What the rules miss the model still sees in the history; what they
// catch it no longer has to guess.
//
// The card's columns are Flow Hub's, kept so the table, the follow-up engine
// and the dashboards keep working. What each one holds for a shop:
//
//   licence    → how they want it: delivery, pickup, dine-in, booking, queue, pre-order
//   activity   → the occasion: a birthday, guests, a wedding…
//   size       → the party size
//   staff      → the day and time they want
//   taxStatus  → the area, for delivery
//   accountant → dietary needs and allergies
//   pain       → what they are asking about: price, delivery, hours, location…

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, leadCardsTable, waThreadMessagesTable, type LeadCard } from "@workspace/db";
import { normalizeArabic, type Intent } from "./intent";
import { logger } from "./logger";

// ── Facts ─────────────────────────────────────────────────────────

export type Mode = "delivery" | "pickup" | "dinein" | "booking" | "queue" | "preorder";

export interface LeadFacts {
  /** How they want it — see Mode. Stored in the `licence` column. */
  licence?: Mode;
  /** The occasion. */
  activity?: string;
  /** The party size. */
  size?: string;
  /** The day and time wanted. */
  staff?: string;
  /** The area, for delivery. */
  taxStatus?: string;
  /** Dietary needs and allergies. */
  accountant?: string;
  /** What they are asking about. */
  pain?: string;
  /** The objection raised in this message, if any. Transient. */
  objection?: string;
  /** This message is a go-ahead: book it, I'm coming, confirm. */
  agreed?: boolean;
}

// Patterns run on normalised text (see normalizeArabic): hamza forms folded
// to ا, ة to ه, ى/ئ to ي, digits Latin, punctuation gone, lower-case. They
// are written in that spelling. `\b` cannot be used — it only knows ASCII
// word characters, so it never finds the edge of an Arabic word — hence the
// lookarounds on letters and digits.
const B = "\\p{L}\\p{N}";
// A conjunction or a preposition is written attached — «وبكم», «فغالي»,
// «للخميس» — so one is allowed on the front of every match.
const W = (src: string) => new RegExp(`(?<![${B}])(?:[وفبل]|ال)?(?:${src})(?![${B}])`, "iu");

// Most specific first: «أوصّي على صينية توصيل للخميس» is a pre-order, not a delivery.
const MODES: Array<[RegExp, Mode]> = [
  [W("طلب مسبق|طلبيه|اوصي|توصيه|صينيه|صينيات|صواني|كيك(ه)? (ل|لعيد|ليوم)|pre ?order"), "preorder"],
  [W("احجز(ه|لي|ون)?|حجز|نحجز|تحجزون|موعد|مواعيد|ريزرف|reserv(e|ation)|book(ing)?"), "booking"],
  [W("دوري|الدور|دور|الصف|طابور|فيه زحمه|زحمه|فيه مكان|انتظار|queue|waiting ?list"), "queue"],
  [W("توصيل|توصلون|يوصل|دليفري|delivery|deliver"), "delivery"],
  [W("سفري|استلام|استلم|بستلم|من السياره|take ?away|pick ?up"), "pickup"],
  [W("بنجلس|نجلس|داخل المحل|في المحل|dine ?in"), "dinein"],
];

const OCCASIONS: Array<[RegExp, string]> = [
  [W("عيد ميلاد|ميلاد(ه|ي|ها)?|birthday"), "عيد ميلاد"],
  [W("زواج|عرس|ملكه|خطوب(ه|تي)|wedding|engagement"), "زواج أو ملكة"],
  [W("عروس(ه)?|bride"), "عروس"],
  [W("عزيم(ه)?|عزومه|ضيوف|وليم(ه)?|guests"), "عزيمة"],
  [W("تخرج|graduation"), "تخرّج"],
  [W("اجتماع|ميتنج|meeting"), "اجتماع عمل"],
  [W("افطار|سحور|رمضان|العيد"), "رمضان أو العيد"],
  [W("ذكري|anniversary"), "ذكرى"],
  [W("مولود|بيبي شاور|baby shower"), "مولود"],
];

const NEEDS: Array<[RegExp, string]> = [
  [W("بكم|كم سعر|كم السعر|السعر|اسعار|الاسعار|price|how much"), "يسأل عن السعر"],
  [W("توصلون|توصيل|دليفري|delivery"), "يسأل عن التوصيل"],
  [W("متي تفتحون|متي تسكرون|الدوام|مفتوحين|فاتحين|تفتحون|تسكرون|open|close"), "يسأل عن الساعات"],
  [W("وين موقعكم|وين مكانكم|موقعكم|العنوان|لوكيشن|location|where"), "يسأل عن الموقع"],
  [W("فيه مكان|فيه زحمه|زحمه|كم الانتظار|كم قدامي|دوري"), "يبي يجي الحين"],
  [W("احجز|حجز|موعد|book"), "يبي يحجز"],
  [W("المنيو|منيو|القائمه|وش عندكم|شو عندكم|menu"), "يبي المنيو"],
  [W("متوفر|موجود|عندكم"), "يسأل هل الصنف موجود"],
];

const OBJECTIONS: Array<[RegExp, string]> = [
  [W("غالي|مرتفع|كثير (علي|عليه)|expensive"), "غالي"],
  [W("خصم|كوبون|كود خصم|فيه عرض|عروض|discount|offer"), "يطلب خصماً"],
  [W("بعيد|ما توصلون|خارج المنطقه|too far"), "بعيد عن التوصيل"],
  [W("انتظار طويل|وايد انتظار|طولتوا|طول الانتظار|too long"), "الانتظار طويل"],
  [W("بعدين|مشغول|مو الحين|مب الحين|مش دلوقتي|لاحقا|later"), "يؤجّل"],
];

// A go-ahead comes in two strengths. «ثبّت الحجز» and «موافق» are a yes
// wherever they appear. «بجي» is a yes only as a statement — «متى أجي؟» and
// «كيف أحجز» are a customer asking a question, and reading them as a yes
// confirmed a booking nobody had made.
const AGREED_STRONG = W("موافق(ين)?|اتفقنا|ثبت(ه|لي)?( الحجز| الطلب)?|اكد(ه|لي)? (الحجز|الطلب)|احجز(ه)? لي|احجزلي|سجلني|علي بركه الله|deal|confirm(ed)?|book it");
const AGREED_SOFT   = W("بجي|بنجي|نجي|نجيكم|جايينكم|خلاص (احجز|نطلب|بطلب)|تمام احجز|اوكي احجز|we re coming|see you");
const ASKING        = W("كيف|متي|وش|شو|شلون|هل|ايش|ليش|كم|وين|how|when|what|where");

// Party size: a count with a word for people, or a table for a number.
const PARTY      = /(?<![\p{N}])(\d{1,3})\s*(اشخاص|شخص|نفر|انفار|افراد|ضيوف|ضيف|people|persons|pax|guests)(?![\p{L}])/iu;
const PARTY_TBL  = /(طاوله|حجز|table for)\s*(ل)?\s*(\d{1,3})(?![\p{N}])/iu;
const PARTY_WORD = W("شخصين|لشخصين|اثنين|ثنين|two of us");
const PARTY_ONE  = W("لوحدي|بروحي|بس انا|just me");

// The day, as said, and how it is shown back.
const DAYS: Array<[RegExp, string]> = [
  [W("بعد بكره|بعد باكر|بعد بكرا"), "بعد بكرة"],
  [W("بكره|باكر|بكرا|tomorrow"), "بكرة"],
  [W("الليله|tonight"), "الليلة"],
  [W("اليوم|today"), "اليوم"],
  [W("الحين|now"), "الحين"],
  [W("السبت|saturday"), "السبت"], [W("الاحد|sunday"), "الأحد"], [W("الاثنين|monday"), "الاثنين"],
  [W("الثلاثاء|tuesday"), "الثلاثاء"], [W("الاربعاء|wednesday"), "الأربعاء"], [W("الخميس|thursday"), "الخميس"],
  [W("الجمعه|friday"), "الجمعة"],
];
// A clock time needs a marker — «الساعة» before it or a period after it — or
// every «٤ أشخاص» would read as four o'clock.
const CLOCK = /(?:(الساعه|ساعه|at)\s*)?(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(صباحا|الصبح|ص|مساء|المسا|مسا|بالليل|الليل|العصر|الظهر|م|pm|am)?(?![\p{L}\p{N}])/giu;
const PERIOD: Record<string, string> = { "صباحا": "صباحاً", "الصبح": "صباحاً", "ص": "صباحاً", am: "صباحاً", "مساء": "مساءً", "المسا": "مساءً", "مسا": "مساءً", "بالليل": "مساءً", "الليل": "مساءً", "م": "مساءً", pm: "مساءً", "العصر": "العصر", "الظهر": "الظهر" };

// Areas a UAE customer names for delivery, shown back in their usual spelling.
// Neighbourhoods before cities: «دبي مارينا» is the Marina.
const AREAS: Array<[RegExp, string]> = [
  [W("البرشاء|al barsha"), "البرشاء"], [W("الكرامه|karama"), "الكرامة"], [W("ديره|deira"), "ديرة"],
  [W("جميرا|jumeirah"), "جميرا"], [W("jlt|ابراج بحيرات جميرا"), "أبراج بحيرات جميرا"], [W("jvc|قريه جميرا"), "قرية جميرا"], [W("مارينا|المارينا|marina"), "المارينا"], [W("الخالديه|khalidiya"), "الخالدية"],
  [W("مدينه خليفه|خليفه|khalifa city"), "مدينة خليفة"], [W("مصفح|musaffah"), "مصفح"], [W("جزيره الريم|reem island"), "جزيرة الريم"],
  [W("ياس|yas"), "ياس"], [W("النهده|nahda"), "النهدة"], [W("القصيص|qusais"), "القصيص"], [W("المجاز|majaz"), "المجاز"],
  [W("الخوانيج|khawaneej"), "الخوانيج"], [W("الممزر|mamzar"), "الممزر"], [W("بزنس باي|business bay"), "بزنس باي"],
  [W("داون تاون|downtown"), "داون تاون"],
  [W("ابوظبي|ابو ظبي|abu dhabi"), "أبوظبي"], [W("دبي|dubai"), "دبي"], [W("الشارقه|sharjah"), "الشارقة"],
  [W("عجمان|ajman"), "عجمان"], [W("العين|al ain"), "العين"], [W("راس الخيمه|rak"), "رأس الخيمة"],
  [W("الفجيره|fujairah"), "الفجيرة"], [W("ام القيوين|uaq"), "أم القيوين"],
];
const AREA_WORD = /(?:منطقه|حي|area)\s+([\p{L}]{3,20}(?:\s[\p{L}]{3,20})?)/iu;

const DIETS: Array<[RegExp, string]> = [
  [W("حساسيه (من )?(ال)?مكسرات|nut allergy|nuts"), "حساسية مكسرات"],
  [W("حساسيه (من )?(ال)?فول سوداني|peanut"), "حساسية فول سوداني"],
  [W("حساسيه (من )?(ال)?(جلوتين|قمح)|بدون جلوتين|gluten"), "بدون جلوتين"],
  [W("حساسيه (من )?(ال)?(لاكتوز|حليب|الالبان)|بدون حليب|lactose|dairy free"), "بدون لاكتوز"],
  [W("حساسيه (من )?(ال)?(بيض)|egg allergy"), "حساسية بيض"],
  [W("حساسيه (من )?(ال)?(سمك|روبيان|ماكولات بحريه)|seafood allergy|shellfish"), "حساسية مأكولات بحرية"],
  [W("نباتي(ين|ه)?|vegan|vegetarian|بدون لحم"), "نباتي"],
  [W("بدون سكر|سكري|sugar free|diabetic"), "بدون سكر"],
  [W("كيتو|keto"), "كيتو"],
  [W("حساسيه|allergy|allergic"), "عنده حساسية"],
];

const latinDigits = (t: string) => t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

/** What this one message says about what the customer wants. Pure. */
export function extractFacts(text: string): LeadFacts {
  // «للخميس», «للبرشاء»: the ل swallows the ا of ال, so it is put back for the patterns to find.
  const n = normalizeArabic(text ?? "").replace(/(^|\s)لل(?=\p{L}{2})/gu, "$1ل ال");
  // The clock needs the colon in «8:30», which the normaliser turns into a space.
  const lightly = latinDigits(text ?? "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "").toLowerCase();
  const f: LeadFacts = {};

  for (const [re, mode] of MODES) if (re.test(n)) { f.licence = mode; break; }
  for (const [re, name] of OCCASIONS) if (re.test(n)) { f.activity = name; break; }

  const party = PARTY.exec(n), table = PARTY_TBL.exec(n);
  const count = party ? Number(party[1]) : table ? Number(table[3]) : PARTY_WORD.test(n) ? 2 : PARTY_ONE.test(n) ? 1 : 0;
  if (count >= 1 && count <= 200) f.size = count === 1 ? "شخص واحد" : count === 2 ? "شخصين" : `${count} أشخاص`;

  let day: string | undefined;
  for (const [re, name] of DAYS) if (re.test(n)) { day = name; break; }
  let clock: string | undefined;
  for (const m of lightly.matchAll(CLOCK)) {
    const [, marker, hh, mm, period] = m;
    const h = Number(hh);
    if (!(marker || period) || h < 1 || h > 24) continue;
    // A count right after it is people, not a time: «الساعه 8 4 اشخاص» keeps the 8.
    clock = `${h}${mm ? `:${mm}` : ""}${period ? ` ${PERIOD[period] ?? period}` : ""}`;
    break;
  }
  if (day || clock) f.staff = [day, clock].filter(Boolean).join(" ").slice(0, 40);

  for (const [re, name] of AREAS) if (re.test(n)) { f.taxStatus = name; break; }
  if (!f.taxStatus) { const a = AREA_WORD.exec(n); if (a) f.taxStatus = a[1]!.slice(0, 40); }

  const diets: string[] = [];
  for (const [re, name] of DIETS) if (re.test(n) && !(name === "عنده حساسية" && diets.some((d) => d.startsWith("حساسية")))) diets.push(name);
  if (diets.length) f.accountant = diets.join("، ").slice(0, 80);

  for (const [re, name] of NEEDS) if (re.test(n)) { f.pain = name; break; }
  for (const [re, name] of OBJECTIONS) if (re.test(n)) { f.objection = name; break; }
  if (AGREED_STRONG.test(n) || (AGREED_SOFT.test(n) && !/[؟?]/.test(text ?? "") && !ASKING.test(n))) f.agreed = true;

  return f;
}

// ── Stages ────────────────────────────────────────────────────────

export const STAGES = [
  { n: 1, name: "ترحيب",   goal: "أن يقول وش يبغى. ترحيب قصير وسؤال سهل، لا قائمة خدمات." },
  { n: 2, name: "فهم الطلب", goal: "أن تعرف: طلب أو دور أو حجز، وما ينقص منه — سؤال واحد فقط." },
  { n: 3, name: "التفاصيل", goal: "أكمل الناقص الوحيد (العدد، الوقت، المنطقة) أو أكّد ما عندك." },
  { n: 4, name: "الخطوة",   goal: "جاوب سؤاله من المعلومات كما هي، ثم رابط واحد يناسبه: المنيو أو الدور أو الحجز." },
  { n: 5, name: "الطلب",    goal: "يبغى يطلب أو يحجز الحين: الرابط المناسب وتأكيد التفاصيل في سطر، ثم اصمت." },
  { n: 6, name: "اعتراض",   goal: "افهم اعتراضه، ردّ واحد وبديل موجود فعلاً. لا تخفّض ولا تخترع عرضاً." },
  { n: 7, name: "تأكيد",    goal: "وافق. لا تعرض شيئاً جديداً — أكّد التفاصيل في سطر، وسلّم لشخص من المحل إن احتاج." },
] as const;

export type Known = Pick<LeadCard, "licence" | "activity" | "size" | "pain" | "agreedAt">;

/**
 * Where the conversation is after this message. Pure.
 *
 * Mostly monotonic — a customer does not un-say that they want a table for
 * four — with one exception: an objection is a moment, not a level. Stage 6
 * lasts for the message that raised it and the reply to it, then the
 * conversation is back where it was.
 */
export function nextStage(prev: number, known: Known, intent: Intent, turns: number, now: LeadFacts): number {
  if (known.agreedAt || now.agreed) return 7;
  if (intent === "opt_out" || intent === "complaint") return prev || 1;

  let s = prev || 1;
  if (s === 6) s = 5;                                   // the objection has passed
  if (now.objection && s >= 4) return 6;

  const facts = [known.licence, known.activity, known.size].filter(Boolean).length;
  if (intent === "interested") s = Math.max(s, 5);
  else if (known.pain)         s = Math.max(s, 4);
  else if (facts >= 2)         s = Math.max(s, 3);
  else if (turns >= 2 || facts >= 1) s = Math.max(s, 2);
  return Math.max(1, s);
}

// ── The card in the prompt ────────────────────────────────────────

export const MODE_AR: Record<Mode, string> = {
  delivery: "توصيل", pickup: "استلام", dinein: "في المحل", booking: "حجز", queue: "دور", preorder: "طلب مسبق",
};

/** The card as the host reads it. Pure. */
export function cardText(c: LeadCard): string {
  const known: string[] = [];
  if (c.licence)    known.push(`يبغى: ${MODE_AR[c.licence as Mode] ?? c.licence}`);
  if (c.size)       known.push(`العدد: ${c.size}`);
  if (c.staff)      known.push(`الوقت: ${c.staff}`);
  if (c.taxStatus)  known.push(`المنطقة: ${c.taxStatus}`);
  if (c.activity)   known.push(`المناسبة: ${c.activity}`);
  if (c.accountant) known.push(`الأكل: ${c.accountant}`);
  if (c.pain)       known.push(`سأل: ${c.pain}`);

  // Only what this kind of request needs: a delivery has no party size, a queue has no area.
  const missing: string[] = [];
  const mode = c.licence as Mode | null;
  if (!mode) missing.push("طلب ولا دور ولا حجز");
  if ((mode === "booking" || mode === "queue" || mode === "dinein") && !c.size) missing.push("العدد");
  if ((mode === "booking" || mode === "preorder") && !c.staff) missing.push("الوقت");
  if (mode === "delivery" && !c.taxStatus) missing.push("المنطقة");

  const stage = STAGES[Math.min(7, Math.max(1, c.stage)) - 1]!;
  const lines = [
    "بطاقة الزبون — من كلامه هو، لا تسأل عمّا فيها:",
    known.length ? `- ${known.join(" · ")}` : "- لا تعرف عنه شيئاً بعد.",
  ];
  if (missing.length && c.stage < 5) lines.push(`- لم تعرف بعد: ${missing.join("، ")} — اسأل عن واحدة فقط إن ناسبت الرسالة.`);
  if (c.accountant) lines.push("- ذكر حساسية أو نظام أكل: لا تطمئنه عن المكونات من عندك — ما هو مكتوب فقط، والباقي للمحل.");
  lines.push(`المرحلة الآن: ${stage.n} — ${stage.name}. هدف هذه الرسالة: ${stage.goal}`);
  if (c.stage === 6 && c.objection) lines.push(`اعترض للتو: «${c.objection}».`);
  return lines.join("\n");
}

// ── Persistence ───────────────────────────────────────────────────

export interface CardUpdate {
  card: LeadCard;
  /** Facts this message added that the card did not have. */
  learnt: string[];
  /** The stage crossed a line the owner should hear about: 5 (wants to order or book) or 7 (agreed). */
  reached: 5 | 7 | null;
}

export async function getCard(userId: number, phone: string): Promise<LeadCard | null> {
  const [row] = await db.select().from(leadCardsTable)
    .where(and(eq(leadCardsTable.userId, userId), eq(leadCardsTable.phone, phone))).limit(1);
  return row ?? null;
}

/**
 * Fold one inbound message into the card. Called before the reply to it is
 * composed, so the prompt sees what the customer just said as fact rather
 * than as history.
 */
export async function updateCard(userId: number, phone: string, text: string, intent: Intent): Promise<CardUpdate> {
  const now = extractFacts(text);
  const prev = await getCard(userId, phone);
  const turns = (prev?.turns ?? 0) + 1;

  const merged = {
    licence:    prev?.licence    ?? now.licence    ?? null,
    activity:   prev?.activity   ?? now.activity   ?? null,
    size:       now.size         ?? prev?.size     ?? null,   // the latest figure wins
    staff:      now.staff        ?? prev?.staff    ?? null,
    taxStatus:  now.taxStatus    ?? prev?.taxStatus ?? null,
    accountant: now.accountant   ?? prev?.accountant ?? null,
    pain:       prev?.pain       ?? now.pain       ?? null,
    objection:  now.objection    ?? null,
    agreedAt:   prev?.agreedAt   ?? (now.agreed ? new Date() : null),
  };

  const learnt: string[] = [];
  for (const k of ["licence", "activity", "size", "staff", "taxStatus", "accountant", "pain"] as const) {
    if (merged[k] && merged[k] !== (prev?.[k] ?? null)) learnt.push(k);
  }

  const stage = nextStage(prev?.stage ?? 1, merged, intent, turns, now);
  const notified = prev?.notifiedStage ?? 0;
  const reached: 5 | 7 | null = stage >= 7 && notified < 7 ? 7 : stage >= 5 && notified < 5 ? 5 : null;

  const [card] = await db.insert(leadCardsTable).values({
    userId, phone, stage, ...merged, lastIntent: intent, turns,
    notifiedStage: reached ? reached : notified,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [leadCardsTable.userId, leadCardsTable.phone],
    set: { stage, ...merged, lastIntent: intent, turns, notifiedStage: reached ? reached : notified, updatedAt: new Date() },
  }).returning();

  if (learnt.length || reached) {
    logger.info({ userId, phone, stage, learnt, reached }, "بطاقة الزبون حُدِّثت");
  }
  return { card: card!, learnt, reached };
}

/** The prompt block, or "" for a customer with no card yet. */
export async function cardPreamble(userId: number, phone: string): Promise<string> {
  const card = await getCard(userId, phone);
  return card ? cardText(card) : "";
}

// ── A person on the thread ────────────────────────────────────────

export const TAKEOVER_MINUTES = 24 * 60;

/** True while a person holds this thread; the bot and the follow-ups stay quiet. */
export async function isHumanHeld(userId: number, phone: string): Promise<boolean> {
  const card = await getCard(userId, phone);
  return !!card?.humanUntil && new Date(card.humanUntil).getTime() > Date.now();
}

export async function takeover(userId: number, phone: string, by: "phone" | "app" | "owner", minutes = TAKEOVER_MINUTES): Promise<Date> {
  const until = new Date(Date.now() + minutes * 60_000);
  await db.insert(leadCardsTable).values({ userId, phone, humanUntil: until, humanBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [leadCardsTable.userId, leadCardsTable.phone],
      set: { humanUntil: until, humanBy: by, updatedAt: new Date() },
    });
  logger.info({ userId, phone, by, until }, "بشري تولّى المحادثة — البوت والمتابعات صامتان");
  return until;
}

export async function release(userId: number, phone: string): Promise<void> {
  await db.update(leadCardsTable).set({ humanUntil: null, humanBy: null, updatedAt: new Date() })
    .where(and(eq(leadCardsTable.userId, userId), eq(leadCardsTable.phone, phone)));
}

// ── For the dashboard ─────────────────────────────────────────────

export async function funnel(userId: number, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const rows = await db.select({ stage: leadCardsTable.stage, n: sql<number>`count(*)` })
    .from(leadCardsTable)
    .where(and(eq(leadCardsTable.userId, userId), gte(leadCardsTable.updatedAt, since)))
    .groupBy(leadCardsTable.stage);
  const byStage = STAGES.map((s) => ({ stage: s.n, name: s.name, n: Number(rows.find((r) => r.stage === s.n)?.n ?? 0) }));

  const hot = await db.select().from(leadCardsTable)
    .where(and(eq(leadCardsTable.userId, userId), gte(leadCardsTable.stage, 5), gte(leadCardsTable.updatedAt, since)))
    .orderBy(desc(leadCardsTable.stage), desc(leadCardsTable.updatedAt)).limit(20);

  const held = await db.select().from(leadCardsTable)
    .where(and(eq(leadCardsTable.userId, userId), gte(leadCardsTable.humanUntil, new Date())));

  return { byStage, hot, held };
}

/** The last thing the customer said, for an alert. */
export async function lastCustomerLine(userId: number, phone: string): Promise<string> {
  const [row] = await db.select({ text: waThreadMessagesTable.text }).from(waThreadMessagesTable)
    .where(and(eq(waThreadMessagesTable.userId, userId), eq(waThreadMessagesTable.phone, phone), eq(waThreadMessagesTable.fromMe, false)))
    .orderBy(desc(waThreadMessagesTable.createdAt)).limit(1);
  return (row?.text ?? "").slice(0, 160);
}
