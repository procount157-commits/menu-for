import { useState } from "react";
import { useLocation } from "wouter";
import {
  BookOpen, Search, Copy, Check, ArrowRight,
  Utensils, Gem, Scissors, Sparkles, ShoppingBag,
  Car, Home, Heart, GraduationCap, Dumbbell,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  category: string;
  title: string;
  icon: string;
  message: string;
  buttons?: { text: string; type: "url" | "call" | "reply"; url?: string }[];
  riskScore: number;
}

// ── Preset Templates ───────────────────────────────────────────────

export const PRESET_TEMPLATES: MessageTemplate[] = [
  // ── مطاعم ──
  {
    id: "restaurant-1",
    category: "مطاعم",
    title: "حفظ الرقم + منيو اليوم",
    icon: "🍽️",
    riskScore: 85,
    message: `{تحية} {الاسم} 👋
{فاصل}
🍽️ احفظ رقمنا ليصلك منيو اليوم والعروض الخاصة من {الشركة}

{عندنا اليوم|خاص اليوم|إضافة جديدة اليوم}: أطباق {شهية|مميزة|لذيذة} بأسعار {رائعة|مناسبة|لا تُعوَّض} 🔥

{فاصل}
{ختام} 📲`,
    buttons: [
      { text: "📲 احفظ الرقم", type: "reply" },
      { text: "🍔 اطلب الآن", type: "reply" },
      { text: "💬 تواصل معنا", type: "reply" },
    ],
  },
  {
    id: "restaurant-2",
    category: "مطاعم",
    title: "عرض يومي مع توصيل",
    icon: "🛵",
    riskScore: 80,
    message: `{تحية} {الاسم}! 🎉
{فاصل}
🛵 {عرض خاص|تخفيض حصري|فرصة اليوم} من {الشركة}

✅ توصيل {سريع|مجاني اليوم|خلال 30 دقيقة}
✅ أطباق {طازجة|محضّرة لحظياً|بمكونات طبيعية}
✅ أسعار {مناسبة|مميزة|تنافسية}

{فاصل}
اطلب الآن وانتظر التوصيل على بابك 🚪`,
    buttons: [
      { text: "🛵 اطلب الآن", type: "reply" },
      { text: "📋 شاهد المنيو", type: "reply" },
    ],
  },

  // ── ذهب ومجوهرات ──
  {
    id: "gold-1",
    category: "ذهب ومجوهرات",
    title: "تشكيلة جديدة",
    icon: "💎",
    riskScore: 88,
    message: `{تحية} {الاسم} ✨
{فاصل}
💎 وصلت {تشكيلات|مجموعات|قطع} جديدة وعروض حصرية إلى {الشركة}

🌟 تصاميم {عصرية|أصيلة|فريدة} بأجود {المواد|الخامات|الذهب}
💰 {أسعار مميزة|عروض خاصة|أسعار المصنع} لفترة محدودة

{فاصل}
لا تفوّت الفرصة! 🔥
{ختام} 💛`,
    buttons: [
      { text: "✨ شاهد المجموعة", type: "reply" },
      { text: "💬 استفسر الآن", type: "reply" },
      { text: "📲 احفظ الرقم", type: "reply" },
    ],
  },

  // ── حلاقة وصالونات ──
  {
    id: "salon-1",
    category: "حلاقة وصالونات",
    title: "حجز موعد سريع",
    icon: "✂️",
    riskScore: 90,
    message: `{تحية} {الاسم}! 💈
{فاصل}
✂️ احجز موعدك في {الشركة} خلال ثوانٍ عبر واتساب

⚡ {مواعيد فورية|حجز سريع|خدمة VIP} متاحة الآن
👨‍🎨 {حلاقة|تصفيف} {احترافية|مميزة|متخصصة}
💈 {أسعار مناسبة|عروض اليوم|باقات خاصة}

{فاصل}
{ختام} 📅`,
    buttons: [
      { text: "📅 احجز الآن", type: "reply" },
      { text: "💬 تحدث معنا", type: "reply" },
      { text: "📲 احفظ الرقم", type: "reply" },
    ],
  },
  {
    id: "salon-2",
    category: "حلاقة وصالونات",
    title: "عرض وقت الفراغ",
    icon: "💇",
    riskScore: 82,
    message: `{هلا|مرحباً|أهلاً} {الاسم} 👋
{فاصل}
💇 {عرض محدود|تخفيض اليوم|باقة خاصة} من {الشركة}

🕐 {مواعيد صباحية|أوقات مريحة|جداول مرنة} متاحة
✅ {خدمة ممتازة|نتيجة مضمونة|تجربة لا تُنسى}
💰 بسعر {مغرٍ|لن تجده في مكان آخر|يستحق التجربة}

{فاصل}
تواصل معنا الآن! 📲`,
  },

  // ── بيوتي سنتر ──
  {
    id: "beauty-1",
    category: "بيوتي سنتر",
    title: "عروض وخدمات جديدة",
    icon: "🌸",
    riskScore: 88,
    message: `{تحية} {الاسم} 🌸
{فاصل}
✨ عروض وخدمات {جديدة|مميزة|حصرية} بانتظارك في {الشركة}

💅 {مانيكير|عناية بالبشرة|باقات تجميل} {احترافية|بخبرة عالية|لا مثيل لها}
🌿 منتجات {طبيعية|عالية الجودة|آمنة 100%}
🎁 {هدية مجانية|خصم خاص|مفاجأة} مع كل حجز

{فاصل}
{ختام} 💆‍♀️`,
    buttons: [
      { text: "🎁 احصل على العرض", type: "reply" },
      { text: "💬 استفسر الآن", type: "reply" },
      { text: "📲 احفظ الرقم", type: "reply" },
    ],
  },
  {
    id: "beauty-2",
    category: "بيوتي سنتر",
    title: "باقة عروس",
    icon: "💍",
    riskScore: 85,
    message: `{تحية} {الاسم} 👰
{فاصل}
💍 باقات العروس {المميزة|الاحترافية|الكاملة} من {الشركة}

✅ {مكياج|تسريحة|عناية} {احترافية|لا تُنسى|مضمونة}
✅ تجربة {قبل الحفل|مجانية|بدون التزام}
✅ {أسعار مميزة|باقات شاملة|خصومات العروس}

{فاصل}
احجزي موعدك اليوم 💛`,
  },

  // ── بقالة ومحلات ──
  {
    id: "shop-1",
    category: "محلات وبقالات",
    title: "عرض أسبوعي",
    icon: "🛒",
    riskScore: 78,
    message: `{تحية} {الاسم}! 🛒
{فاصل}
🎯 عروض {الأسبوع|اليوم|الأسعار المخفضة} من {الشركة}

{فاصل}
💥 {خصومات|تخفيضات|أسعار} {مجنونة|لا تُصدَّق|حصرية} على {المنتجات|البضاعة|الأصناف} المختارة

🚀 الكمية {محدودة|مؤقتة|لن تتكرر} — {اطلب الآن|لا تفوت الفرصة|تصرف بسرعة}
{فاصل}
{ختام} 🛍️`,
    buttons: [
      { text: "🛒 تسوق الآن", type: "reply" },
      { text: "💬 استفسر", type: "reply" },
    ],
  },

  // ── سيارات ──
  {
    id: "car-1",
    category: "سيارات وخدمات",
    title: "عرض صيانة",
    icon: "🚗",
    riskScore: 80,
    message: `{تحية} {الاسم} 🚗
{فاصل}
🔧 {عرض|باقة|خدمة} {صيانة|فحص|تشخيص} {شاملة|مميزة|احترافية} من {الشركة}

✅ {فحص شامل|تغيير زيت|ضبط إطارات} {مجاني|بسعر خاص|مع كل زيارة}
✅ {ميكانيكيون|فنيون|خبراء} {معتمدون|متخصصون|محترفون}
⚡ {موعد خلال ساعة|خدمة سريعة|ضمان الجودة}

{فاصل}
{ختام} 🏁`,
    buttons: [
      { text: "🚗 احجز موعد", type: "reply" },
      { text: "📞 اتصل بنا", type: "call" },
    ],
  },

  // ── عقارات ──
  {
    id: "real-estate-1",
    category: "عقارات",
    title: "عرض عقاري",
    icon: "🏠",
    riskScore: 82,
    message: `{تحية} {الاسم} 🏠
{فاصل}
🏡 {وحدات|شقق|عقارات} {مميزة|حصرية|فريدة} متاحة الآن مع {الشركة}

📍 {موقع مميز|موقع استراتيجي|مكان مثالي}
💰 {أسعار تنافسية|أقساط ميسّرة|بدون فوائد}
🏗️ {تسليم فوري|تشطيب فاخر|ضمان 10 سنوات}

{فاصل}
احجز وحدتك اليوم قبل نفاد الكمية 🔑`,
    buttons: [
      { text: "🏠 شاهد الوحدات", type: "reply" },
      { text: "💬 تواصل مع المبيعات", type: "reply" },
    ],
  },

  // ── تعليم ──
  {
    id: "edu-1",
    category: "تعليم وتدريب",
    title: "دورة تدريبية",
    icon: "📚",
    riskScore: 83,
    message: `{تحية} {الاسم} 📚
{فاصل}
🎓 {دورة|برنامج|ورشة} {تدريبية|تعليمية|متخصصة} {جديدة|حصرية|محدودة} من {الشركة}

✅ {محتوى|مناهج|مواد} {احترافية|معتمدة|متخصصة}
✅ {شهادات معتمدة|حضور أونلاين|مرونة في المواعيد}
🎁 {مقعد مجاني|خصم التسجيل المبكر|نسخة تجريبية مجانية}

{فاصل}
سجل الآن والمقاعد محدودة! 🚀`,
    buttons: [
      { text: "📚 سجل الآن", type: "reply" },
      { text: "💬 استفسر", type: "reply" },
    ],
  },

  // ── لياقة ──
  {
    id: "gym-1",
    category: "لياقة وصحة",
    title: "اشتراك نادي",
    icon: "💪",
    riskScore: 85,
    message: `{تحية} {الاسم} 💪
{فاصل}
🏋️ {عرض|باقة|اشتراك} {خاص|مميز|حصري} في {الشركة}

✅ {أجهزة حديثة|كوتشز متخصصون|برامج مخصصة}
✅ {ساعات دوام طويلة|24/7|مرونة كاملة}
🎁 {شهر مجاني|تجربة مجانية أسبوع|فريز مجاني}

{فاصل}
ابدأ رحلتك الصحية اليوم! 🌟`,
    buttons: [
      { text: "💪 اشترك الآن", type: "reply" },
      { text: "🎁 جرّب مجاناً", type: "reply" },
    ],
  },
];

const CATEGORIES = ["الكل", ...Array.from(new Set(PRESET_TEMPLATES.map(t => t.category)))];

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "مطاعم":            <Utensils className="w-3.5 h-3.5" />,
  "ذهب ومجوهرات":    <Gem className="w-3.5 h-3.5" />,
  "حلاقة وصالونات":  <Scissors className="w-3.5 h-3.5" />,
  "بيوتي سنتر":      <Sparkles className="w-3.5 h-3.5" />,
  "محلات وبقالات":   <ShoppingBag className="w-3.5 h-3.5" />,
  "سيارات وخدمات":   <Car className="w-3.5 h-3.5" />,
  "عقارات":          <Home className="w-3.5 h-3.5" />,
  "تعليم وتدريب":    <GraduationCap className="w-3.5 h-3.5" />,
  "لياقة وصحة":      <Dumbbell className="w-3.5 h-3.5" />,
};

function RiskBadge({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500/15 text-green-400 border-green-500/20"
    : score >= 60 ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
    : "bg-yellow-500/15 text-yellow-400 border-yellow-500/20";
  const label = score >= 80 ? "ممتاز" : score >= 60 ? "جيد" : "متوسط";
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-medium", color)}>
      🛡 {label} {score}
    </span>
  );
}

// ── Template Card ──────────────────────────────────────────────────
function TemplateCard({
  template, onUse,
}: {
  template: MessageTemplate;
  onUse: (t: MessageTemplate) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyMessage = async () => {
    await navigator.clipboard.writeText(template.message).catch(() => {});
    setCopied(true);
    toast.success("تم نسخ نص الرسالة");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4 hover:border-primary/30 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{template.icon}</span>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">{template.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{template.category}</p>
          </div>
        </div>
        <RiskBadge score={template.riskScore} />
      </div>

      <div className="bg-muted/50 rounded-lg p-3 max-h-36 overflow-y-auto">
        <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed" dir="rtl">
          {template.message.length > 220
            ? template.message.slice(0, 220) + "..."
            : template.message}
        </p>
      </div>

      {template.buttons && template.buttons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {template.buttons.map((btn, i) => (
            <span key={i} className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">
              {btn.text}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onUse(template)}
          className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          استخدم هذا القالب →
        </button>
        <button
          onClick={copyMessage}
          className="px-3 py-2 bg-muted border border-border text-muted-foreground rounded-lg text-xs hover:text-foreground hover:border-primary/30 transition-colors"
          title="نسخ النص"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function Templates() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("الكل");

  const filtered = PRESET_TEMPLATES.filter(t => {
    const matchCat = activeCategory === "الكل" || t.category === activeCategory;
    const q = search.toLowerCase();
    const matchSearch = !q || t.title.includes(q) || t.category.includes(q) || t.message.includes(q);
    return matchCat && matchSearch;
  });

  const handleUseTemplate = (template: MessageTemplate) => {
    // Store in sessionStorage for CampaignNew to pick up
    sessionStorage.setItem("selectedTemplate", JSON.stringify(template));
    navigate("/campaigns/new");
    toast.success("تم اختيار القالب — أكمل إعدادات الحملة");
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <BookOpen className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">مكتبة القوالب</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            قوالب رسائل جاهزة مُحسَّنة لتجنب الحظر — اضغط "استخدم" لإنشاء حملة فورية
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث في القوالب..."
          className="w-full pl-4 pr-10 py-2.5 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors",
              activeCategory === cat
                ? "bg-primary/15 text-primary border-primary/40 font-medium"
                : "text-muted-foreground border-border hover:border-primary/20 hover:text-foreground"
            )}
          >
            {CATEGORY_ICONS[cat]}
            {cat}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{filtered.length} قالب</span>
        <span>•</span>
        <span className="text-green-400">🛡 كل القوالب تحتوي Spintax ومتغيرات عشوائية</span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>لا توجد قوالب تطابق بحثك</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              onUse={handleUseTemplate}
            />
          ))}
        </div>
      )}

      {/* Info banner */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <ArrowRight className="w-4 h-4 text-primary mt-0.5 flex-shrink-0 rotate-180" />
          <div>
            <p className="text-sm font-medium text-foreground">كيف تعمل القوالب؟</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              كل قالب يحتوي على Spintax{" "}
              <code className="bg-primary/10 text-primary px-1 rounded">{"{خيار1|خيار2}"}</code>
              {" "}ومتغيرات عشوائية{" "}
              <code className="bg-primary/10 text-primary px-1 rounded">{"{تحية}"}</code>
              {" "}— كل مستلم يحصل على نسخة مختلفة من نفس الرسالة مما يرفع نقاط الأمان ويُقلل احتمالية الحظر.
              أضف اسم الشركة والمعلومات الخاصة بك قبل الإرسال.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
