/**
 * Visual Chatbot Flow Builder
 * Canvas-based node editor with drag, connections, templates.
 */
import {
  useState, useEffect, useRef, useCallback, type MouseEvent as RMouseEvent,
} from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetChatbot, useCreateChatbot, useUpdateChatbot, useToggleChatbot,
  getGetChatbotQueryKey, getListChatbotsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Plus, Trash2, Loader2, Power, Save,
  LayoutTemplate, X, Link2, MessageSquare, Sparkles,
  Image, Video, FileText, Globe, Upload, Bot,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────

type MediaType = "text" | "image" | "video" | "file" | "link";
type NodeType  = "welcome" | "keyword" | "response";

type FlowOption = { text: string; keyword: string; nodeId: string };
type FlowNode = {
  id: string;
  type: NodeType;
  label: string;
  keywords: string;
  message: string;
  mediaType: MediaType;
  mediaUrl: string;
  options: FlowOption[];
  x: number;
  y: number;
};

const NODE_W = 220;
const NODE_H_BASE = 130;

function uid() { return Math.random().toString(36).slice(2, 8); }

function migrate(raw: any[]): FlowNode[] {
  return raw.map((n, i) => ({
    id: n.id || uid(),
    type: n.type || (i === 0 ? "welcome" : "keyword"),
    label: n.label || n.keywords?.split(/[,،]/)[0]?.trim() || `عقدة ${i + 1}`,
    keywords: n.keywords || "",
    message: n.message || "",
    mediaType: (n.mediaType as MediaType) || "text",
    mediaUrl: n.mediaUrl || "",
    options: (n.options || []).map((o: any) => ({
      text: o.text || "",
      keyword: o.keyword || o.text || "",
      nodeId: o.nodeId || "",
    })),
    x: typeof n.x === "number" ? n.x : 100 + (i % 4) * 250,
    y: typeof n.y === "number" ? n.y : 80 + Math.floor(i / 4) * 220,
  }));
}

// ── Templates ─────────────────────────────────────────────────────

const TEMPLATES: Record<string, { name: string; welcome: string; nodes: Omit<FlowNode, never>[] }> = {
  accounting: {
    name: "مكتب محاسبة",
    welcome:
      "أهلاً وسهلاً في مكتب {الشركة} للمحاسبة والاستشارات المالية 📊\n\nكيف يمكننا خدمتك اليوم؟\n\n1️⃣ الخدمات المحاسبية\n2️⃣ الاستشارات الضريبية\n3️⃣ التدقيق والمراجعة\n4️⃣ التواصل معنا",
    nodes: [
      {
        id: "acct1", type: "keyword", label: "المحاسبة",
        keywords: "1, محاسبة, حسابات, قوائم",
        message: "خدماتنا المحاسبية تشمل:\n\n✅ إعداد القوائم المالية\n✅ دفتر الأستاذ\n✅ الرواتب والمستحقات\n✅ التقارير الشهرية\n\nللتواصل مع محاسبنا أرسل: تواصل",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل معنا", keyword: "تواصل", nodeId: "acct4" }],
        x: 40, y: 250,
      },
      {
        id: "acct2", type: "keyword", label: "الضرائب",
        keywords: "2, ضريبة, ضرائب, vat, زكاة",
        message: "خدماتنا الضريبية:\n\n✅ إقرارات ضريبة القيمة المضافة\n✅ ضريبة الشركات\n✅ الاسترداد الضريبي\n✅ الاستشارات الضريبية\n\nأرسل: تواصل للمزيد",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل معنا", keyword: "تواصل", nodeId: "acct4" }],
        x: 280, y: 250,
      },
      {
        id: "acct3", type: "keyword", label: "التدقيق",
        keywords: "3, تدقيق, مراجعة, audit",
        message: "خدمات التدقيق والمراجعة:\n\n✅ التدقيق الداخلي والخارجي\n✅ مراجعة الحسابات السنوية\n✅ تقارير الامتثال\n✅ اكتشاف المخالفات المالية\n\nأرسل: تواصل",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل معنا", keyword: "تواصل", nodeId: "acct4" }],
        x: 520, y: 250,
      },
      {
        id: "acct4", type: "response", label: "التواصل",
        keywords: "4, تواصل, اتصال, phone",
        message: "شكراً لتواصلك معنا 🙏\n\nسيتواصل معك أحد مستشارينا خلال 24 ساعة.\n\n📞 للاتصال المباشر: XXXXXXXXX\n📧 info@example.com\n🕐 الدوام: الأحد - الخميس 8ص - 5م",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 280, y: 470,
      },
    ],
  },

  restaurant: {
    name: "مطعم وجبات",
    welcome:
      "أهلاً وسهلاً في مطعم {الشركة} 🍽️\n\nكيف يمكننا خدمتك؟\n\n1️⃣ قائمة الطعام\n2️⃣ تقديم طلب\n3️⃣ مواعيد العمل\n4️⃣ موقعنا\n5️⃣ التواصل معنا",
    nodes: [
      {
        id: "rst1", type: "keyword", label: "قائمة الطعام",
        keywords: "1, قائمة, menu, طعام, وجبات",
        message: "🍽️ قائمة مطعمنا:\n\n🥩 الوجبات الرئيسية\n• برجر كلاسيكي - 25 ر.س\n• دجاج مشوي - 30 ر.س\n• ستيك لحم - 55 ر.س\n\n🥗 السلطات والمقبلات\n• سلطة سيزر - 18 ر.س\n• حساء اليوم - 15 ر.س\n\n🍰 الحلويات - 12-20 ر.س\n\nأرسل: طلب لإرسال طلبك",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تقديم طلب", keyword: "طلب", nodeId: "rst2" }],
        x: 40, y: 250,
      },
      {
        id: "rst2", type: "keyword", label: "تقديم طلب",
        keywords: "2, طلب, order, اطلب",
        message: "🛒 لتقديم طلبك أرسل:\n\n1. اسمك الكريم\n2. رقم جوالك\n3. عنوان التوصيل\n4. الوجبات المطلوبة\n\nسيتواصل معك فريقنا لتأكيد الطلب خلال 5 دقائق 🚀",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 280, y: 250,
      },
      {
        id: "rst3", type: "keyword", label: "مواعيد العمل",
        keywords: "3, مواعيد, اوقات, وقت, ساعات",
        message: "🕐 مواعيد عملنا:\n\n• السبت - الخميس: 11ص - 12م\n• الجمعة: 1م - 12م\n\n🚗 خدمة التوصيل متاحة حتى 11:30م\n📦 أقل طلب توصيل: 50 ر.س",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 520, y: 250,
      },
      {
        id: "rst4", type: "keyword", label: "الموقع",
        keywords: "4, موقع, عنوان, location, map",
        message: "📍 موقعنا:\n\nحي ..., شارع ...\nبالقرب من ...\n\n🗺 رابط الخريطة: [Google Maps]\n\n🚗 توصيل مجاني للطلبات فوق 100 ر.س",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 760, y: 250,
      },
      {
        id: "rst5", type: "response", label: "التواصل",
        keywords: "5, تواصل, اتصال, phone",
        message: "📞 تواصل معنا:\n\nهاتف: XXXXXXXXX\nواتساب: XXXXXXXXX\n\nنسعد بخدمتك دائماً 🙏",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 400, y: 470,
      },
    ],
  },

  clinic: {
    name: "عيادة طبية",
    welcome:
      "أهلاً بك في عيادة د. {الشركة} 🏥\n\nكيف يمكننا مساعدتك؟\n\n1️⃣ حجز موعد\n2️⃣ تخصصاتنا\n3️⃣ مواعيد العمل\n4️⃣ أسعار الكشف\n5️⃣ موقع العيادة",
    nodes: [
      {
        id: "cln1", type: "keyword", label: "حجز موعد",
        keywords: "1, حجز, موعد, appointment, booking",
        message: "📅 لحجز موعد يرجى إرسال:\n\n1. اسمك الكريم\n2. رقم جوالك\n3. التخصص المطلوب\n4. التاريخ المناسب\n\nسيتواصل معك موظف الاستقبال لتأكيد الحجز ✅\n\n⏰ وقت الرد: خلال ساعة في أوقات الدوام",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 40, y: 250,
      },
      {
        id: "cln2", type: "keyword", label: "التخصصات",
        keywords: "2, تخصص, تخصصات, طب, doctor",
        message: "👨‍⚕️ تخصصاتنا الطبية:\n\n• طب الأسرة والباطنية\n• طب الأطفال والرضع\n• طب العظام والمفاصل\n• أمراض النساء والتوليد\n• الجلدية والتجميل\n\nأرسل: حجز للحجز مع الطبيب المطلوب",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "احجز موعد", keyword: "حجز", nodeId: "cln1" }],
        x: 280, y: 250,
      },
      {
        id: "cln3", type: "keyword", label: "مواعيد العمل",
        keywords: "3, مواعيد, دوام, ساعات, وقت",
        message: "🕐 مواعيد العيادة:\n\nالسبت - الأربعاء: 8ص - 12م | 4م - 9م\nالخميس: 8ص - 12م\nالجمعة: مغلق\n\n🚨 للطوارئ: XXXXXXXXX",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 520, y: 250,
      },
      {
        id: "cln4", type: "keyword", label: "الأسعار",
        keywords: "4, سعر, أسعار, رسوم, كم, price",
        message: "💰 رسوم الكشف:\n\n• كشف عام: 100 ر.س\n• كشف متخصص: 150-200 ر.س\n• متابعة خلال 48 ساعة: مجاناً\n\n🏥 نقبل تأمين: (اذكر شركات التأمين)\n💳 جميع وسائل الدفع متاحة",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 760, y: 250,
      },
      {
        id: "cln5", type: "response", label: "الموقع",
        keywords: "5, موقع, عنوان, location",
        message: "📍 موقع العيادة:\n\nحي ..., شارع ...\nالدور ..., رقم ...\n\n🗺 Google Maps: [رابط]\n\n🚗 موقف سيارات مجاني متاح",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 400, y: 470,
      },
    ],
  },

  realEstate: {
    name: "شركة عقارات",
    welcome:
      "أهلاً بك في شركة {الشركة} العقارية 🏠\n\nكيف يمكننا خدمتك؟\n\n1️⃣ شقق للبيع\n2️⃣ فلل للبيع\n3️⃣ عقارات للإيجار\n4️⃣ تقييم عقار\n5️⃣ تواصل مع مستشار",
    nodes: [
      {
        id: "re1", type: "keyword", label: "شقق للبيع",
        keywords: "1, شقة, شقق, apartment, بيع",
        message: "🏢 شققنا المتاحة للبيع:\n\n✅ شقق 2 غرف: تبدأ من 350,000 ر.س\n✅ شقق 3 غرف: تبدأ من 450,000 ر.س\n✅ شقق فاخرة 4 غرف: تبدأ من 750,000 ر.س\n\n🌟 مميزات: موقف خاص، أمن 24 ساعة، قرب من الخدمات\n\nأرسل: تواصل لمعرفة المزيد",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل مع مستشار", keyword: "تواصل", nodeId: "re5" }],
        x: 40, y: 250,
      },
      {
        id: "re2", type: "keyword", label: "فلل للبيع",
        keywords: "2, فيلا, فلل, villa",
        message: "🏡 فللنا الفاخرة للبيع:\n\n✅ فلل دوبلكس: من 900,000 ر.س\n✅ فلل مستقلة: من 1,200,000 ر.س\n✅ فلل مع مسبح: من 1,800,000 ر.س\n\n🌿 حدائق خاصة، غرف خادمة، مواقف متعددة\n\nأرسل: تواصل لمعرفة المزيد",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل مع مستشار", keyword: "تواصل", nodeId: "re5" }],
        x: 280, y: 250,
      },
      {
        id: "re3", type: "keyword", label: "للإيجار",
        keywords: "3, إيجار, ايجار, rent, إيجارات",
        message: "🔑 عقارات متاحة للإيجار:\n\n• شقق مفروشة: من 2,500 ر.س/شهر\n• شقق غير مفروشة: من 1,800 ر.س/شهر\n• فلل: من 5,000 ر.س/شهر\n• محلات تجارية: حسب الموقع\n\nأرسل: تواصل للاستفسار",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل مع مستشار", keyword: "تواصل", nodeId: "re5" }],
        x: 520, y: 250,
      },
      {
        id: "re4", type: "keyword", label: "تقييم عقار",
        keywords: "4, تقييم, قيمة, كم يساوي, سعر",
        message: "📊 خدمة تقييم العقارات:\n\nنقدم تقييماً احترافياً لعقارك:\n✅ تقييم مجاني أولي\n✅ تقرير مفصل بالأسعار\n✅ مقارنة بالسوق الحالي\n\nأرسل عنوان العقار وسنتواصل معك خلال 24 ساعة",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 760, y: 250,
      },
      {
        id: "re5", type: "response", label: "تواصل مستشار",
        keywords: "5, تواصل, استشارة, مستشار",
        message: "👨‍💼 سيتواصل معك أحد مستشارينا العقاريين قريباً\n\n📞 للتواصل الفوري: XXXXXXXXX\n📧 info@example.com\n\n🕐 أوقات العمل: الأحد - الخميس 8ص - 6م\nالسبت: 9ص - 2م 🏡",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 400, y: 470,
      },
    ],
  },

  ecommerce: {
    name: "متجر إلكتروني",
    welcome:
      "أهلاً بك في متجر {الشركة} 🛒✨\n\nكيف يمكننا خدمتك؟\n\n1️⃣ تصفح المنتجات\n2️⃣ تتبع طلبي\n3️⃣ إرجاع واستبدال\n4️⃣ العروض والخصومات\n5️⃣ تواصل مع خدمة العملاء",
    nodes: [
      {
        id: "ec1", type: "keyword", label: "المنتجات",
        keywords: "1, منتجات, تصفح, shop, catalog",
        message: "🛍️ تصفح منتجاتنا:\n\n🔗 رابط المتجر: example.com\n\n📱 أو أرسل اسم المنتج وسنجده لك!\n\nفئاتنا الرئيسية:\n• إلكترونيات وأجهزة 📱\n• ملابس وأزياء 👗\n• منزل وديكور 🏠\n• رياضة وترفيه ⚽",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 40, y: 250,
      },
      {
        id: "ec2", type: "keyword", label: "تتبع الطلب",
        keywords: "2, تتبع, طلب, order, tracking",
        message: "📦 لتتبع طلبك:\n\nأرسل رقم الطلب (مثال: ORD-12345)\n\nأو أرسل بريدك الإلكتروني المسجل.\n\n⏰ وقت التوصيل المعتاد: 2-5 أيام عمل\n🚚 التوصيل داخل المدينة: 24-48 ساعة",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 280, y: 250,
      },
      {
        id: "ec3", type: "keyword", label: "الإرجاع",
        keywords: "3, إرجاع, استبدال, return, refund",
        message: "🔄 سياسة الإرجاع والاستبدال:\n\n✅ إرجاع مجاني خلال 14 يوم\n✅ المنتج يجب أن يكون بحالته الأصلية\n✅ استرداد كامل للمبلغ خلال 3-5 أيام\n\nللبدء أرسل: رقم الطلب + سبب الإرجاع",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 520, y: 250,
      },
      {
        id: "ec4", type: "keyword", label: "العروض",
        keywords: "4, عروض, خصومات, كوبون, discount, sale",
        message: "🎁 عروضنا الحالية:\n\n🔥 خصم 20% على الإلكترونيات\n💥 اشتري 2 واحصل على الثالث بالنصف\n⚡ شحن مجاني للطلبات فوق 200 ر.س\n\n🎫 كود الخصم: BLAST20\n⏳ العرض ينتهي قريباً!",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 760, y: 250,
      },
      {
        id: "ec5", type: "response", label: "خدمة العملاء",
        keywords: "5, تواصل, خدمة, مساعدة, help",
        message: "👋 خدمة عملاء متجرنا:\n\nنسعد بخدمتك!\n\n📞 XXXXXXXXX\n📧 support@example.com\n💬 واتساب: XXXXXXXXX\n\n⏰ متاحون: السبت - الخميس 9ص - 9م 🛒",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 400, y: 470,
      },
    ],
  },

  jewelry: {
    name: "محل ذهب ومجوهرات",
    welcome:
      "أهلاً بك في متجر {الشركة} للذهب والمجوهرات 💍✨\n\nاختر ما يناسبك:\n\n1️⃣ خواتم\n2️⃣ أطقم\n3️⃣ أساور ومحابس\n4️⃣ أسعار الذهب اليوم\n5️⃣ تواصل معنا",
    nodes: [
      {
        id: "jwl1", type: "keyword", label: "الخواتم",
        keywords: "1, خواتم, خاتم, ring",
        message: "💍 تشكيلة الخواتم الفاخرة\n\n✨ خواتم الزفاف والخطبة\n✨ خواتم السهرة المرصعة\n✨ خواتم يومية عصرية\n✨ تصاميم مخصصة حسب الطلب\n\nأرسل: سعر للاستفسار عن الأسعار",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "استفسار عن السعر", keyword: "سعر", nodeId: "jwl5" }],
        x: 20, y: 250,
      },
      {
        id: "jwl2", type: "keyword", label: "الأطقم",
        keywords: "2, أطقم, طقم, set",
        message: "✨ الأطقم الفاخرة\n\n💎 أطقم الذهب الأصفر 21/18 قيراط\n💎 أطقم الذهب الأبيض\n💎 أطقم الروز غولد\n💎 أطقم مع ألماس وأحجار كريمة\n\nأرسل: سعر للاستفسار",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "استفسار عن السعر", keyword: "سعر", nodeId: "jwl5" }],
        x: 255, y: 250,
      },
      {
        id: "jwl3", type: "keyword", label: "الأساور",
        keywords: "3, أساور, سوار, محبس, bracelet",
        message: "💎 تشكيلة الأساور والمحابس\n\n• أساور ذهب صفراء وبيضاء\n• محابس مرصعة بالألماس\n• أساور شخصية بالأسماء\n• تصاميم حديثة وكلاسيكية\n\nأرسل: سعر للاستفسار",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "استفسار عن السعر", keyword: "سعر", nodeId: "jwl5" }],
        x: 490, y: 250,
      },
      {
        id: "jwl4", type: "keyword", label: "أسعار الذهب",
        keywords: "4, أسعار, سعر ذهب, gold price",
        message: "📊 أسعار الذهب اليوم\n\n• عيار 24: يُحدَّث يومياً\n• عيار 22: يُحدَّث يومياً\n• عيار 21: يُحدَّث يومياً\n• عيار 18: يُحدَّث يومياً\n\nللأسعار اللحظية الدقيقة تواصل معنا 📞",
        mediaType: "text", mediaUrl: "",
        options: [{ text: "تواصل معنا", keyword: "تواصل", nodeId: "jwl5" }],
        x: 725, y: 250,
      },
      {
        id: "jwl5", type: "response", label: "التواصل",
        keywords: "5, تواصل, سعر, اتصال, استفسار",
        message: "شكراً لاهتمامك بمتجرنا 🙏\n\nسنتواصل معك قريباً لتزويدك بكل التفاصيل.\n\n📞 XXXXXXXXX\n📍 الموقع: ...\n🕐 الدوام: يومياً 9ص - 10م",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 380, y: 470,
      },
    ],
  },
};

// ── Node type config ───────────────────────────────────────────────

const NODE_TYPES: Record<NodeType, { label: string; color: string; border: string; dot: string }> = {
  welcome:  { label: "ترحيب",   color: "bg-emerald-500/15 text-emerald-300", border: "border-emerald-500/40", dot: "bg-emerald-400" },
  keyword:  { label: "كلمة مفتاحية", color: "bg-sky-500/15 text-sky-300",   border: "border-sky-500/40",     dot: "bg-sky-400" },
  response: { label: "رد",      color: "bg-orange-500/15 text-orange-300",   border: "border-orange-500/40",  dot: "bg-orange-400" },
};

const MEDIA_ICONS: Record<MediaType, React.ReactNode> = {
  text:  <MessageSquare className="w-3.5 h-3.5" />,
  image: <Image className="w-3.5 h-3.5" />,
  video: <Video className="w-3.5 h-3.5" />,
  file:  <FileText className="w-3.5 h-3.5" />,
  link:  <Globe className="w-3.5 h-3.5" />,
};

// ── NodeImageUploader ──────────────────────────────────────────────

function NodeImageUploader({ url, onChange }: { url: string; onChange: (u: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (data.path) onChange(data.path);
      else toast.error("فشل رفع الصورة");
    } catch { toast.error("فشل رفع الصورة"); }
    finally { setUploading(false); }
  };
  return (
    <div className="space-y-2">
      {url && (
        <div className="relative w-full rounded-lg overflow-hidden border border-border h-28 bg-black/30">
          <img src={url.startsWith("http") ? url : `/api${url}`} alt="" className="w-full h-full object-cover" />
          <button type="button" onClick={() => onChange("")}
            className="absolute top-1 left-1 p-1 bg-black/60 rounded-full text-white hover:bg-black/80">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <label className="flex items-center justify-center gap-2 w-full px-3 py-2 border border-dashed border-border rounded-lg text-xs text-muted-foreground hover:border-primary/40 hover:text-primary cursor-pointer transition-colors">
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {uploading ? "جاري الرفع..." : url ? "تغيير الصورة" : "رفع صورة"}
        <input type="file" accept="image/*" className="hidden" onChange={pick} disabled={uploading} />
      </label>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function NodeCard({
  node, isSelected,
  onMouseDown, onSelect, onDelete,
}: {
  node: FlowNode; isSelected: boolean;
  onMouseDown: (e: RMouseEvent) => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const cfg = NODE_TYPES[node.type];
  return (
    <div
      style={{ left: node.x, top: node.y, width: NODE_W, position: "absolute" }}
      className={cn(
        "rounded-xl border shadow-lg cursor-grab active:cursor-grabbing select-none transition-shadow",
        "bg-card",
        cfg.border,
        isSelected ? "ring-2 ring-primary shadow-primary/20 shadow-xl" : "hover:shadow-primary/10",
      )}
      onMouseDown={(e) => { onMouseDown(e); onSelect(); }}
    >
      {/* Header */}
      <div className={cn("flex items-center justify-between px-3 py-2 rounded-t-xl", cfg.color)}>
        <div className="flex items-center gap-1.5">
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", cfg.dot)} />
          <span className="text-xs font-semibold">{cfg.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs opacity-70">{MEDIA_ICONS[node.mediaType]}</span>
          {node.type !== "welcome" && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-0.5 opacity-60 hover:opacity-100 hover:text-red-400 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2.5 space-y-1.5">
        <p className="text-xs font-medium text-foreground truncate">{node.label || "بدون عنوان"}</p>
        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
          {node.message || <span className="italic opacity-50">لا توجد رسالة</span>}
        </p>
        {node.options.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {node.options.slice(0, 3).map((opt, i) => (
              <span key={i} className="flex items-center gap-1 text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full border border-primary/20">
                <Link2 className="w-2.5 h-2.5" /> {opt.text || "خيار"}
              </span>
            ))}
            {node.options.length > 3 && (
              <span className="text-[9px] text-muted-foreground">+{node.options.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {/* Input port (top) */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border-2 border-border flex items-center justify-center">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
      </div>
      {/* Output port (bottom) */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border-2 border-primary/50 flex items-center justify-center">
        <div className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export default function ChatbotBuilder() {
  const params = useParams<{ id: string }>();
  const id = params.id ? parseInt(params.id) : null;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingBot, isLoading } = useGetChatbot(id!, { query: { enabled: !!id } as any });

  // ── State ────────────────────────────────────────────────────────
  const [botName, setBotName]           = useState("");
  const [welcomeMsg, setWelcomeMsg]     = useState("");
  const [nodes, setNodes]               = useState<FlowNode[]>([]);
  const [enabled, setEnabled]           = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAI, setShowAI]       = useState(false);
  const [aiPrompt, setAiPrompt]   = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [dragging, setDragging]         = useState<{ id: string; ox: number; oy: number } | null>(null);

  // ── Populate from server ─────────────────────────────────────────
  useEffect(() => {
    if (existingBot) {
      setBotName(existingBot.name);
      setWelcomeMsg(existingBot.welcomeMessage);
      setEnabled(existingBot.enabled);
      try {
        const raw = JSON.parse(existingBot.nodes);
        setNodes(Array.isArray(raw) ? migrate(raw) : []);
      } catch {
        setNodes([]);
      }
    }
  }, [existingBot]);

  // ── Drag ──────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: RMouseEvent, nodeId: string) => {
    e.preventDefault();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    setDragging({ id: nodeId, ox: e.clientX - rect.left - node.x, oy: e.clientY - rect.top - node.y });
  }, [nodes]);

  const onMouseMove = useCallback((e: RMouseEvent) => {
    if (!dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const nx = Math.max(0, e.clientX - rect.left - dragging.ox);
    const ny = Math.max(0, e.clientY - rect.top  - dragging.oy);
    setNodes((prev) => prev.map((n) => n.id === dragging.id ? { ...n, x: nx, y: ny } : n));
  }, [dragging]);

  const onMouseUp = useCallback(() => setDragging(null), []);

  // ── Node CRUD ─────────────────────────────────────────────────────
  const addNode = (type: NodeType = "keyword") => {
    const newId = uid();
    const count = nodes.length;
    setNodes((prev) => [
      ...prev,
      {
        id: newId, type,
        label: type === "response" ? "رد" : "خيار جديد",
        keywords: "", message: "",
        mediaType: "text", mediaUrl: "",
        options: [],
        x: 80 + (count % 4) * 260,
        y: 80 + Math.floor(count / 4) * 240,
      },
    ]);
    setSelectedId(newId);
  };

  const deleteNode = (nodeId: string) => {
    if (nodes.find((n) => n.id === nodeId)?.type === "welcome") return;
    setNodes((prev) =>
      prev
        .filter((n) => n.id !== nodeId)
        .map((n) => ({ ...n, options: n.options.filter((o) => o.nodeId !== nodeId) }))
    );
    if (selectedId === nodeId) setSelectedId(null);
  };

  const updateNode = (nodeId: string, patch: Partial<FlowNode>) => {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, ...patch } : n));
  };

  const updateOption = (nodeId: string, idx: number, patch: Partial<FlowOption>) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const opts = [...n.options];
        opts[idx] = { ...opts[idx], ...patch };
        return { ...n, options: opts };
      })
    );
  };

  const addOption = (nodeId: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, options: [...n.options, { text: "", keyword: "", nodeId: "" }] }
          : n
      )
    );
  };

  const removeOption = (nodeId: string, idx: number) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId ? { ...n, options: n.options.filter((_, i) => i !== idx) } : n
      )
    );
  };

  // ── Load template ──────────────────────────────────────────────────
  const loadTemplate = (key: string) => {
    const tpl = TEMPLATES[key];
    if (!tpl) return;
    setBotName(tpl.name);
    setWelcomeMsg(tpl.welcome);
    setNodes(tpl.nodes.map((n) => ({ ...n })));
    setSelectedId(null);
    setShowTemplates(false);
    toast.success("تم تحميل القالب");
  };

  // ── Mutations ─────────────────────────────────────────────────────
  const createMutation = useCreateChatbot({
    mutation: {
      onSuccess: (data) => {
        toast.success("تم إنشاء الشات بوت");
        queryClient.invalidateQueries({ queryKey: getListChatbotsQueryKey() });
        navigate(`/chatbots/${data.id}`);
      },
      onError: () => toast.error("حدث خطأ"),
    },
  });

  const updateMutation = useUpdateChatbot({
    mutation: {
      onSuccess: () => {
        toast.success("تم حفظ التغييرات");
        queryClient.invalidateQueries({ queryKey: getGetChatbotQueryKey(id!) });
      },
      onError: () => toast.error("حدث خطأ"),
    },
  });

  const toggleMutation = useToggleChatbot({
    mutation: {
      onSuccess: (data) => {
        setEnabled(data.enabled);
        toast.success(data.enabled ? "تم تفعيل الشات بوت" : "تم تعطيل الشات بوت");
      },
    },
  });

  const generateWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const xs = [40, 280, 520, 760, 1000];
      const example = {
        name: "اسم الشات بوت",
        welcomeMessage: "رسالة ترحيب مع قائمة مرقمة 1️⃣ خيار أول  2️⃣ خيار ثاني",
        nodes: [
          { id: "n1", type: "keyword", label: "خيار أول", keywords: "1,خيار أول", message: "رد على الخيار الأول 🎯", mediaType: "text", mediaUrl: "", options: [{ text: "رجوع", keyword: "رجوع", nodeId: "" }], x: 40, y: 250 },
          { id: "n2", type: "response", label: "رد نهائي", keywords: "رجوع,رد", message: "شكراً لك ✅", mediaType: "text", mediaUrl: "", options: [], x: 280, y: 470 },
        ],
      };
      const userMsg = `أنشئ شات بوت واتساب احترافي باللغة العربية لـ: "${aiPrompt}".
أعطني JSON واحد فقط بدون أي نص إضافي، بهذا الشكل بالضبط:
${JSON.stringify(example)}
القواعد: كل النصوص عربية مع إيموجي، 4-6 عقد keyword ثم عقد response، options فارغ في response.`;

      const apiRes = await fetch("https://text.pollinations.ai/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "أنت خبير بناء شات بوت واتساب. أرجع JSON فقط بدون markdown." },
            { role: "user",   content: userMsg },
          ],
          model: "openai-fast",
          jsonMode: true,
          seed: Date.now() % 9999,
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!apiRes.ok) throw new Error("خدمة الذكاء الاصطناعي غير متاحة — حاول لاحقاً");
      const text = await apiRes.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("فشل تحليل الاستجابة — حاول مجدداً");
      const raw = JSON.parse(jsonMatch[0]);

      const botNameAI    = raw.name || raw.botName || raw.title || `شات بوت ${aiPrompt}`;
      const welcomeMsgAI = raw.welcomeMessage || raw.welcome || raw.greeting || `أهلاً بك في ${aiPrompt}`;
      const rawNodes: any[] = Array.isArray(raw.nodes) ? raw.nodes
                            : Array.isArray(raw.steps)  ? raw.steps
                            : Array.isArray(raw.flow)   ? raw.flow : [];

      const builtNodes: FlowNode[] = rawNodes.map((n: any, i: number) => ({
        id:        n.id   || `n${i + 1}`,
        type:      (n.type as NodeType) || (Array.isArray(n.options) && n.options.length > 0 ? "keyword" : "response"),
        label:     n.label || n.name || n.title || `عقدة ${i + 1}`,
        keywords:  n.keywords || n.triggers || n.keyword || String(i + 1),
        message:   n.message || n.response || n.reply || n.text || "",
        mediaType: (n.mediaType as MediaType) || "text",
        mediaUrl:  n.mediaUrl || n.media || "",
        options: Array.isArray(n.options)
          ? n.options.map((o: any, j: number) => ({
              text:    typeof o === "string" ? o : (o.text || o.label || String(o)),
              keyword: typeof o === "string" ? o : (o.keyword || o.key || o.text || String(j + 1)),
              nodeId:  typeof o === "string" ? "" : (o.nodeId || o.node || o.id || ""),
            }))
          : [],
        x: typeof n.x === "number" ? n.x : (xs[i % xs.length] ?? 40),
        y: typeof n.y === "number" ? n.y : (i < 6 ? 250 : 470),
      }));

      setBotName(botNameAI);
      setWelcomeMsg(welcomeMsgAI);
      setNodes(builtNodes.length > 0 ? builtNodes : []);
      setSelectedId(null);
      setShowAI(false);
      setAiPrompt("");
      toast.success("تم إنشاء الشات بوت بالذكاء الاصطناعي ✨");
    } catch (err: any) {
      toast.error(err.message || "فشل الإنشاء — حاول مجدداً");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = () => {
    if (!botName.trim() || !welcomeMsg.trim()) {
      toast.error("يرجى ملء الاسم ورسالة الترحيب");
      return;
    }
    const nodesStr = JSON.stringify(nodes);
    if (id) {
      updateMutation.mutate({ id, data: { name: botName, welcomeMessage: welcomeMsg, nodes: nodesStr } });
    } else {
      createMutation.mutate({ data: { name: botName, welcomeMessage: welcomeMsg, nodes: nodesStr } });
    }
  };

  // ── SVG Connections ────────────────────────────────────────────────
  const connections: { d: string; label: string }[] = [];
  for (const node of nodes) {
    for (const opt of node.options) {
      const target = nodes.find((n) => n.id === opt.nodeId);
      if (!target) continue;
      const sx = node.x + NODE_W / 2;
      const sy = node.y + NODE_H_BASE;
      const tx = target.x + NODE_W / 2;
      const ty = target.y;
      const cy = (sy + ty) / 2;
      connections.push({
        d: `M ${sx} ${sy} C ${sx} ${cy}, ${tx} ${cy}, ${tx} ${ty}`,
        label: opt.text,
      });
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const isPending = createMutation.isPending || updateMutation.isPending;
  const canvasH = Math.max(560, ...nodes.map((n) => n.y + NODE_H_BASE + 80));
  const canvasW = Math.max(900, ...nodes.map((n) => n.x + NODE_W + 80));

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inp = "w-full px-2.5 py-1.5 bg-input border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-card-border bg-card flex-shrink-0">
        <Link href="/chatbots" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <ArrowRight className="w-4 h-4" />
        </Link>
        <input
          type="text" value={botName} onChange={(e) => setBotName(e.target.value)}
          placeholder="اسم الشات بوت..."
          className="flex-1 bg-transparent text-sm font-semibold text-foreground placeholder:text-muted-foreground outline-none border-b border-transparent focus:border-border"
        />
        <button
          onClick={() => setShowTemplates(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors border border-border"
        >
          <LayoutTemplate className="w-3.5 h-3.5" /> قوالب جاهزة
        </button>
        <button
          onClick={() => setShowAI(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors border border-primary/30"
        >
          <Bot className="w-3.5 h-3.5" /> ذكاء اصطناعي
        </button>
        {id && (
          <button
            onClick={() => toggleMutation.mutate({ id })}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              enabled
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                : "bg-muted text-muted-foreground border-border"
            )}
          >
            <Power className="w-3.5 h-3.5" />
            {enabled ? "مفعّل" : "معطّل"}
          </button>
        )}
        <button
          onClick={handleSave} disabled={isPending}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          حفظ
        </button>
      </div>

      {/* ── Main Area ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-[#07120b] relative" style={{ backgroundImage: "radial-gradient(#1a3a26 1px, transparent 1px)", backgroundSize: "28px 28px" }}>
          {/* Toolbar */}
          <div className="sticky top-3 left-3 z-10 flex gap-2 px-3">
            {(["keyword", "response"] as NodeType[]).map((t) => {
              const cfg = NODE_TYPES[t];
              return (
                <button
                  key={t}
                  onClick={() => addNode(t)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border backdrop-blur-sm transition-colors",
                    cfg.color, cfg.border, "bg-card/80 hover:bg-card"
                  )}
                >
                  <Plus className="w-3 h-3" /> {cfg.label}
                </button>
              );
            })}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground border border-border bg-card/60 backdrop-blur-sm">
              {nodes.length} عقدة
            </div>
          </div>

          {/* Scrollable canvas */}
          <div
            ref={canvasRef}
            style={{ width: canvasW, height: canvasH, position: "relative" }}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {/* SVG connections */}
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: canvasW, height: canvasH }}
            >
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                  <path d="M0,0 L0,8 L8,4 z" fill="#25d366" opacity="0.7" />
                </marker>
              </defs>
              {connections.map((c, i) => (
                <path
                  key={i}
                  d={c.d}
                  stroke="#25d366"
                  strokeWidth="1.5"
                  fill="none"
                  strokeDasharray="5 3"
                  opacity="0.55"
                  markerEnd="url(#arrow)"
                />
              ))}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={selectedId === node.id}
                onMouseDown={(e) => onNodeMouseDown(e, node.id)}
                onSelect={() => setSelectedId(node.id)}
                onDelete={() => deleteNode(node.id)}
              />
            ))}

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Sparkles className="w-10 h-10 opacity-30" />
                <p className="text-sm font-medium">ابدأ ببناء مسار المحادثة</p>
                <p className="text-xs">اختر قالباً جاهزاً أو أضف عقدة جديدة</p>
                <button
                  onClick={() => setShowTemplates(true)}
                  className="mt-2 flex items-center gap-2 px-4 py-2 bg-primary/15 text-primary border border-primary/30 rounded-lg text-sm hover:bg-primary/20 transition-colors"
                >
                  <LayoutTemplate className="w-4 h-4" /> اختر قالباً جاهزاً
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel: node editor ───────────────────────── */}
        <div className="w-72 border-r border-card-border bg-card flex flex-col overflow-hidden flex-shrink-0">
          {selectedNode ? (
            <>
              <div className={cn("flex items-center justify-between px-4 py-3 border-b border-card-border", NODE_TYPES[selectedNode.type].color)}>
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", NODE_TYPES[selectedNode.type].dot)} />
                  <span className="text-xs font-semibold">{NODE_TYPES[selectedNode.type].label}</span>
                </div>
                <button onClick={() => setSelectedId(null)} className="p-1 opacity-60 hover:opacity-100">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Label */}
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">عنوان العقدة</label>
                  <input type="text" value={selectedNode.label}
                    onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })}
                    placeholder="مثال: صفحة الأسعار" className={inp} />
                </div>

                {/* Keywords */}
                {selectedNode.type !== "response" && (
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">كلمات مفتاحية</label>
                    <input type="text" value={selectedNode.keywords}
                      onChange={(e) => updateNode(selectedNode.id, { keywords: e.target.value })}
                      placeholder="مثال: أسعار, 2, price" className={inp} />
                    <p className="text-[9px] text-muted-foreground mt-1">افصل بين الكلمات بفاصلة</p>
                  </div>
                )}

                {/* Media type */}
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">نوع المحتوى</label>
                  <div className="grid grid-cols-5 gap-1">
                    {(["text","image","video","file","link"] as MediaType[]).map((mt) => (
                      <button
                        key={mt}
                        onClick={() => updateNode(selectedNode.id, { mediaType: mt })}
                        className={cn(
                          "flex flex-col items-center gap-1 p-1.5 rounded-lg border text-[9px] transition-colors",
                          selectedNode.mediaType === mt
                            ? "bg-primary/20 border-primary/50 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        {MEDIA_ICONS[mt]}
                        {{ text: "نص", image: "صورة", video: "فيديو", file: "ملف", link: "رابط" }[mt]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Media URL / Upload */}
                {selectedNode.mediaType !== "text" && (
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                      {{ image: "صورة العقدة", video: "رابط الفيديو", file: "رابط الملف", link: "الرابط", text: "" }[selectedNode.mediaType]}
                    </label>
                    {selectedNode.mediaType === "image" ? (
                      <NodeImageUploader
                        url={selectedNode.mediaUrl}
                        onChange={(url) => updateNode(selectedNode.id, { mediaUrl: url })}
                      />
                    ) : (
                      <input type="url" value={selectedNode.mediaUrl} dir="ltr"
                        onChange={(e) => updateNode(selectedNode.id, { mediaUrl: e.target.value })}
                        placeholder="https://..." className={inp} />
                    )}
                  </div>
                )}

                {/* Message */}
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">الرسالة</label>
                  <textarea value={selectedNode.message}
                    onChange={(e) => updateNode(selectedNode.id, { message: e.target.value })}
                    placeholder="اكتب الرسالة هنا..." rows={5}
                    className={inp + " resize-none leading-relaxed"} />
                </div>

                {/* Options */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">خيارات الرد ({selectedNode.options.length})</label>
                    <button onClick={() => addOption(selectedNode.id)}
                      className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                      <Plus className="w-2.5 h-2.5" /> إضافة
                    </button>
                  </div>
                  <div className="space-y-2">
                    {selectedNode.options.map((opt, i) => (
                      <div key={i} className="bg-input/50 rounded-lg p-2 space-y-1.5 border border-border">
                        <div className="flex items-center gap-1">
                          <input type="text" value={opt.text} placeholder="نص الزر"
                            onChange={(e) => updateOption(selectedNode.id, i, { text: e.target.value, keyword: e.target.value })}
                            className={inp + " flex-1"} />
                          <button onClick={() => removeOption(selectedNode.id, i)}
                            className="p-1 text-red-400 hover:bg-red-500/10 rounded flex-shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <select value={opt.nodeId}
                          onChange={(e) => updateOption(selectedNode.id, i, { nodeId: e.target.value })}
                          className={inp + " bg-input"}>
                          <option value="">-- يذهب إلى... --</option>
                          {nodes.filter((n) => n.id !== selectedNode.id).map((n) => (
                            <option key={n.id} value={n.id}>{n.label || n.id}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {selectedNode.options.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-2">لا توجد خيارات — هذا المسار ينتهي هنا</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
              <MessageSquare className="w-8 h-8 opacity-30" />
              <p className="text-xs">اضغط على أي عقدة في اللوحة لتعديل محتواها</p>

              {/* Welcome message editor when nothing is selected */}
              <div className="w-full mt-4 text-right">
                <label className="block text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">رسالة الترحيب</label>
                <textarea value={welcomeMsg} onChange={(e) => setWelcomeMsg(e.target.value)}
                  placeholder="مرحباً! كيف يمكنني مساعدتك؟" rows={5}
                  className="w-full px-2.5 py-1.5 bg-input border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none leading-relaxed" />
                <p className="text-[9px] text-muted-foreground mt-1">تُرسَل عند أول رسالة من المستخدم</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Templates Modal ────────────────────────────────────── */}
      {/* ── AI Generator Modal ─────────────────────────────────── */}
      {showAI && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-card border border-card-border rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-card-border">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Bot className="w-5 h-5 text-primary" /> إنشاء شات بوت بالذكاء الاصطناعي
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">مجاني تماماً — لا يحتاج API Key</p>
              </div>
              <button onClick={() => { setShowAI(false); setAiPrompt(""); }}
                className="p-2 hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-2 block font-medium">
                  صف نشاطك التجاري وما تريده من الشات بوت:
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="مثال: أنا صاحب مطعم وجبات سريعة في الرياض، أريد شات بوت يعرض القائمة ويقبل الطلبات ويعطي معلومات التوصيل..."
                  rows={4}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {["مطعم برغر", "عيادة أسنان", "متجر ملابس", "شركة سياحة"].map((ex) => (
                  <button key={ex} onClick={() => setAiPrompt(`شات بوت لـ ${ex}`)}
                    className="px-3 py-2 border border-border rounded-lg text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors text-right">
                    💡 {ex}
                  </button>
                ))}
              </div>
              <button
                onClick={generateWithAI}
                disabled={aiLoading || !aiPrompt.trim()}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {aiLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الإنشاء (15-25 ثانية)...</>
                  : <><Sparkles className="w-4 h-4" />إنشاء الشات بوت ✨</>
                }
              </button>
              <p className="text-[10px] text-muted-foreground text-center">
                مدعوم بـ Pollinations AI · مجاني بدون تسجيل أو بطاقة ائتمان
              </p>
            </div>
          </div>
        </div>
      )}

      {showTemplates && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-card border border-card-border rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-card-border">
              <div>
                <h3 className="text-base font-bold text-foreground">قوالب جاهزة</h3>
                <p className="text-xs text-muted-foreground mt-0.5">اختر قالباً كنقطة بداية وعدّل عليه</p>
              </div>
              <button onClick={() => setShowTemplates(false)} className="p-2 hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              {Object.entries(TEMPLATES).map(([key, tpl]) => (
                <button
                  key={key}
                  onClick={() => loadTemplate(key)}
                  className="group text-right p-4 rounded-xl border border-card-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all"
                >
                  <div className="text-2xl mb-2">
                    {{ accounting: "📊", jewelry: "💍", restaurant: "🍽️", clinic: "🏥", realEstate: "🏠", ecommerce: "🛒" }[key] ?? "🤖"}
                  </div>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {tpl.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {tpl.nodes.length} عقدة جاهزة
                  </p>
                </button>
              ))}
              {/* Blank template */}
              <button
                onClick={() => {
                  setBotName("شات بوت جديد"); setWelcomeMsg(""); setNodes([
                    { id: uid(), type: "welcome", label: "الترحيب", keywords: "", message: "مرحباً! كيف يمكنني مساعدتك؟", mediaType: "text", mediaUrl: "", options: [], x: 330, y: 50 },
                  ]); setShowTemplates(false);
                }}
                className="group text-right p-4 rounded-xl border border-dashed border-card-border hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="text-2xl mb-2">✏️</div>
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">ابدأ من الصفر</p>
                <p className="text-xs text-muted-foreground mt-1">لوحة فارغة بعقدة ترحيب</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
