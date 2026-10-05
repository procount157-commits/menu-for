// ── The plan matrix ───────────────────────────────────────────────
// Every plan is a row the platform owner edits: a switch per feature and a
// number per limit. This file is the one list of what those switches and
// numbers are — the server reads it to enforce, the admin page to render the
// editor, the home page to write the bullets. Add a feature here and it
// appears everywhere.

export type ToggleKey =
  | "ordering" | "english" | "importAi" | "display" | "removeBranding"
  | "queue" | "booking" | "reminders"
  | "notify" | "agent"
  | "campaigns" | "autopilot" | "coupons" | "loyalty" | "birthday" | "referral" | "gifts" | "upsell" | "retarget"
  | "analytics" | "weeklyReport"
  | "branchNumbers" | "exportData" | "prioritySupport";

export type LimitKey = "branches" | "items" | "staff" | "customers" | "messagesMonthly" | "campaignsMonthly" | "agentRepliesMonthly" | "contacts" | "chatbots";

export interface PlanDef {
  key: string;
  name: string;
  nameEn: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  extraBranchPrice: number | null;
  contactSales: boolean;
  isPublic: boolean;
  isActive: boolean;
  isFeatured: boolean;
  badge: string | null;
  badgeEn: string | null;
  sort: number;
  limits: Record<LimitKey, number>;
  toggles: Record<ToggleKey, boolean>;
  /** The owner's own bullets for the home page; empty means write them from the matrix. */
  bullets: string[];
  bulletsEn: string[];
}

export interface MatrixRow { key: string; label: string; labelEn: string; group: string; hint?: string }

export const GROUPS: Array<[string, string]> = [
  ["capacity", "السعة"], ["menu", "المنيو"], ["queue", "الصف والحجز"], ["messages", "الرسائل"],
  ["marketing", "التسويق"], ["insight", "التحليل"], ["business", "الأعمال"],
];

export const LIMITS: Array<MatrixRow & { key: LimitKey; unit: string; unitEn: string }> = [
  { key: "branches", label: "الفروع", labelEn: "Branches", group: "capacity", unit: "فرع", unitEn: "branches" },
  { key: "items", label: "الأصناف", labelEn: "Menu items", group: "capacity", unit: "صنف", unitEn: "items" },
  { key: "staff", label: "الموظفون", labelEn: "Staff accounts", group: "capacity", unit: "موظف", unitEn: "staff" },
  { key: "customers", label: "الزبائن المحفوظون", labelEn: "Saved customers", group: "capacity", unit: "زبون", unitEn: "customers" },
  { key: "messagesMonthly", label: "رسائل واتساب للزبائن شهرياً", labelEn: "WhatsApp messages to customers / month", group: "messages", unit: "رسالة", unitEn: "messages", hint: "كل رسالة يرسلها النظام لزبون: تأكيد، دور، تذكير، حملة، رد الوكيل. تنبيهات المحل لنفسه لا تُحسب." },
  { key: "campaignsMonthly", label: "الحملات شهرياً", labelEn: "Campaigns / month", group: "marketing", unit: "حملة", unitEn: "campaigns" },
  { key: "agentRepliesMonthly", label: "ردود الوكيل الذكي شهرياً", labelEn: "AI replies / month", group: "messages", unit: "رد", unitEn: "replies" },
  { key: "contacts", label: "أرقام قوائم الحملات", labelEn: "Campaign contacts", group: "marketing", unit: "رقم", unitEn: "contacts" },
  { key: "chatbots", label: "بوتات الفريق الذكي", labelEn: "AI team bots", group: "business", unit: "بوت", unitEn: "bots" },
];

export const TOGGLES: Array<MatrixRow & { key: ToggleKey }> = [
  { key: "ordering", label: "الطلب على واتساب", labelEn: "WhatsApp ordering", group: "menu", hint: "بدونه المنيو للعرض فقط." },
  { key: "english", label: "المنيو بالإنجليزي", labelEn: "English menu", group: "menu" },
  { key: "importAi", label: "استيراد المنيو من صورة أو رابط", labelEn: "Import menu from a photo or link", group: "menu" },
  { key: "display", label: "شاشة «الآن يُخدم»", labelEn: "\"Now serving\" screen", group: "menu" },
  { key: "removeBranding", label: "إزالة شارة «مدعوم من منيو فور يو»", labelEn: "Remove Menu For You branding", group: "menu" },
  { key: "queue", label: "الصف الرقمي", labelEn: "Digital queue", group: "queue" },
  { key: "booking", label: "الحجوزات والمواعيد", labelEn: "Bookings & appointments", group: "queue" },
  { key: "reminders", label: "تذكير قبل الموعد", labelEn: "Appointment reminders", group: "queue" },
  { key: "notify", label: "رسائل تلقائية للزبائن (دور، طلب، حجز)", labelEn: "Automatic customer messages", group: "messages" },
  { key: "agent", label: "الوكيل الذكي يرد على الزبائن", labelEn: "AI host replies to customers", group: "messages" },
  { key: "campaigns", label: "الحملات وإعادة الاستهداف", labelEn: "Campaigns", group: "marketing" },
  { key: "autopilot", label: "الحملة الأسبوعية الآلية", labelEn: "Weekly automatic campaign", group: "marketing" },
  { key: "coupons", label: "الكوبونات والعروض بالساعات", labelEn: "Coupons & timed deals", group: "marketing" },
  { key: "loyalty", label: "بطاقة الأختام", labelEn: "Stamp card", group: "marketing" },
  { key: "birthday", label: "هدية عيد الميلاد", labelEn: "Birthday gift", group: "marketing" },
  { key: "referral", label: "ادعُ صديقاً", labelEn: "Invite a friend", group: "marketing" },
  { key: "gifts", label: "بطاقات الهدايا", labelEn: "Gift cards", group: "marketing" },
  { key: "upsell", label: "«يُطلب معه» في السلة", labelEn: "\"Goes well with\" in the cart", group: "marketing" },
  { key: "retarget", label: "إعادة الاستهداف من نتائج الحملة", labelEn: "Retargeting from campaign results", group: "marketing" },
  { key: "analytics", label: "تحليلات المنيو", labelEn: "Menu analytics", group: "insight" },
  { key: "weeklyReport", label: "التقرير الأسبوعي على واتساب", labelEn: "Weekly WhatsApp report", group: "insight" },
  { key: "branchNumbers", label: "رقم واتساب لكل فرع", labelEn: "A WhatsApp number per branch", group: "business" },
  { key: "exportData", label: "تصدير بيانات الزبائن", labelEn: "Export customer data", group: "business" },
  { key: "prioritySupport", label: "دعم بأولوية", labelEn: "Priority support", group: "business" },
];

const all = (v: boolean) => Object.fromEntries(TOGGLES.map((t) => [t.key, v])) as Record<ToggleKey, boolean>;

/** What each built-in plan starts with. The admin edits these in the database; this is only the seed and the fallback. */
export const DEFAULT_PLANS: Record<string, Pick<PlanDef, "name" | "nameEn" | "priceMonthly" | "limits" | "toggles">> = {
  free: {
    name: "مجاني", nameEn: "Free", priceMonthly: 0,
    limits: { branches: 1, items: 30, staff: 1, customers: 200, messagesMonthly: 0, campaignsMonthly: 0, agentRepliesMonthly: 0, contacts: 0, chatbots: 0 },
    toggles: { ...all(false), ordering: true, english: true },
  },
  trial: {
    name: "تجريبي", nameEn: "Trial", priceMonthly: 0,
    limits: { branches: 2, items: -1, staff: 3, customers: 1000, messagesMonthly: 100, campaignsMonthly: 2, agentRepliesMonthly: 50, contacts: 500, chatbots: 1 },
    toggles: { ...all(true), removeBranding: false, branchNumbers: false, prioritySupport: false },
  },
  basic: {
    name: "أساسي", nameEn: "Basic", priceMonthly: 99,
    limits: { branches: 1, items: -1, staff: 3, customers: 1000, messagesMonthly: 300, campaignsMonthly: 0, agentRepliesMonthly: 0, contacts: 500, chatbots: 1 },
    toggles: { ...all(false), ordering: true, english: true, importAi: true, notify: true, reminders: true, weeklyReport: true, upsell: true },
  },
  pro: {
    name: "احترافي", nameEn: "Pro", priceMonthly: 199,
    limits: { branches: 3, items: -1, staff: 10, customers: 5000, messagesMonthly: 1500, campaignsMonthly: 8, agentRepliesMonthly: 500, contacts: 5000, chatbots: 5 },
    toggles: { ...all(true), removeBranding: false, display: false, gifts: false, referral: false, analytics: false, branchNumbers: false, prioritySupport: false },
  },
  business: {
    name: "الباقة الكاملة", nameEn: "Full package", priceMonthly: 399,
    limits: { branches: -1, items: -1, staff: -1, customers: -1, messagesMonthly: 5000, campaignsMonthly: -1, agentRepliesMonthly: 2000, contacts: -1, chatbots: -1 },
    toggles: all(true),
  },
};

export const UNLIMITED = -1;
export const fmtLimit = (n: number, lang: "ar" | "en" = "ar") => (n < 0 ? (lang === "ar" ? "بلا حد" : "Unlimited") : new Intl.NumberFormat("en-US").format(n));

/** The home-page bullets written from the matrix, when the owner wrote none. Pure. */
export function bulletsFor(p: Pick<PlanDef, "limits" | "toggles">, lang: "ar" | "en" = "ar"): string[] {
  const L = p.limits, T = p.toggles, ar = lang === "ar";
  const out: string[] = [];
  out.push(ar ? "منيو رقمي بالصور والأقسام وQR جاهز للطباعة" : "Photo menu with sections and a print-ready QR");
  if (T.ordering) out.push(ar ? "الطلب على واتساب بدون عمولة" : "WhatsApp ordering, no commission");
  out.push(ar ? (L.branches < 0 ? "فروع بلا حد" : L.branches === 1 ? "فرع واحد" : `حتى ${L.branches} فروع`) : (L.branches < 0 ? "Unlimited branches" : `Up to ${L.branches} branch${L.branches === 1 ? "" : "es"}`));
  if (L.items >= 0) out.push(ar ? `حتى ${L.items} صنفاً` : `Up to ${L.items} items`);
  if (L.staff !== 0) out.push(ar ? (L.staff < 0 ? "موظفون بلا حد" : `${L.staff} ${L.staff === 1 ? "حساب موظف" : "حسابات موظفين"}`) : (L.staff < 0 ? "Unlimited staff" : `${L.staff} staff account${L.staff === 1 ? "" : "s"}`));
  if (T.notify && L.messagesMonthly !== 0) out.push(ar ? `${fmtLimit(L.messagesMonthly)} رسالة واتساب لزبائنك شهرياً` : `${fmtLimit(L.messagesMonthly, "en")} WhatsApp messages to customers / month`);
  if (T.queue) out.push(ar ? "صف انتظار رقمي و«جاء دورك» على واتساب" : "Digital queue with \"your turn\" on WhatsApp");
  if (T.booking) out.push(ar ? "حجوزات ومواعيد مع تذكير" : "Bookings with reminders");
  if (T.agent) out.push(ar ? "وكيل ذكي يرد على زبائنك من المنيو" : "AI host that answers from your menu");
  if (T.campaigns) out.push(ar ? (L.campaignsMonthly < 0 ? "حملات واتساب بلا حد" : `${L.campaignsMonthly} حملات واتساب شهرياً`) : (L.campaignsMonthly < 0 ? "Unlimited WhatsApp campaigns" : `${L.campaignsMonthly} WhatsApp campaigns / month`));
  if (T.autopilot) out.push(ar ? "حملة أسبوعية تكتب نفسها وتُرسل وحدها" : "A weekly campaign that writes and sends itself");
  if (T.coupons) out.push(ar ? "كوبونات وعروض بالساعات" : "Coupons & happy hours");
  if (T.loyalty) out.push(ar ? "بطاقة أختام: العاشرة هدية" : "Stamp card loyalty");
  if (T.birthday) out.push(ar ? "هدية عيد ميلاد لكل زبون" : "Birthday gifts");
  if (T.referral) out.push(ar ? "ادعُ صديقاً: الزبون يجيب زبوناً" : "Invite-a-friend rewards");
  if (T.gifts) out.push(ar ? "بطاقات هدايا على واتساب" : "Gift cards on WhatsApp");
  if (T.analytics) out.push(ar ? "تحليلات المنيو: ما يُشاهَد ولا يُطلب" : "Menu analytics");
  if (T.weeklyReport) out.push(ar ? "تقرير أسبوعي على جوالك" : "Weekly report on your phone");
  if (T.display) out.push(ar ? "شاشة «الآن يُخدم»" : "\"Now serving\" screen");
  if (T.branchNumbers) out.push(ar ? "رقم واتساب لكل فرع" : "A WhatsApp number per branch");
  if (T.removeBranding) out.push(ar ? "بدون شارة «مدعوم من»" : "No Menu For You branding");
  if (T.prioritySupport) out.push(ar ? "دعم بأولوية" : "Priority support");
  return out;
}
