// ── The Menu For You sales employee: who it is and what it may say ──
// Pure. The settings an admin trains it with, the system prompt built from
// them, the per-step goals of the follow-up, the fallback templates, and the
// guard every message passes before it can leave — so what reaches a shop
// owner is never only as good as the model was at that moment.

import { charterBlock } from "../roles/charters";

/** The seller's role in the charters and on the receipts. */
export const SELLER_ROLE = "shop_sales";

export type SalesVertical = "restaurant" | "cafe" | "sweets" | "salon" | "barber";
export type LinkKey = SalesVertical | "signup" | "video";
export const LINK_KEYS: LinkKey[] = ["restaurant", "cafe", "sweets", "salon", "barber", "signup", "video"];
export const VERTICAL_AR: Record<SalesVertical, string> = { restaurant: "مطعم", cafe: "كافيه", sweets: "محل حلويات", salon: "صالون نسائي", barber: "صالون حلاقة رجالي" };
export const LINK_AR: Record<LinkKey, string> = { restaurant: "تجربة مطعم", cafe: "تجربة كافيه", sweets: "تجربة حلويات", salon: "تجربة صالون نسائي", barber: "تجربة حلاق", signup: "التسجيل والتجربة المجانية", video: "فيديو الشرح" };

export interface SalesStep { day: number; goal: string; link: "demo" | "signup" | "none" }

export interface SalesSettings {
  /** The program runs: openers and follow-ups go out on their own. */
  active: boolean;
  /** Write and record every message, send none — for training before going live. */
  dryRun: boolean;
  /** The employee answers prospects who reply. */
  replies: boolean;
  /** Links go through /s/<token>/<key>, so a click is known per shop. */
  trackLinks: boolean;
  /** The WhatsApp account it sends from (a Flow Hub user id). */
  waUserId: number | null;
  name: string;
  title: string;
  persona: string;
  /** The trainer's own rules, newest last. */
  instructions: string[];
  /** The offer it may state, word for word. Empty: only the trial from the plans. */
  offer: string;
  links: Record<LinkKey, string>;
  dailyNew: number;
  hourFrom: number;
  hourTo: number;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  tz: string;
  steps: SalesStep[];
  /** After a reply, how long a quiet prospect waits before the next nudge. */
  warmGapDays: number;
  openerMode: "ai" | "template";
}

export const DEFAULT_STEPS: SalesStep[] = [
  { day: 2, link: "demo", goal: "تذكير لطيف بلا لوم ولا «ما رديت علي». فائدة واحدة فقط تناسب نوع محله، ورابط التجربة لنوعه ليشوف بعينه." },
  { day: 5, link: "none", goal: "زاوية جديدة: مشهد واقعي من يوم محله — زبون يمسح الـQR ويطلب، والطلب يوصله واتساب مرتب بالأصناف والعنوان. بلا أرقام ولا نتائج مخترعة." },
  { day: 12, link: "signup", goal: "دعوة صريحة وهادئة للتجربة المجانية بالعرض الموجود فقط، وأن الإعداد دقائق (يقدر يستورد منيوه من رابط أو صورة)، مع رابط التسجيل." },
  { day: 20, link: "none", goal: "سؤال واحد صادق يكشف ألمه: كيف يستقبل الطلبات اليوم؟ أو وش أكثر شي يتعبه في الطلبات أو الزحمة؟ بلا روابط ولا عرض." },
  { day: 30, link: "demo", goal: "رسالة وداع مهذبة: هذه آخر رسالة منك، الباب مفتوح متى ما حب، ورابط التجربة مرة أخيرة. لا ضغط." },
];

export const DEFAULT_PERSONA = "ودودة وواثقة، تتكلم مثل صاحبة خبرة في المطاعم لا مثل مندوبة إعلانات. تسمع أكثر مما تتكلم، وتختصر.";

export const DEFAULT_SETTINGS: SalesSettings = {
  active: false, dryRun: true, replies: true, trackLinks: true, waUserId: null,
  name: "سارة", title: "مستشارة منيو فور يو", persona: DEFAULT_PERSONA, instructions: [], offer: "",
  links: { restaurant: "", cafe: "", sweets: "", salon: "", barber: "", signup: "", video: "" },
  dailyNew: 40, hourFrom: 10, hourTo: 20, days: [0, 1, 2, 3, 4, 6], tz: "Asia/Dubai",
  steps: DEFAULT_STEPS, warmGapDays: 2, openerMode: "ai",
};

const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v: unknown, max: number, d = "") => (typeof v === "string" ? v.trim().slice(0, max) : d);

/** Whatever the admin sent, made settings. Untouched keys keep their current value. */
export function cleanSalesSettings(raw: unknown, cur: SalesSettings = DEFAULT_SETTINGS): SalesSettings {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const has = (k: string) => k in b;
  const links = { ...cur.links };
  if (b.links && typeof b.links === "object") {
    for (const k of LINK_KEYS) if (k in b.links) {
      const u = str(b.links[k], 400);
      links[k] = !u || /^https?:\/\/[^\s]+$/i.test(u) || /^\/[^\s]*$/.test(u) ? u : links[k];
    }
  }
  let steps = cur.steps;
  if (Array.isArray(b.steps)) {
    steps = b.steps.slice(0, 8).map((s: any) => ({
      day: int(s?.day, 1, 120, 7), goal: str(s?.goal, 400) || "متابعة لطيفة بفائدة جديدة.",
      link: (["demo", "signup", "none"] as const).includes(s?.link) ? s.link : "none",
    })).sort((a: SalesStep, c: SalesStep) => a.day - c.day)
      .filter((s: SalesStep, i: number, a: SalesStep[]) => i === 0 || s.day > a[i - 1]!.day);
  }
  const hourFrom = has("hourFrom") ? int(b.hourFrom, 0, 23, cur.hourFrom) : cur.hourFrom;
  const hourTo = has("hourTo") ? int(b.hourTo, 1, 24, cur.hourTo) : cur.hourTo;
  return {
    active: typeof b.active === "boolean" ? b.active : cur.active,
    dryRun: typeof b.dryRun === "boolean" ? b.dryRun : cur.dryRun,
    replies: typeof b.replies === "boolean" ? b.replies : cur.replies,
    trackLinks: typeof b.trackLinks === "boolean" ? b.trackLinks : cur.trackLinks,
    waUserId: has("waUserId") ? (b.waUserId == null || b.waUserId === "" ? null : int(b.waUserId, 1, 2 ** 31 - 1, cur.waUserId ?? 0) || null) : cur.waUserId,
    name: has("name") ? str(b.name, 40) || cur.name : cur.name,
    title: has("title") ? str(b.title, 80) || cur.title : cur.title,
    persona: has("persona") ? str(b.persona, 1200) || DEFAULT_PERSONA : cur.persona,
    instructions: Array.isArray(b.instructions) ? b.instructions.map((x: unknown) => str(x, 300)).filter(Boolean).slice(-40) : cur.instructions,
    offer: has("offer") ? str(b.offer, 240) : cur.offer,
    links,
    dailyNew: has("dailyNew") ? int(b.dailyNew, 0, 300, cur.dailyNew) : cur.dailyNew,
    hourFrom, hourTo: hourTo <= hourFrom ? Math.min(24, hourFrom + 1) : hourTo,
    days: Array.isArray(b.days) ? [...new Set(b.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[] : cur.days,
    tz: has("tz") && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(b.tz)) ? String(b.tz) : cur.tz,
    steps: steps.length ? steps : DEFAULT_STEPS,
    warmGapDays: has("warmGapDays") ? int(b.warmGapDays, 1, 30, cur.warmGapDays) : cur.warmGapDays,
    openerMode: b.openerMode === "template" || b.openerMode === "ai" ? b.openerMode : cur.openerMode,
  };
}

// ── Who a prospect is ─────────────────────────────────────────────

/** A shop's kind from its name or category. Pure. */
export function guessVertical(...texts: Array<string | null | undefined>): SalesVertical | null {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (!t) return null;
  if (/حلاق|barber|men'?s salon|صالون رجالي|حلاقة/.test(t)) return "barber";
  if (/صالون|تجميل|beauty|ladies|نسائي|spa|سبا|nail|أظافر|اظافر/.test(t)) return "salon";
  if (/حلويات|حلا|sweets|bakery|مخبز|مخابز|كيك|cake|patisserie|dessert|شوكولا|chocolate/.test(t)) return "sweets";
  if (/كافيه|كوفي|قهوة|قهوه|cafe|café|coffee|كافي/.test(t)) return "cafe";
  if (/مطعم|مطاعم|restaurant|grill|مشاوي|بيتزا|pizza|burger|برجر|شاورما|kitchen|مطبخ|food|cafeteria|كافتيريا/.test(t)) return "restaurant";
  return null;
}

const CITY_RE = /^(دبي|أبوظبي|ابوظبي|أبو ظبي|ابو ظبي|الشارقة|الشارقه|عجمان|رأس الخيمة|راس الخيمة|راس الخيمه|الفجيرة|الفجيره|أم القيوين|ام القيوين|العين|الرياض|جدة|جده|الدمام|الدوحة|الكويت|مسقط|المنامة|dubai|abu dhabi|sharjah|ajman|ras al khaimah|rak|fujairah|umm al quwain|al ain|riyadh|jeddah|doha|kuwait|muscat|manama)$/i;

export interface ProspectRow { phone: string; name: string | null; business: string | null; vertical: SalesVertical | null; city: string | null }

/** A pasted list — one shop a line: a phone, then name, business, kind, city in any order. Pure. */
export function parseProspects(text: string, normalise: (raw: string) => string | null): { rows: ProspectRow[]; bad: number } {
  const rows: ProspectRow[] = []; let bad = 0; const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t|;|,|\|/).map((c) => c.trim()).filter(Boolean);
    const pi = cells.findIndex((c) => /^[+\d][\d\s()\-]{6,}$/.test(c));
    const phone = pi >= 0 ? normalise(cells[pi]!) : null;
    if (!phone) { bad++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    const rest = cells.filter((_, i) => i !== pi);
    const vIdx = rest.findIndex((c) => (Object.keys(VERTICAL_AR) as string[]).includes(c.toLowerCase()) || Object.values(VERTICAL_AR).includes(c));
    const vCell = vIdx >= 0 ? rest.splice(vIdx, 1)[0]! : null;
    // Which cell is the city, which the shop, which the person: by what they look like, not by position.
    const cIdx = rest.findIndex((c) => CITY_RE.test(c) && c.length <= 40);
    const city = cIdx >= 0 ? rest.splice(cIdx, 1)[0]! : null;
    const bIdx = rest.findIndex((c) => guessVertical(c) !== null);
    const business = bIdx >= 0 ? rest.splice(bIdx, 1)[0]! : rest.shift() ?? null;
    const name = rest[0] ?? null;
    const vertical = vCell ? ((Object.keys(VERTICAL_AR) as SalesVertical[]).find((k) => k === vCell.toLowerCase() || VERTICAL_AR[k] === vCell) ?? null) : guessVertical(business, name);
    rows.push({ phone, name: name?.slice(0, 120) ?? null, business: business?.slice(0, 160) ?? null, vertical, city: city?.slice(0, 80) ?? null });
  }
  return { rows, bad };
}

// ── The system prompt ─────────────────────────────────────────────

export interface ProspectView {
  name: string | null; business: string | null; vertical: string | null; city: string | null;
  stage: string; step: number; replies: number; clicks: number;
  facts: Array<{ fact: string }>; summary: string | null; linksSent: Array<{ key: string }>;
}

export type Mode = "opener" | "followup" | "reply";

export function prospectCard(p: ProspectView): string {
  const v = p.vertical && p.vertical in VERTICAL_AR ? VERTICAL_AR[p.vertical as SalesVertical] : null;
  return [
    "بطاقة هذا المحل (ما نعرفه — لا تسأل عنه مرة ثانية):",
    `- ${[p.business || p.name || "اسم المحل غير معروف", v, p.city].filter(Boolean).join(" · ")}`,
    p.name && p.business && p.name !== p.business ? `- الاسم: ${p.name}` : "",
    `- المرحلة: ${STAGE_AR[p.stage] ?? p.stage} · رسائلنا في المتابعة: ${p.step} · ردوده: ${p.replies}${p.clicks ? ` · فتح روابطنا ${p.clicks} مرة` : ""}`,
    p.linksSent.length ? `- أرسلنا له: ${[...new Set(p.linksSent.map((l) => LINK_AR[l.key as LinkKey] ?? l.key))].join("، ")} — لا تكرر الرابط نفسه إلا إن طلبه.` : "",
    p.summary ? `- الخلاصة: ${p.summary}` : "",
    ...p.facts.slice(-8).map((f) => `- ${f.fact}`),
  ].filter(Boolean).join("\n");
}

export const STAGE_AR: Record<string, string> = {
  new: "لم نتواصل بعد", contacted: "أرسلنا له ولم يرد", replied: "رد علينا", interested: "مهتم", trial: "سجّل في التجربة",
  won: "اشترك", lost: "رفض", stopped: "متوقف", paused: "موقوف يدوياً",
};

/**
 * The seller's system prompt. Its order matters: who it is, what it sells (as
 * facts it may quote), how it sells, the hard limits, what it has learnt, the
 * shop in front of it — and the task last, where a model attends most.
 */
export function sellerPrompt(o: {
  s: SalesSettings; product: string; links: Partial<Record<LinkKey, string>>; memory?: string; card?: string; mode: Mode; task?: string;
}): string {
  const { s } = o;
  const linkLines = (Object.keys(o.links) as LinkKey[]).filter((k) => o.links[k]).map((k) => `- ${LINK_AR[k]}: ${o.links[k]}`);
  return [
    `أنت ${s.name}، ${s.title}. تكلّم أصحاب المطاعم والكافيهات ومحلات الحلويات والصالونات على واتساب عن «منيو فور يو».`,
    `شخصيتك: ${s.persona}`,
    "",
    charterBlock(SELLER_ROLE),
    "لهجتك خليجية بيضاء مهذبة، وتجاري لهجة صاحب المحل إن كتب بغيرها، وبالإنجليزية إن كتب بها.",
    "",
    "هدفك الواحد: أن يجرّب صاحب المحل منيو فور يو بنفسه مجاناً. لا تبيع الاشتراك في رسالة — اكسب الرد، ثم الفهم، ثم التجربة.",
    "",
    "حقائق المنتج (هي وحدها ما تقوله عن الأسعار والمزايا والمدد — حرفياً):",
    o.product,
    s.offer ? `العرض الحالي (حرفياً، ولا غيره): ${s.offer}` : "لا يوجد عرض أو خصم غير التجربة المجانية المذكورة أعلاه.",
    "",
    linkLines.length ? `الروابط المسموحة (انسخها كما هي، رابط واحد في الرسالة كحد أقصى):\n${linkLines.join("\n")}` : "لا روابط متاحة الآن — لا تكتب أي رابط.",
    "",
    "طريقتك:",
    "1. ابدأ بسؤال عن محله لا بعرض. أول رسالة لرقم لا يعرفك: بلا رابط.",
    "2. افهم قبل أن تقترح: نوع المحل، كيف يستقبل الطلبات أو المواعيد اليوم (تلفون، تطبيقات توصيل، منيو PDF، دفتر)، وأكبر شيء يتعبه — سؤال واحد في كل رسالة.",
    "3. اربط ميزة واحدة بمشكلته هو: الطلبات بالتلفون ← الطلب من المنيو يوصله واتساب مرتب؛ الزحمة في الصالون ← الصف الرقمي و«جاء دورك»؛ زبون ما يرجع ← بطاقة الأختام ورسائل الرجوع؛ عمولات التطبيقات ← قناته الخاصة بلا عمولة لزبائنه الدائمين.",
    "4. اقترح بثقة: الخطة الأنسب لحجمه (فرع واحد أو فروع، عدد الأصناف) والميزتين الأهم له، وأرسل رابط التجربة المطابق لنوع محله.",
    "5. حين يلين: رابط التسجيل للتجربة المجانية، وقل إن الإعداد دقائق وإنه يقدر يستورد منيوه من رابط أو صورة.",
    "6. حين يسجّل أو يوافق: هنّئه في سطر، واعرض أن زميلاً يساعده في الإعداد.",
    "",
    "الاعتراضات — ردّ واحد صادق ثم سؤال واحد:",
    "- «عندي منيو PDF / ورقي»: PDF يُقرأ فقط؛ منيو فور يو يُطلب منه، يتحدّث بلحظة، ويحفظ لك رقم كل زبون لترجعه.",
    "- «عندي طلبات/كيتا/هنقرستيشن»: لا نلغيها؛ نعطيك قناتك أنت لزبائنك الدائمين بلا عمولة على الطلب، وتظل التطبيقات للزبون الجديد.",
    "- «غالي»: اسأله كم طلب يمر عليه بالأسبوع، وقارن الاشتراك الثابت بعمولة كم طلب من التطبيقات — بلا أرقام من عندك.",
    "- «ما عندي وقت»: الإعداد دقائق، وتقدر تستورد منيوك من رابط أو صورة، وزميلنا يساعدك.",
    "- «أرسل التفاصيل»: سطر واحد + رابط التجربة المطابق لنوع محله، ثم سؤال: وش أهم شي تبيه منه؟",
    "- «مين أنتم / من وين جبتوا رقمي»: نحن منيو فور يو، منصة منيو وطلبات على واتساب للمحلات في الخليج، ورقم المحل منشور للتواصل في أدلة الأعمال. اعتذر بلطف إن لم يرغب.",
    "",
    "ما لا تفعله أبداً:",
    "- سعراً أو مدة أو حداً أو ميزة غير مذكورة في «حقائق المنتج». إن لم تعرف: قل إنك بتتأكد وترجع له.",
    "- أرقاماً أو نتائج أو أسماء عملاء مخترعة («زادت مبيعاتهم 40%»، «عندنا 500 مطعم») — ممنوع تماماً.",
    "- خصماً أو هدية أو وعداً غير مكتوب، أو استعجالاً مصطنعاً («العرض ينتهي اليوم»، «آخر فرصة»).",
    "- رابطاً غير الروابط المسموحة أعلاه، أو أكثر من رابط في الرسالة.",
    "- الإلحاح على من قال لا: اشكره بسطر وتوقف. ومن كتب «توقف» لا يُراسل بعدها.",
    "- لا تفتتح بأنك مساعد آلي. لكن إن سألك بجدية هل أنت إنسان أو بوت فلا تنكر: قل إنك المساعد الرقمي لفريق منيو فور يو وإن زميلاً من الفريق يقدر يكمل معه.",
    "- إن طلب مكالمة أو سعراً خاصاً أو عقداً أو فاتورة: قل إن زميلاً من الفريق بيتواصل معه، ولا تعد بشيء.",
    "",
    "شكل رسالتك: 2 إلى 4 أسطر، بلا عناوين ولا نجوم ولا قوائم، سؤال واحد على الأكثر، إيموجي واحد على الأكثر، وبلا توقيع طويل.",
    s.instructions.length ? `\nتعليمات المدرّب (مقدّمة على ما سبق إن تعارضت في الأسلوب، لا في الحقائق):\n${s.instructions.map((x) => `- ${x}`).join("\n")}` : "",
    o.memory ? `\n${o.memory}` : "",
    o.card ? `\n${o.card}` : "",
    o.task ? `\nمهمتك الآن:\n${o.task}\nاكتب نص الرسالة فقط — بلا مقدمة ولا شرح ولا علامات تنصيص.` : "",
  ].filter((x) => x !== "").join("\n");
}

/** What this message must do, for an opener or a follow-up step. */
/** Openers start from different angles, so a hundred of them never read as one blast. */
export const OPENER_ANGLES: Record<SalesVertical, string[]> = {
  restaurant: ["اسأله كيف يستقبلون الطلبات اليوم", "اسأله هل أغلب طلباتهم من التطبيقات أم من زبائن دائمين", "اسأله عن ضغط الطلبات بالتلفون وقت الذروة", "اسأله هل عندهم منيو يقدر الزبون يطلب منه مباشرة"],
  cafe: ["اسأله كيف يطلب الزبون عندهم: من الكاونتر أم الطاولة", "اسأله هل يرجع لهم نفس الزبائن كل أسبوع", "اسأله عن زحمة الصباح وطلبات الاستلام"],
  sweets: ["اسأله كيف يستقبلون الطلبات المسبقة والمناسبات", "اسأله هل الطلبات عندهم أغلبها واتساب يدوي", "اسأله كيف يعرض أصنافه وأسعاره للزبون"],
  salon: ["اسألها كيف تنظمون المواعيد اليوم", "اسألها عن الانتظار في المحل وقت الزحمة", "اسألها هل الزبونات يحجزن بالواتساب يدوياً"],
  barber: ["اسأله كيف ينظم الدور عنده وقت الزحمة", "اسأله هل الزبون ينتظر في المحل أم يحجز", "اسأله عن عطلة نهاية الأسبوع والدور"],
};

/** A shop named only in Latin letters is often run by staff who read English first. Pure. */
export const latinOnly = (name: string | null | undefined) => !!name && /[a-z]/i.test(name) && !/[\u0600-\u06FF]/.test(name);

export function taskFor(mode: Mode, s: SalesSettings, step?: SalesStep, linkUrl?: string | null, angle?: string, bilingual = false): string {
  if (mode === "opener") {
    return [
      bilingual ? "اسم المحل بالإنجليزية فقط: اكتب الرسالة بالعربية ثم سطرين قصيرين بالإنجليزية بنفس المعنى." : "",
      "أول رسالة لهذا المحل — لا يعرفك.",
      "عرّف بنفسك في نصف سطر (اسمك ومن منيو فور يو)، واذكر اسم محله إن كان معروفاً، وسبباً واحداً محدداً لتواصلك يناسب نوع محله،",
      `ثم سؤالاً واحداً سهلاً يُجاب بكلمة — زاويته هذه المرة: ${angle ?? "كيف يستقبلون الطلبات أو المواعيد اليوم"}.`,
      "بلا رابط، بلا أسعار، بلا قائمة مزايا. صياغتك من عندك: لا تبدأ بـ«شفت محلكم وحبيت أسألك» ولا بأي جملة جاهزة متكررة.",
    ].filter(Boolean).join("\n");
  }
  if (mode === "followup" && step) {
    return [
      `رسالة متابعة بعد ${step.day} يوماً من أول رسالة. هدفها: ${step.goal}`,
      "انظر لما أرسلناه سابقاً في المحادثة ولا تكرر جملة ولا زاوية قلناها.",
      linkUrl ? `ضع هذا الرابط حرفياً في سطر مستقل: ${linkUrl}` : "بلا روابط في هذه الرسالة.",
    ].join("\n");
  }
  return "رُد على آخر رسالة منه، على طريقتك أعلاه، وابنِ على ما قاله.";
}

// ── Templates: the fallback when the model fails, and the opener in template mode ──

export const OPT_OUT_LINE = "(إن ما يناسبك التواصل، اكتب «توقف» ولن أراسلك مرة ثانية 🙏)";

export function templateOpener(s: SalesSettings, p: { name: string | null; business: string | null; vertical: string | null }, rand: () => number = Math.random): string {
  const shop = p.business || p.name;
  const v = (p.vertical ?? "restaurant") as SalesVertical;
  const why: Record<SalesVertical, string> = {
    restaurant: "عندنا منيو رقمي بالصور يطلب منه الزبون ويوصلك الطلب على واتساب مرتب",
    cafe: "عندنا منيو رقمي للكافيهات بالـQR يطلب منه الزبون من الطاولة أو استلام",
    sweets: "عندنا منيو رقمي للحلويات يطلب منه الزبون الطلبات المسبقة ويوصلك واتساب",
    salon: "عندنا صف رقمي وحجوزات للصالونات، والزبونة يوصلها «جاء دورك» على واتساب",
    barber: "عندنا صف رقمي للحلاقين: الزبون ياخذ دوره من جواله ويوصله «جاء دورك» على واتساب",
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const hello = pick([`السلام عليكم${shop ? ` ${shop}` : ""} 👋 معك ${s.name} من منيو فور يو.`, `مساء الخير${shop ? ` ${shop}` : ""}، أنا ${s.name} من فريق منيو فور يو.`, `هلا${shop ? ` ${shop}` : ""} 🌿 ${s.name} من منيو فور يو معك.`]);
  const ask = v === "salon" || v === "barber"
    ? pick(["كيف تنظمون الدور والمواعيد عندكم اليوم؟", "الزبائن عندكم يحجزون ولا ينتظرون في المحل؟"])
    : pick(["كيف تستقبلون الطلبات عندكم اليوم؟", "أغلب طلباتكم من التطبيقات ولا من زبائنكم مباشرة؟"]);
  const en = latinOnly(shop) ? `\nHi${shop ? ` ${shop}` : ""}, ${s.name} from Menu For You — a photo menu your customers order from, with orders arriving on your WhatsApp. ${v === "salon" || v === "barber" ? "How do you manage the queue today?" : "How do you take orders today?"}` : "";
  return [hello, `${why[v] ?? why.restaurant}.`, ask].join("\n") + en;
}

export function templateFollowUp(s: SalesSettings, stepIndex: number, p: { business: string | null; name: string | null }, linkUrl: string | null): string {
  const shop = p.business || p.name;
  const lines: string[][] = [
    [`أهلاً${shop ? ` ${shop}` : ""}، ${s.name} من منيو فور يو مرة ثانية.`, "حبيت أوريك كيف يشوف الزبون المنيو ويطلب منه:"],
    ["تخيل الزبون يمسح الـQR على الطاولة، يختار من الصور، والطلب يوصلك واتساب مرتب بالأصناف والملاحظات.", "هل الطلبات عندكم أغلبها تلفون ولا تطبيقات؟"],
    ["التجربة مجانية، والإعداد دقائق — تقدر تستورد منيوك من رابط أو صورة.", "تبي تجرب؟"],
    ["سؤال واحد بس لو تسمح: وش أكثر شي متعبك في الطلبات أو الزحمة؟"],
    ["هذه آخر رسالة مني، ما أبي أزعجك 🙏", "إذا حبيت تشوف المنيو بنفسك في أي وقت:"],
  ];
  const body = lines[Math.min(stepIndex, lines.length - 1)]!;
  return [...body, linkUrl ?? ""].filter(Boolean).join("\n");
}

// ── The guard ─────────────────────────────────────────────────────

export interface GuardContext {
  mode: Mode;
  allowedUrls: string[];
  /** A link this message must carry; appended if the model left it out. */
  requiredUrl?: string | null;
  /** Every number the facts and the offer contain; any other price or % is invented. */
  allowedNumbers: Set<string>;
  /** Our earlier messages to this shop, to catch a repeat. */
  previous: string[];
  /** The prospect asked, in this message, whether they are talking to a bot. */
  askedIfBot?: boolean;
  /** The message goes out with a «إيقاف الرسائل» button, so no stop line in the text. */
  hasStopButton?: boolean;
}

export interface GuardResult { ok: boolean; text: string; issues: string[]; links: string[] }

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const norm = (s: string) => toLatin(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** Every number in a text, as written in Latin digits. */
export function numbersIn(text: string): string[] {
  return (toLatin(text.replace(URL_RE, " ")).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

/**
 * The last word before a message leaves. It mends what can be mended — a
 * stray heading, a link it was not given, a missing link, the stop line on an
 * opener — and fails what cannot: an invented price or percentage, a claim to
 * be a person, pressure, a repeat. A failed message is replaced by the template.
 */
export function guardMessage(raw: string, ctx: GuardContext): GuardResult {
  const issues: string[] = [];
  let ok = true;
  let t = raw.replace(/\r/g, "").trim()
    .replace(/^["«“]+|["»”]+$/g, "")
    .replace(/^(?:الرسالة|نص الرسالة|الرد|Message)\s*[:：]\s*/i, "")
    .replace(/^\s*#+\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n").trim();

  // Links: only the ones it was given, at most one.
  const allowed = new Set(ctx.allowedUrls.filter(Boolean).map((u) => u.replace(/[.,،]+$/, "")));
  const kept: string[] = [];
  t = t.replace(URL_RE, (u) => {
    const clean = u.replace(/[.,،!?؟]+$/, "");
    if (!allowed.has(clean)) { issues.push(`رابط غير مسموح حُذف: ${clean.slice(0, 60)}`); return ""; }
    if (kept.length) { issues.push("أكثر من رابط — أُبقي الأول"); return ""; }
    kept.push(clean); return clean;
  }).replace(/[ \t]+\n/g, "\n").trim();
  if (ctx.mode === "opener" && kept.length) {
    t = t.replace(kept[0]!, "").trim(); kept.length = 0; issues.push("الرسالة الأولى بلا رابط — حُذف");
  }
  if (ctx.requiredUrl && !kept.includes(ctx.requiredUrl)) { t = `${t}\n${ctx.requiredUrl}`; kept.push(ctx.requiredUrl); issues.push("أُضيف الرابط المطلوب"); }

  // Numbers: a percentage or a price that is not in the facts is invented.
  const body = toLatin(t.replace(URL_RE, " "));
  const priced = [...body.matchAll(/(\d+(?:[.,]\d+)?)\s*(%|٪|في المية|بالمية|درهم|د\.إ|AED|ريال|ر\.س|SAR|دينار|\$|دولار)/gi)].map((m) => m[1]!.replace(",", "."));
  const pctFirst = [...body.matchAll(/(%|٪)\s*(\d+(?:[.,]\d+)?)/g)].map((m) => m[2]!.replace(",", "."));
  for (const n of [...priced, ...pctFirst]) if (!ctx.allowedNumbers.has(n) && !ctx.allowedNumbers.has(String(Number(n)))) { ok = false; issues.push(`رقم غير موجود في الحقائق: ${n}`); }

  // Claims and pressure.
  if (/(أنا|انا)\s+(إنسان|انسان|بشر|شخص حقيقي)|(لست|مو|مب|ماني)\s+(بوت|روبوت|آلي|الي)/.test(t)) { ok = false; issues.push("ادعاء أنه إنسان"); }
  if (!ctx.askedIfBot && /ذكاء\s*(?:ال)?اصطناعي|\bAI\b|ChatGPT|كمساعد\s*(آلي|ذكي)|نموذج لغوي/i.test(t)) { ok = false; issues.push("ذكر أنه ذكاء اصطناعي بلا سؤال"); }
  if (/(ينتهي|ينتهى)\s+(العرض\s+)?(اليوم|الليلة|بكرة)|آخر فرصة|لفترة محدودة جداً|مضمون\s*100|ضمان\s*100|نضمن لك/.test(t)) { ok = false; issues.push("ضغط أو ضمان غير مسموح"); }

  // Shape.
  if (t.length < 12) { ok = false; issues.push("قصيرة جداً"); }
  if (t.length > 700) {
    const cut = t.slice(0, 700); const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf("."), cut.lastIndexOf("؟"));
    t = (at > 300 ? cut.slice(0, at + 1) : cut).trim(); issues.push("قُصّت لطولها");
    if (ctx.requiredUrl && !t.includes(ctx.requiredUrl)) t = `${t}\n${ctx.requiredUrl}`;
  }
  const qs = (t.match(/[؟?]/g) ?? []).length;
  if (qs > 2) issues.push("أكثر من سؤالين");

  // A repeat of something we already sent.
  const me = norm(t.replace(URL_RE, ""));
  if (me && ctx.previous.some((p) => norm(p.replace(URL_RE, "")) === me)) { ok = false; issues.push("تكرار رسالة سابقة"); }

  if (ctx.mode === "opener" && !ctx.hasStopButton && !/توقف/.test(t)) t = `${t}\n${OPT_OUT_LINE}`;
  return { ok, text: t, issues, links: kept };
}

/** Did they ask whether this is a bot? Pure. */
export const askedIfBot = (text: string) => /(انت|إنت|أنت|انتي|إنتي)\s*(بوت|روبوت|آلي|الي|ذكاء)|(بوت|روبوت)\s*[؟?]|are you (a )?(bot|human|real)|هل (انت|أنت) (انسان|إنسان|حقيقي)/i.test(text);

// ── What a shop said, as facts ────────────────────────────────────

/** Facts a reply states outright, without a model. Pure. */
export function ruleFacts(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const apps = [["طلبات", "طلبات"], ["talabat", "طلبات"], ["كيتا", "كيتا"], ["keeta", "كيتا"], ["هنقرستيشن", "هنقرستيشن"], ["hungerstation", "هنقرستيشن"], ["ديليفرو", "ديليفرو"], ["deliveroo", "ديليفرو"], ["كريم", "كريم"], ["careem", "كريم"], ["نون", "نون فود"], ["جاهز", "جاهز"], ["مرسول", "مرسول"]] as const;
  const used = [...new Set(apps.filter(([k]) => t.includes(k)).map(([, v]) => v))];
  if (used.length) out.push(`يستخدم تطبيقات التوصيل: ${used.join("، ")}`);
  if (/pdf|بي دي اف|منيو ورق|منيو مطبوع/.test(t)) out.push("عنده منيو PDF أو ورقي");
  if (/(بالتلفون|بالتليفون|على التلفون|اتصال|بالهاتف)/.test(t)) out.push("يستقبل الطلبات بالتلفون");
  if (/(واتساب|واتس)/.test(t) && /(طلب|طلبات|اوردر)/.test(t)) out.push("يستقبل الطلبات على واتساب يدوياً");
  const br = toLatin(t).match(/(\d+)\s*(فروع|فرع)/); if (br) out.push(`عنده ${br[1]} فروع`);
  else if (/فرعين/.test(t)) out.push("عنده فرعان");
  if (/(صاحب المحل|المدير|المالك|الشريك).{0,20}(مو|مب|ليس|غير) موجود|كلم (المدير|المالك)/.test(t)) out.push("ليس صاحب القرار — يحتاج المدير/المالك");
  if (/(بعد|آخر|اخر) (الشهر|رمضان|العيد)|مو الحين|مب الحين|لاحقاً|بعدين/.test(t)) out.push("يفضّل التواصل لاحقاً");
  if (/غالي|السعر عالي|ما عندي ميزانية/.test(t)) out.push("اعتراض: السعر");
  return out;
}

/** New facts onto the old ones: no duplicates, the newest twenty kept. Pure. */
export function mergeFacts(old: Array<{ fact: string; at: string }>, found: string[], now: Date): Array<{ fact: string; at: string }> {
  const key = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  const seen = new Set(old.map((f) => key(f.fact)));
  const add = found.map((f) => f.trim()).filter((f) => f && !seen.has(key(f)) && (seen.add(key(f)), true)).map((fact) => ({ fact, at: now.toISOString() }));
  return [...old, ...add].slice(-20);
}

// ── Advice for the trainer ────────────────────────────────────────

export interface FunnelNumbers {
  contacted: number; replied: number; interested: number; trial: number; won: number; lost: number; stopped: number;
  clicks: number; optOuts: number; perStep: Array<{ step: number; sent: number; replies: number }>; openersSent: number; openerReplies: number;
  aiFallbacks: number; aiTotal: number;
}

/** What to change, from the numbers. Rule-based and plain; nothing invented. Pure. */
export function adviceFrom(f: FunnelNumbers, s: SalesSettings): string[] {
  const out: string[] = [];
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  if (f.contacted < 30) return ["الأرقام قليلة بعد — النصيحة تبدأ بعد 30 محلاً على الأقل. ابدأ بقائمة صغيرة ودرّب الموظف في «التجربة» قبل التفعيل."];
  const replyRate = pct(f.replied + f.interested + f.trial + f.won + f.lost, f.contacted);
  if (replyRate < 8) out.push(`نسبة الرد ${replyRate}% منخفضة: قصّر الرسالة الأولى، واذكر اسم المحل، واختم بسؤال يُجاب بكلمة. جرّب نسخة «قالب» مقابل «ذكاء» أسبوعاً لكل منهما.`);
  else if (replyRate >= 20) out.push(`نسبة الرد ${replyRate}% جيدة — ارفع العدد اليومي تدريجياً (10 كل أسبوع) مع مراقبة البلاغات.`);
  if (pct(f.optOuts, f.contacted) > 6) out.push(`«توقف» عالية (${pct(f.optOuts, f.contacted)}%): القائمة غير دقيقة أو الرسالة الأولى تبدو إعلاناً. نقِّ القائمة لنوع محل واحد، واجعل الأولى سؤالاً لا عرضاً.`);
  const best = [...f.perStep].filter((x) => x.sent >= 10).sort((a, b) => b.replies / b.sent - a.replies / a.sent)[0];
  const worst = [...f.perStep].filter((x) => x.sent >= 10).sort((a, b) => a.replies / a.sent - b.replies / b.sent)[0];
  if (best && worst && best.step !== worst.step) out.push(`أفضل متابعة: رقم ${best.step + 1} (${pct(best.replies, best.sent)}% رد)، والأضعف: رقم ${worst.step + 1} (${pct(worst.replies, worst.sent)}%). أعد كتابة هدف الأضعف على طريقة الأفضل.`);
  if (f.clicks > 0 && f.trial === 0 && f.clicks >= 10) out.push("محلات فتحت رابط التجربة ولم تسجّل: أضف متابعة بعد فتح الرابط بيوم تسأل «وش رأيك في المنيو؟»، واجعل رابط التسجيل أوضح.");
  if (f.interested > 0 && pct(f.trial, f.interested) < 25) out.push("مهتمون كثيرون لا يسجّلون: علّم الموظف أن يرسل رابط التسجيل حالما يقول «حلو/زين/كيف أبدأ»، وأن يعرض مساعدة زميل في الإعداد.");
  if (f.aiTotal >= 20 && pct(f.aiFallbacks, f.aiTotal) > 15) out.push(`الحارس استبدل ${pct(f.aiFallbacks, f.aiTotal)}% من رسائل الذكاء بالقالب: راجع «سجل الحارس» — غالباً أرقام أو روابط مخترعة. أضف الحقيقة الناقصة لحقائق المنتج أو العرض.`);
  if (!s.offer) out.push("لا يوجد عرض مكتوب: عرض واضح واحد (مثل شهر مجاني للمسجلين هذا الأسبوع) يرفع التسجيل — اكتبه في «العرض» ليقوله الموظف حرفياً.");
  if (!out.length) out.push("الأداء متوازن. استمر، وأضف لكل اعتراض جديد تراه في المحادثات تعليمة في «علّمه».");
  return out;
}
