import { useState } from "react";
import { Copy, ExternalLink, MessageCircle, Phone, Check, Info, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Lead sources ──────────────────────────────────────────────────
const SOURCES = [
  { id: "snap",      label: "سناب شات",       icon: "👻", tag: "snapchat"   },
  { id: "tiktok",    label: "تيك توك",         icon: "🎵", tag: "tiktok"     },
  { id: "meta",      label: "ميتا / فيسبوك",  icon: "📘", tag: "meta"       },
  { id: "instagram", label: "إنستغرام",        icon: "📸", tag: "instagram"  },
  { id: "google",    label: "جوجل",            icon: "🔍", tag: "google"     },
  { id: "twitter",   label: "تويتر / X",       icon: "🐦", tag: "twitter"    },
  { id: "custom",    label: "مخصص",            icon: "✏️", tag: ""           },
];

// ── Message templates per source ─────────────────────────────────
const SOURCE_MSG: Record<string, string> = {
  snap:      "مرحباً 👋\nشفت إعلانكم على سناب شات وأبي أستفسر\n\n📍 المصدر: سناب شات",
  tiktok:    "السلام عليكم 👋\nشفت الفيديو على تيك توك وأبي أعرف أكثر\n\n📍 المصدر: تيك توك",
  meta:      "هلا 👋\nشفت إعلانكم على فيسبوك وأبي معلومات\n\n📍 المصدر: فيسبوك",
  instagram: "هلا 👋\nشفت إعلانكم على إنستغرام وأبي تفاصيل\n\n📍 المصدر: إنستغرام",
  google:    "مرحباً 👋\nوصلت لكم عن طريق جوجل وأبي أستفسر\n\n📍 المصدر: جوجل",
  twitter:   "هلا 👋\nشفت تغريدتكم على X وأبي أعرف أكثر\n\n📍 المصدر: تويتر",
  custom:    "",
};

// ── Platform usage tips ───────────────────────────────────────────
const PLATFORM_TIPS: Record<string, { steps: string; note: string }> = {
  snap: {
    steps: "Ads Manager ← أنشئ إعلان ← Business ← نوع الهدف: Conversations → WhatsApp\nأو: Website URL ← ضع الرابط مباشرةً",
    note:  "سناب يدعم زر WhatsApp مباشر في الإعلان — لا تحتاج صفحة هبوط",
  },
  tiktok: {
    steps: "TikTok Ads Manager ← Create Campaign ← Traffic/Conversions ← Destination URL ← ضع الرابط",
    note:  "استخدم هدف Traffic أو Reach للروابط المباشرة",
  },
  meta: {
    steps: "Meta Ads Manager ← Create ← Objective: Messages ← WhatsApp\nأو Objective: Traffic ← Website ← ضع الرابط",
    note:  "يفضّل هدف Messages مع WhatsApp مباشرةً — يُخفّض التكلفة",
  },
  instagram: {
    steps: "نفس إعدادات Meta Ads — اختر Instagram كموضع النشر",
    note:  "يمكنك استهداف Instagram فقط من داخل Meta Ads Manager",
  },
  google: {
    steps: "Google Ads ← Create Ad ← Responsive Display / Search ← Final URL ← ضع الرابط",
    note:  "تأكد من السماح بـ WhatsApp links في إعدادات Google Ads",
  },
  twitter: {
    steps: "Twitter Ads ← Create Campaign ← Website Clicks ← Destination URL ← ضع الرابط",
    note:  "استخدم صور أو فيديوهات قصيرة مع زر CTA واضح",
  },
  custom: {
    steps: "ضع الرابط في أي مكان: SMS، بيو انستغرام، QR كود، بطاقة عمل",
    note:  "يعمل على أي جهاز يدعم واتساب",
  },
};

function buildWaLink(phone: string, message: string): string {
  const clean = phone.replace(/[\s\-\+\(\)]/g, "").replace(/^00/, "");
  if (!clean) return "";
  const base = `https://wa.me/${clean}`;
  if (!message.trim()) return base;
  return `${base}?text=${encodeURIComponent(message.trim())}`;
}

export default function WaLinkGenerator() {
  const [phone,      setPhone]      = useState("");
  const [source,     setSource]     = useState<string>("snap");
  const [customTag,  setCustomTag]  = useState("");
  const [message,    setMessage]    = useState(SOURCE_MSG["snap"]);
  const [copied,     setCopied]     = useState(false);

  const selectedSource = SOURCES.find(s => s.id === source)!;
  const link = buildWaLink(phone, message);
  const tip  = PLATFORM_TIPS[source] ?? PLATFORM_TIPS.custom;

  function pickSource(id: string) {
    setSource(id);
    setMessage(SOURCE_MSG[id] ?? "");
  }

  function copy() {
    if (!phone.trim()) { toast.error("أدخل رقم الهاتف أولاً"); return; }
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("✓ تم نسخ الرابط");
    setTimeout(() => setCopied(false), 2000);
  }

  function openLink() {
    if (!phone.trim()) { toast.error("أدخل رقم الهاتف أولاً"); return; }
    window.open(link, "_blank");
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5" dir="rtl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-[#25D366]" />
          مولّد رابط واتساب للإعلانات
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          أنشئ رابطاً يفتح واتساب مباشرةً مع رسالة ترحيب تحمل مصدر الليد — للاستخدام في سناب · تيك توك · ميتا
        </p>
      </div>

      {/* Step 1 — Phone */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">① رقم الواتساب (الذي سيستقبل العملاء)</p>
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-primary flex-shrink-0" />
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="971501234567"
            dir="ltr"
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 font-mono"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 mr-6">
          أدخل رمز الدولة بدون + (مثال: 971501234567 للإمارات)
        </p>
      </div>

      {/* Step 2 — Source */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">② مصدر الليد (من أين سيأتي العميل؟)</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {SOURCES.map(s => (
            <button
              key={s.id}
              onClick={() => pickSource(s.id)}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl text-xs font-medium border transition-all",
                source === s.id
                  ? "bg-primary/15 border-primary/50 text-primary"
                  : "bg-muted/40 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <span className="text-lg leading-none">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {source === "custom" && (
          <div className="mt-3">
            <label className="text-xs text-muted-foreground mb-1 block">اسم المصدر المخصص</label>
            <input
              value={customTag}
              onChange={e => {
                setCustomTag(e.target.value);
                setMessage(`مرحباً 👋\nأبي أستفسر عن خدماتكم\n\n📍 المصدر: ${e.target.value || "مخصص"}`);
              }}
              placeholder="مثال: معرض · يوتيوب · بيو الانستغرام"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
        )}
      </div>

      {/* Step 3 — Message */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">③ رسالة الترحيب (قابلة للتعديل)</p>
          <button
            onClick={() => setMessage(SOURCE_MSG[source] ?? "")}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> إعادة الضبط
          </button>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={5}
          placeholder="اكتب الرسالة التي ستظهر جاهزة للعميل عند فتح واتساب..."
          className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          💡 العميل يرى هذه الرسالة جاهزة — يضغط إرسال مباشرةً — أنت ترى المصدر بوضوح في كل رسالة
        </p>
      </div>

      {/* Generated link */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-[#25D366]" />
          الرابط الجاهز للإعلان
        </h3>

        {phone.trim() ? (
          <>
            <div
              className="bg-muted/60 border border-border rounded-lg p-3 font-mono text-xs text-primary break-all cursor-pointer hover:bg-muted transition-colors select-all"
              dir="ltr"
              onClick={copy}
              title="اضغط للنسخ"
            >
              {link}
            </div>

            <div className="flex gap-2">
              <button
                onClick={copy}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                  copied
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "تم النسخ ✓" : "نسخ الرابط"}
              </button>
              <button
                onClick={openLink}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20 hover:bg-[#25D366]/20 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                اختبار
              </button>
            </div>

            {/* Platform-specific instructions */}
            <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span>{selectedSource.icon}</span>
                كيف تضع الرابط في {selectedSource.label}؟
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{tip.steps}</p>
              <div className="flex items-start gap-1.5 mt-2">
                <Info className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-400">{tip.note}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">أدخل رقم الهاتف أعلاه لتوليد الرابط</p>
          </div>
        )}
      </div>

      {/* Pro tip */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-400 leading-relaxed">
        <strong className="text-amber-300">نصيحة:</strong> إذا تعاملت مع أكثر من منصة — أنشئ رابطاً منفصلاً لكل واحدة
        مع رسالة مختلفة، وهكذا تعرف بالضبط أي إعلان يجلب أكثر العملاء.
      </div>
    </div>
  );
}
