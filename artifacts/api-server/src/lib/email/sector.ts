// ── Which sector a company is in ─────────────────────────────────
// Lists arrive without an activity column more often than with one, but the
// shop's name almost always says it: "… RESTAURANT L.L.C", "… CAFE",
// «حلويات …», "… BEAUTY SALON". So the sector is read from the activity when
// there is one, the name when there is not, and the file or list name as a
// last hint.
//
// Rules, in order, first match wins. The four verticals Menu For You sells
// to come first, so "Golden Spoon Restaurant" is a restaurant and not gold,
// and sweets come before cafés and restaurants because a "sweets & café" is
// a sweets shop first. Their patterns are kept tight ("kitchen" alone is not
// a restaurant — it is as often kitchen fit-out). The older trades stay
// after them, so lists that were already classified keep their labels.

import { normalizeArabic } from "../intent";

export const UNCLASSIFIED = "غير مصنف";

const RULES: Array<[string, RegExp]> = [
  // Menu For You's own verticals.
  ["حلويات",            /(sweets?\b|patisserie|p[aâ]tisserie|pastry|pastries|bakery|bakeries|cakes?\b|desserts?|chocolat|confection|kunafa|knafeh|luqaimat|ice ?cream|gelato|حلويات|حلويه|حلوي|مخبز|مخابز|معجنات|كنافه|كيك|شوكولا|بوظه|ايس كريم|لقيمات)/],
  ["كافيهات",           /(\bcaf[eé]s?\b|coffee|roastery|roasters|espresso|\btea\b|karak|كافيه|كوفي|مقهي|مقاهي|قهوه|كرك|محمصه)/],
  ["مطاعم",             /(restaurants?|cafeteria|catering|\bgrill|shawarma|burgers?|pizz|\bdiner\b|bistro|eatery|steak ?house|sea ?food|cloud kitchen|food truck|\bmandi\b|machboos|مطعم|مطاعم|كافتيريا|مشويات|شاورما|برجر|بيتزا|مندي|مطبخ شعبي|ولايم)/],
  ["تجميل وصالونات",     /(salon|beauty|\bspa\b|barber|\bnails?\b|lashes|make ?up|hair ?(dress|cut|studio)|cosmetic|صالون|تجميل|حلاقه|مشغل|(?:^|\s)سبا(?:\s|$)|اظافر|رموش|مكياج|عطور|perfumes?)/],
  // The other trades, as they were.
  ["عقارات",            /(real ?estate|realty|propert(y|ies)|\bestates?\b|brokerage|\bbrokers?\b|holiday homes|vacation homes|homes rental|\bleasing\b|عقار|عقارات|الوساطه العقاريه|وساطه عقاريه|اسكان)/],
  ["مواد بناء",          /(building materials?|construction materials?|cement|\bsteel\b|\btiles?\b|sanitary ware|hardware|مواد بناء|مواد البناء|حديد|اسمنت|سيراميك)/],
  ["مقاولات",           /(contracting|contractors?|construction|\bbuilding\b|civil works|fit ?out|joinery|interiors? (contracting|works)|\bmep\b|electromechanical|مقاولات|مقاول|انشاءات|تشييد|بناء)/],
  ["محاسبة وتدقيق",      /(accounting|accountants?|auditing|auditors?|audit\b|bookkeeping|chartered|\btax (consult|advis)|محاسبه|محاسبين|تدقيق|مدققي حسابات)/],
  ["قانونية",           /(legal|advocates?|law firm|lawyers?|attorneys?|محامون|محاماه|استشارات قانونيه)/],
  ["خدمات الشركات",      /(business (setup|set up|services)|corporate services|company formation|\bpro services\b|typing|documents clearing|تاسيس الشركات|خدمات رجال الاعمال|طباعه وتخليص)/],
  ["مالية وتأمين",       /(insurance|\bfinance\b|financial|investments?|capital|exchange|تامين|تمويل|استثمار|صرافه)/],
  ["ذهب ومجوهرات",       /(gold|jewel(le)?ry|jewell?ers?|diamonds?|precious|ذهب|مجوهرات|الماس)/],
  ["أغذية",             /(food ?stuff|foods?\b|grocery|supermarket|hypermarket|fruits|vegetables|dairy|kitchen|اغذيه|مواد غذائيه|بقاله|سوبرماركت|خضار)/],
  ["سيارات",            /(auto(mobiles?|motive)?\b|\bcars?\b|motors?|garage|tyres?|spare parts|rent a car|car rental|سيارات|ورشه|قطع غيار|تاجير سيارات)/],
  ["نقل وشحن",          /(shipping|logistics|freight|cargo|transport|courier|delivery|movers|packers|removals|شحن|نقل|لوجستي|توصيل)/],
  ["سياحة وسفر",        /(travel|tourism|tours?\b|hotel|resort|hospitality|سفر|سياحه|فندق)/],
  ["تقنية",             /(technolog|software|\bit\b|information technology|computers?|digital|systems|solutions (fz|llc)|telecom|برمجيات|تقنيه|تكنولوجيا|حاسب)/],
  ["تسويق وإعلان",       /(marketing|advertising|media|events?|printing|publishing|branding|تسويق|اعلان|دعايه|طباعه|فعاليات)/],
  ["طبي وصحي",           /(medical|clinic|hospital|pharmacy|pharma|dental|health ?care|polyclinic|diagnostic|طبي|عياده|مستشفى|صيدليه|اسنان)/],
  ["تعليم وتدريب",       /(training|education|institute|academy|school|nursery|university|college|تدريب|تعليم|معهد|اكاديميه|مدرسه|حضانه)/],
  ["تنظيف",             /(cleaning|pest control|laundry|تنظيف|مكافحه|مغسله)/],
  ["صيانة وخدمات فنية",   /(technical services|maintenance|air ?condition|\bhvac\b|plumbing|electrical|facility management|صيانه|تكييف|خدمات فنيه|كهرباء|سباكه)/],
  ["أمن وحراسة",         /(security (services|guards|systems)|guarding|امن|حراسه)/],
  ["صناعة",             /(manufactur|industr|factory|plastic|packaging|صناع|مصنع)/],
  ["ملابس وأزياء",       /(fashion|garments?|textiles?|tailor|abaya|clothing|shoes|ملابس|ازياء|اقمشه|خياطه|عبايات)/],
  ["إلكترونيات",         /(electronics?|mobile phones?|mobiles\b|الكترونيات|هواتف|جوالات)/],
  ["استشارات",           /(consultan|consulting|management|advisory|استشارات|استشاري)/],
  ["تجارة عامة",         /(general trading|trading|import|export|traders?|تجاره عامه|تجاره|استيراد|تصدير)/],
];

const norm = (s: string) => normalizeArabic(s ?? "").replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();

function match(text: string): string | null {
  const n = norm(text);
  if (!n) return null;
  for (const [label, re] of RULES) if (re.test(n)) return label;
  return null;
}

/**
 * The sector for one contact. `hint` is the file or list it came from —
 * "dubai-restaurants-ALL" — used only when the contact's own words say
 * nothing.
 */
export function classifySector(input: { industry?: string | null; company?: string | null; name?: string | null; hint?: string | null }): string | null {
  return match(input.industry ?? "") ?? match(input.company ?? "") ?? match(input.hint ?? "") ?? null;
}

export const SECTORS = RULES.map(([label]) => label);
