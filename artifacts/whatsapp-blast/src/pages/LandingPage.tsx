import { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useSpring, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import {
  MessageCircle, Users, BarChart3, Bot, Zap, ChevronDown, Star,
  CheckCircle2, ArrowLeft, Shield, TrendingUp, Clock, Target,
  Smartphone, Globe, Award, Play, LayoutDashboard, Languages, UtensilsCrossed, QrCode,
} from "lucide-react";

// ── Bilingual Content ──────────────────────────────────────────────
// Everything here is something the product does today. The counters are
// facts about the product, not usage numbers, and the «مواقف» are scenarios,
// not customer quotes — real ones go here when there are real customers.
const CONTENT = {
  ar: {
    dir: "rtl" as const,
    fontClass: "font-cairo",
    nav: {
      contact: "تواصل معنا",
      login: "دخول",
      start: "ابدأ مجاناً",
      demo: "منيو تجريبي",
      dashboard: "لوحة التحكم",
    },
    badge: "المنيو الرقمي والصف الرقمي عبر واتساب",
    headline: "منيو أنيق وصف انتظار رقمي يكلّم زبائنك على واتساب",
    sub: "رابط واحد أو QR على الباب: المنيو، الطلب، الدور، والحجز — بدون تطبيق ولا تسجيل.",
    subEn: "Digital Menu · Digital Queue · WhatsApp",
    ctaStart: "أنشئ منيو محلك الآن",
    ctaDemo: "شاهد منيو تجريبي",
    ctaContact: "تواصل مباشرة",
    trustQuote: {
      label: "الحقيقة التي يعرفها كل صاحب محل مزدحم",
      text: "الزبون ما يمشي لأن الانتظار طويل — يمشي لأنه ما يعرف كم بيطول.",
      highlight: "ما يعرف كم بيطول",
      body: "ليلة الزحمة يقف الناس على الباب، يسألون «باقي كثير؟»، وبعضهم يمشي بدون ما يقول شيئاً. مع رقم واضح ووقت تقريبي ورسالة «جاء دورك» على واتساب، الزبون ينتظر وهو مرتاح — في سيارته أو في المول.",
      cta: "هنا يأتي دور منيو فور يو.",
    },
    stats: [
      { label: "تطبيق يحمّله الزبون", to: 0, suffix: "" },
      { label: "رابط واحد لكل شيء",  to: 1, suffix: "" },
      { label: "لغتان: عربي وإنجليزي", to: 2, suffix: "" },
      { label: "قوالب جاهزة للمنيو",  to: 4, suffix: "" },
    ],
    industries: {
      label: "لمن هو؟",
      title: "مصمَّم لأربعة أنواع من المحلات",
      body: "نفس النظام، بمصطلحات كل محل: طبق أو منتج أو خدمة، طاولة أو موعد أو طلب مسبق.",
      items: [
        { icon: "🍽️", title: "المطاعم", body: "منيو بالصور، طلب داخل المحل برقم الطاولة أو سفري أو توصيل، وصف انتظار للطاولات ليلة الزحمة." },
        { icon: "☕", title: "الكافيهات", body: "دور الطلبات برقم لكل زبون، وشاشة «الآن يُخدم» على الكاونتر، ورسالة لما يجهز الطلب." },
        { icon: "🍰", title: "محلات الحلويات", body: "صواني وكيك بالطلب المسبق: الزبون يختار الحجم ويوم الاستلام، ويوصله «طلبك جاهز»." },
        { icon: "💅", title: "صالونات التجميل", body: "خدمات لها مدة، مواعيد بأوقات متاحة فعلاً، ودور للحضور المباشر بدون وقوف عند الاستقبال." },
      ],
    },
    whyWa: {
      title: "ثلاث خطوات من الباب إلى الطاولة",
      sub: "الزبون يستخدم ما عنده أصلاً: كاميرا الجوال وواتساب.",
      items: [
        { stat: "١", label: "يمسح الكود", body: "على الباب أو الطاولة أو من رابط أرسلته له — يفتح المنيو فوراً بدون تحميل ولا حساب." },
        { stat: "٢", label: "يحجز دوره أو يطلب", body: "يشوف كم قدامه والوقت التقريبي، أو يرسل طلبه مرتّباً على واتساب المحل." },
        { stat: "٣", label: "يوصله «جاء دورك»", body: "الموظف يضغط «التالي» — شاشة الزبون تتحول وتوصله رسالة واتساب من رقم محلك." },
      ],
    },
    features: {
      label: "المميزات",
      title: "كل ما يحتاجه محلك في مكان واحد",
      items: [
        { title: "منيو رقمي بالصور والحركات", body: "أقسام مصوّرة، بطاقات للأصناف، عروض، بحث، عربي وإنجليزي — بألوان محلك وشعاره." },
        { title: "السلة تنتهي على واتساب",   body: "الطلب يوصلك مكتوباً برقمه وإجماليه. السعر يحسبه النظام من المنيو، ما يقدر أحد يغيّره." },
        { title: "صف انتظار رقمي",           body: "رقم لكل زبون، وقت تقريبي يتعلّم من سرعة خدمتك اليوم، وزر «التالي» واحد للموظف." },
        { title: "حجوزات وطلبات مسبقة",      body: "طاولة، موعد صالون، أو صينية ليوم معيّن — مع تأكيد وتذكير على واتساب." },
        { title: "مضيف ذكي على واتساب",      body: "يرد على «بكم الكنافة؟» و«متى تفتحون؟» من المنيو نفسه، ولا يخترع سعراً ولا صنفاً." },
        { title: "فروع وموظفون",             body: "كل فرع برابطه وصفّه ورقم واتسابه إن أردت، وكل موظف يشوف شاشته فقط." },
        { title: "شاشة «الآن يُخدم»",         body: "على تلفزيون المحل: الأرقام كبيرة، القادمون، وكود الانضمام للصف." },
        { title: "حملات ومتابعات",           body: "عروضك تصل فقط لمن وافق عليها، مع حماية رقمك من الحظر في كل إرسال." },
        { title: "تقارير صادقة",             body: "متوسط الانتظار، عدم الحضور، الأكثر طلباً — وكم كان الوقت الموعود دقيقاً." },
      ],
    },
    differentiators: {
      title: "ما الذي يجعل منيو فور يو مختلفاً؟",
      items: [
        "الزبون لا يحمّل تطبيقاً ولا يسجّل حساباً",
        "المنيو والصف والحجز والطلب في رابط واحد",
        "إشعارات «جاء دورك» من رقم واتساب محلك نفسه",
        "كل شيء يشتغل حتى لو انقطع واتساب — صفحة الدور حيّة دائماً",
        "استيراد المنيو من Excel أو من صورة المنيو الورقي",
        "لوحة تحكم عربية للمالك وشاشة بسيطة للموظف",
        "طقم QR جاهز للطباعة: ملصق الكاونتر وبطاقات الطاولات",
        "الرسائل تصل فقط لمن راسلك أو وافق — رقمك بأمان",
      ],
    },
    pricing: {
      label: "الاشتراكات",
      title: "اختر الباقة المناسبة لمحلك",
      sub: "بدون رسوم على الطلبات. بدون عمولات. ابدأ بالتجربة ثم اختر.",
      note: "أنت تركّز على ضيوفك، والنظام يرتّب الصف والطلبات.",
      plans: [
        { label: "الأساسية", price: "99", period: "درهم / شهر", features: ["منيو رقمي بالصور والأقسام", "الطلب على واتساب", "QR جاهز للطباعة", "عربي وإنجليزي", "فرع واحد", "3 موظفين"], cta: "اشترك الآن", highlight: false },
        { label: "الشاملة", price: "199", period: "درهم / شهر", badge: "الأكثر طلباً", features: ["كل مميزات الأساسية", "صف الانتظار الرقمي والحجوزات", "إشعارات واتساب «جاء دورك» و«طلبك جاهز»", "المضيف الذكي على واتساب", "حملات واتساب بلا حد وإعادة الاستهداف", "حملة أسبوعية آلية لزبائنك", "التسويق بالبريد الإلكتروني", "فروع وموظفون بلا حد"], cta: "ابدأ الاشتراك", highlight: true },
        { label: "الشاملة — سنوي", price: "800", period: "درهم / سنة", badge: "وفّر 66%", features: ["كل مميزات الشاملة", "سنة كاملة بسعر 4 أشهر", "وفّر 1,588 درهم"], cta: "اشترك سنوياً", highlight: false },
      ],
    },
    testimonials: {
      label: "مواقف من يوم مزدحم",
      title: "كيف يشتغل على أرض الواقع؟",
      items: [
        { name: "ليلة الخميس — مطعم مشويات", text: "عشرون على الباب. كل واحد يمسح الكود وياخذ رقمه ويرجع لسيارته. المضيف يضغط «التالي» وتوصل الرسالة — بدون أسماء تُنادى ولا زحمة عند المدخل." },
        { name: "قبل العيد — محل حلويات", text: "الزبونة تختار صينية الكنافة وحجمها ويوم الاستلام من المنيو، وترسل الطلب على واتساب مكتوباً بالتاريخ والإجمالي. يوم الاستلام توصلها «طلبك جاهز»." },
        { name: "عصر الجمعة — صالون تجميل", text: "من عندها موعد يوصلها تذكير قبله، ومن تمر بدون موعد تمسح الكود وتاخذ دورها وتطلع تشتري قهوة حتى يوصلها «جاء دورك»." },
      ],
    },
    faq: {
      title: "أسئلة شائعة",
      items: [
        { q: "هل يحتاج الزبون تطبيقاً أو حساباً؟", a: "لا. يفتح الرابط أو يمسح الكود ويكمل مباشرة من المتصفح." },
        { q: "هل أحتاج خبرة تقنية؟", a: "لا. تكتب اسم المحل، ترفع الشعار، تضيف الأصناف — أو ترفع ملف Excel أو صورة المنيو الورقي — والكود جاهز للطباعة." },
        { q: "كيف يوصل الزبون إشعار دوره؟", a: "عند الانضمام يفتح واتساب برسالة جاهزة فيها رمز تذكرته. لما يرسلها نربط رقمه بالتذكرة ونرسل له لما يقرب دوره ولما يجي." },
        { q: "هل أحتاج واتساب بزنس؟", a: "لا، يعمل مع واتساب العادي. تربط رقم المحل بمسح QR من لوحة التحكم. وننصح برقم مخصص للمحل لا رقمك الشخصي." },
        { q: "ماذا لو انقطع واتساب؟", a: "المنيو والصف وصفحة التذكرة تكمل بدون أي تأثير. فقط الإشعارات تتوقف حتى يرجع الاتصال." },
        { q: "هل توجد رسوم على الطلبات؟", a: "لا. اشتراك شهري فقط — بدون عمولة على الطلب وبدون رسوم لكل رسالة." },
      ],
    },
    cta: {
      title: "جهّز منيو محلك اليوم، وخلّ الصف يمشي لحاله.",
      body: "اكتب اسم المحل، ارفع الشعار، أضف الأصناف — والكود جاهز للطباعة على الباب والطاولات.",
      btnStart: "ابدأ الآن",
      btnDemo: "احجز عرضاً مباشراً",
    },
    footer: {
      contact: "واتساب",
      email: "دخول الموظفين",
      pricing: "الاشتراكات",
      rights: `© ${new Date().getFullYear()} منيو فور يو. جميع الحقوق محفوظة.`,
      privacy: "سياسة الخصوصية",
      terms: "الشروط والأحكام",
    },
    modal: {
      title: "العرض التوضيحي",
      body: "تواصل معنا على واتساب ونرتّب لك عرضاً مباشراً على منيو محلك.",
      cta: "طلب العرض على واتساب",
      close: "إغلاق",
    },
  },

  en: {
    dir: "ltr" as const,
    fontClass: "font-inter",
    nav: {
      contact: "Contact",
      login: "Sign in",
      start: "Start free",
      demo: "Demo menu",
      dashboard: "Dashboard",
    },
    badge: "Digital menu & digital queue on WhatsApp",
    headline: "A beautiful menu and a digital queue that talks to guests on WhatsApp",
    sub: "One link or a QR on the door: the menu, ordering, the queue and bookings — no app, no sign-up.",
    subEn: "منيو رقمي · صف رقمي · واتساب",
    ctaStart: "Create your menu now",
    ctaDemo: "See a demo menu",
    ctaContact: "Contact us",
    trustQuote: {
      label: "What every busy shop owner knows",
      text: "Guests don't leave because the wait is long — they leave because they don't know how long.",
      highlight: "they don't know how long",
      body: "On a busy night people stand at the door asking \"much longer?\", and some walk away without a word. With a clear number, an estimated wait and a WhatsApp \"it's your turn\", guests wait at ease — in the car or the mall.",
      cta: "That's where Menu For You comes in.",
    },
    stats: [
      { label: "Apps for guests to install", to: 0, suffix: "" },
      { label: "Link for everything",        to: 1, suffix: "" },
      { label: "Languages: Arabic & English", to: 2, suffix: "" },
      { label: "Ready-made menu templates",  to: 4, suffix: "" },
    ],
    industries: {
      label: "Who is it for?",
      title: "Built for four kinds of shop",
      body: "One system in each shop's own words: dish, product or service; table, appointment or pre-order.",
      items: [
        { icon: "🍽️", title: "Restaurants", body: "A photo menu, dine-in by table number, takeaway or delivery, and a waitlist for busy nights." },
        { icon: "☕", title: "Cafés", body: "An order queue with a number per guest, a \"now serving\" screen at the counter, and a message when it's ready." },
        { icon: "🍰", title: "Sweets shops", body: "Trays and cakes by pre-order: pick a size and pickup day, then get \"your order is ready\"." },
        { icon: "💅", title: "Beauty salons", body: "Services with durations, appointments in genuinely free slots, and a walk-in queue without standing at reception." },
      ],
    },
    whyWa: {
      title: "Three steps from the door to the table",
      sub: "Guests use what they already have: the phone camera and WhatsApp.",
      items: [
        { stat: "1", label: "Scan the code", body: "On the door, the table or a link you sent — the menu opens at once, nothing to install." },
        { stat: "2", label: "Join the line or order", body: "See how many are ahead and the estimated wait, or send a tidy order to the shop's WhatsApp." },
        { stat: "3", label: "Get \"it's your turn\"", body: "Staff press Next — the guest's screen changes and a WhatsApp message arrives from your number." },
      ],
    },
    features: {
      label: "Features",
      title: "Everything your shop needs in one place",
      items: [
        { title: "A photo menu that moves",   body: "Photo sections, item cards, offers, search, Arabic and English — in your colours and logo." },
        { title: "The cart ends on WhatsApp", body: "Orders arrive written out with a number and total. Prices come from the menu, not the browser." },
        { title: "Digital queue",             body: "A number per guest, a wait that learns from today's pace, and one Next button for staff." },
        { title: "Bookings & pre-orders",     body: "A table, a salon slot or a tray for a set day — confirmed and reminded on WhatsApp." },
        { title: "Smart WhatsApp host",       body: "Answers \"how much is the kunafa?\" from your menu, and never invents a price or a dish." },
        { title: "Branches & staff",          body: "Each branch with its link, queue and its own WhatsApp number if you like; staff see only their screen." },
        { title: "\"Now serving\" screen",     body: "On the shop's TV: big numbers, who's next, and a code to join." },
        { title: "Campaigns & follow-ups",    body: "Offers reach only guests who agreed, with your number protected on every send." },
        { title: "Honest reports",            body: "Average wait, no-shows, best sellers — and how accurate the promised wait was." },
      ],
    },
    differentiators: {
      title: "What makes Menu For You different?",
      items: [
        "Guests install nothing and create no account",
        "Menu, queue, booking and ordering in one link",
        "\"It's your turn\" from your own shop's WhatsApp number",
        "Everything works even if WhatsApp drops — the ticket page is always live",
        "Import the menu from Excel or a photo of the paper menu",
        "An Arabic dashboard for the owner and a simple screen for staff",
        "A print-ready QR kit: counter poster and table cards",
        "Messages go only to guests who wrote first or agreed",
      ],
    },
    pricing: {
      label: "Plans",
      title: "Choose the plan for your shop",
      sub: "No fees on orders. No commissions. Start with a trial, then choose.",
      note: "You look after your guests; the system looks after the line.",
      plans: [
        { label: "Basic", price: "99", period: "AED / month", features: ["Photo menu with sections", "WhatsApp ordering", "Print-ready QR", "Arabic & English", "One branch", "3 staff"], cta: "Subscribe", highlight: false },
        { label: "Full", price: "199", period: "AED / month", badge: "Most popular", features: ["Everything in Basic", "Digital queue & bookings", "WhatsApp \"your turn\" and \"order ready\" alerts", "Smart WhatsApp host", "Unlimited WhatsApp campaigns & retargeting", "Automatic weekly campaign", "Email marketing", "Unlimited branches & staff"], cta: "Start now", highlight: true },
        { label: "Full — yearly", price: "800", period: "AED / year", badge: "Save 66%", features: ["Everything in Full", "A full year for the price of four months", "Save AED 1,588"], cta: "Subscribe yearly", highlight: false },
      ],
    },
    testimonials: {
      label: "A busy day, three shops",
      title: "How does it work on the ground?",
      items: [
        { name: "Thursday night — a grill restaurant", text: "Twenty at the door. Each scans the code, takes a number and goes back to the car. The host presses Next and the message arrives — no names shouted, no crowd at the entrance." },
        { name: "Before Eid — a sweets shop", text: "A customer picks a kunafa tray, its size and pickup day from the menu and sends the order on WhatsApp with the date and total. On the day she gets \"your order is ready\"." },
        { name: "Friday afternoon — a beauty salon", text: "Clients with appointments get a reminder; walk-ins scan the code, take a place in line and go for a coffee until \"it's your turn\" arrives." },
      ],
    },
    faq: {
      title: "FAQ",
      items: [
        { q: "Do guests need an app or an account?", a: "No. They open the link or scan the code and carry on in the browser." },
        { q: "Do I need technical skills?", a: "No. Type your shop's name, upload the logo and add items — or upload an Excel file or a photo of the paper menu — and the QR is ready to print." },
        { q: "How do guests get notified?", a: "On joining, WhatsApp opens with a ready message carrying their ticket code. Once sent, we link their number and message them when they're close and when it's their turn." },
        { q: "Do I need WhatsApp Business?", a: "No, ordinary WhatsApp works. Link the shop's number by scanning a QR in the dashboard. We recommend a dedicated shop number." },
        { q: "What if WhatsApp disconnects?", a: "The menu, queue and ticket page carry on unaffected. Only notifications pause until it reconnects." },
        { q: "Are there fees on orders?", a: "No. A monthly subscription only — no commission per order and no per-message fees." },
      ],
    },
    cta: {
      title: "Set up your menu today, and let the line run itself.",
      body: "Type your shop's name, upload the logo, add items — and the QR is ready for the door and the tables.",
      btnStart: "Start now",
      btnDemo: "Book a live demo",
    },
    footer: {
      contact: "WhatsApp",
      email: "Staff sign-in",
      pricing: "Plans",
      rights: `© ${new Date().getFullYear()} Menu For You. All rights reserved.`,
      privacy: "Privacy policy",
      terms: "Terms",
    },
    modal: {
      title: "Live demo",
      body: "Message us on WhatsApp and we'll arrange a live demo on your shop's menu.",
      cta: "Request the demo on WhatsApp",
      close: "Close",
    },
  },
};

// ── Animated Counter ──────────────────────────────────────────────
function AnimatedCounter({ from = 0, to, suffix = "", duration = 2 }: {
  from?: number; to: number; suffix?: string; duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const motionVal = useMotionValue(from);
  const spring = useSpring(motionVal, { duration: duration * 1000, bounce: 0 });
  const [display, setDisplay] = useState(from);

  useEffect(() => {
    if (inView) motionVal.set(to);
  }, [inView, to, motionVal]);

  useEffect(() => spring.on("change", (v) => setDisplay(Math.round(v))), [spring]);

  return <span ref={ref}>{display.toLocaleString("en")}{suffix}</span>;
}

// ── Floating Particle ─────────────────────────────────────────────
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  delay: i * 0.4,
  x: `${5 + (i * 5.3) % 90}%`,
  y: `${10 + (i * 7.1) % 80}%`,
  size: 4 + (i % 5) * 3,
}));

function Particle({ delay, x, y, size }: { delay: number; x: string; y: string; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full bg-green-400/20 pointer-events-none"
      style={{ left: x, top: y, width: size, height: size }}
      animate={{ y: [0, -30, 0], opacity: [0.2, 0.6, 0.2], scale: [1, 1.3, 1] }}
      transition={{ duration: 4 + Math.random() * 3, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

// ── Section wrapper ───────────────────────────────────────────────
function Section({ children, className = "", id }: {
  children: React.ReactNode; className?: string; id?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section ref={ref} id={id}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

// ── FAQ Item ──────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10 last:border-0">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-right gap-4 group">
        <span className="font-semibold text-white group-hover:text-green-400 transition-colors">{q}</span>
        <ChevronDown className={`w-5 h-5 text-green-400 flex-shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
            <p className="pb-5 text-white/60 text-sm leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Dynamic Plan type (from API) ──────────────────────────────────
interface DynamicPlan {
  id: number;
  name: string;
  name_en: string | null;
  price: string;
  period: string;
  period_label: string | null;
  features: string[];
  features_en: string[] | null;
  badge: string | null;
  badge_en: string | null;
  is_featured: boolean;
}

/** Demo shops shown on the home page; the ones that exist on this install appear. */
const DEMO_SLUGS = ["bait-shami", "alreem-sweets", "lamsa-salon"];

// ── Subscribe Modal ────────────────────────────────────────────────
function SubscribeModal({ planName, salesWaNum, onClose, lang }: {
  planName: string; salesWaNum: string; onClose: () => void; lang: "ar" | "en";
}) {
  const [name,     setName]     = useState("");
  const [phone,    setPhone]    = useState("");
  const [biz,      setBiz]      = useState("");
  const [size,     setSize]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [sent,     setSent]     = useState(false);

  const isAr = lang === "ar";
  const bizOptions = isAr
    ? ["مطعم", "كافيه", "محل حلويات", "صالون تجميل", "أخرى"]
    : ["Restaurant", "Café", "Sweets shop", "Beauty salon", "Other"];
  const sizeOptions = isAr
    ? ["فرع واحد", "2 - 3 فروع", "4 - 10 فروع", "أكثر من 10"]
    : ["One branch", "2 - 3 branches", "4 - 10 branches", "More than 10"];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    setLoading(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, planName, businessType: biz, estimatedCustomers: size }),
      });
    } catch {}
    setSent(true);
    setLoading(false);
    const msg = isAr
      ? `مرحباً، أريد الاشتراك في *${planName}*\n\nالاسم: ${name}\nالجوال: ${phone}\nنوع المحل: ${biz}\nالفروع: ${size}`
      : `Hello, I want to subscribe to *${planName}*\n\nName: ${name}\nPhone: ${phone}\nBusiness: ${biz}`;
    setTimeout(() => {
      window.open(`https://wa.me/${salesWaNum}?text=${encodeURIComponent(msg)}`, "_blank");
      onClose();
    }, 1_200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-[#0c1a10] border border-green-500/30 rounded-2xl p-6 w-full max-w-md shadow-2xl shadow-green-900/40 z-10">
        <button onClick={onClose} className="absolute top-4 left-4 text-white/40 hover:text-white text-xl leading-none">✕</button>
        {sent ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-green-400" />
            </div>
            <p className="text-white font-bold text-lg mb-1">{isAr ? "شكراً لك!" : "Thank you!"}</p>
            <p className="text-white/50 text-sm">{isAr ? "جاري فتح واتساب للتواصل..." : "Opening WhatsApp..."}</p>
          </div>
        ) : (
          <>
            <p className="text-green-400 text-xs font-semibold uppercase tracking-widest mb-1">{isAr ? "طلب اشتراك" : "Subscribe"}</p>
            <h3 className="text-white font-black text-xl mb-5">{planName}</h3>
            <form onSubmit={submit} className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder={isAr ? "الاسم" : "Your name"}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-green-500/50" />
              <input required value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder={isAr ? "رقم الجوال *" : "Phone number *"} dir="ltr"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-green-500/50" />
              <select value={biz} onChange={(e) => setBiz(e.target.value)}
                className="w-full bg-[#0c1a10] border border-white/10 rounded-xl px-4 py-3 text-sm text-white/70 focus:outline-none focus:border-green-500/50">
                <option value="">{isAr ? "نوع المحل" : "Type of shop"}</option>
                {bizOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={size} onChange={(e) => setSize(e.target.value)}
                className="w-full bg-[#0c1a10] border border-white/10 rounded-xl px-4 py-3 text-sm text-white/70 focus:outline-none focus:border-green-500/50">
                <option value="">{isAr ? "عدد الفروع" : "Number of branches"}</option>
                {sizeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <button type="submit" disabled={loading || !phone}
                className="w-full py-3.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2">
                {loading ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
                {isAr ? "أرسل الطلب عبر واتساب ←" : "Send Request via WhatsApp →"}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Price Card ────────────────────────────────────────────────────
function PriceCard({ label, price, period, badge, features, cta, highlight, delay, onSubscribe }: {
  label: string; price: string; period: string; badge?: string;
  features: string[]; cta: string; highlight?: boolean; delay: number;
  onSubscribe: (planLabel: string) => void;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, y: 50 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ delay, duration: 0.6 }}
      className={`relative rounded-2xl p-8 flex flex-col ${highlight
        ? "bg-gradient-to-b from-green-600/30 to-green-900/20 border-2 border-green-400/50 shadow-2xl shadow-green-500/20"
        : "bg-white/5 border border-white/10"}`}
    >
      {badge && (
        <div className="absolute -top-4 right-6 bg-green-500 text-black text-xs font-bold px-4 py-1.5 rounded-full">
          {badge}
        </div>
      )}
      <p className="text-sm text-white/60 mb-2">{label}</p>
      <div className="mb-1">
        <span className="text-4xl font-black text-white">{price}</span>
        <span className="text-white/40 text-sm mr-2">{period}</span>
      </div>
      <div className="h-px bg-white/10 my-6" />
      <ul className="space-y-3 flex-1 mb-8">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-white/70">
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>
      <button onClick={() => onSubscribe(label)}
        className={`w-full py-3.5 rounded-xl font-bold text-center text-sm transition-all cursor-pointer ${highlight
          ? "bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/30"
          : "bg-white/10 hover:bg-white/20 text-white border border-white/20"}`}>
        {cta}
      </button>
    </motion.div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────
export default function LandingPage() {
  const { user } = useAuth();
  const [lang, setLang] = useState<"ar" | "en">(() =>
    (localStorage.getItem("mfy-lang") as "ar" | "en") || "ar"
  );
  const [videoOpen,   setVideoOpen]   = useState(false);
  const [waNum,       setWaNum]       = useState("971588951186");
  const [salesWaNum,  setSalesWaNum]  = useState("971588951186");
  const [plans,       setPlans]       = useState<DynamicPlan[]>([]);
  const [subscribeModal, setSubscribeModal] = useState<{ open: boolean; planName: string }>({ open: false, planName: "" });

  const c = CONTENT[lang];

  // Save lang preference
  useEffect(() => {
    localStorage.setItem("mfy-lang", lang);
  }, [lang]);

  // Load settings + dynamic plans
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.whatsappNumber) setWaNum(d.whatsappNumber);
        if (d.salesWhatsapp)  setSalesWaNum(d.salesWhatsapp);
        else if (d.whatsappNumber) setSalesWaNum(d.whatsappNumber);
      })
      .catch(() => {});
    fetch("/api/plans")
      .then((r) => r.json())
      .then((data: DynamicPlan[]) => { if (Array.isArray(data) && data.length) setPlans(data); })
      .catch(() => {});
  }, []);

  // The live demo shops, when this install has them.
  const [demos, setDemos] = useState<Array<{ slug: string; name: string; tagline: string; kind: string; cover: string | null; logo: string | null }>>([]);
  useEffect(() => {
    const KIND: Record<string, [string, string]> = { restaurant: ["مطعم", "Restaurant"], cafe: ["كافيه", "Café"], sweets: ["حلويات", "Sweets"], beauty: ["صالون تجميل", "Beauty salon"], barber: ["حلاقة رجالي", "Barbershop"] };
    Promise.all(DEMO_SLUGS.map((slug) => fetch(`/api/public/m/${slug}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((list) => setDemos(list.filter(Boolean).map((m: any) => ({
        slug: m.org.slug,
        name: lang === "en" && m.org.nameEn ? m.org.nameEn : m.org.name,
        tagline: (lang === "en" && m.org.taglineEn ? m.org.taglineEn : m.org.tagline) ?? "",
        kind: (KIND[m.org.vertical] ?? KIND.restaurant!)[lang === "ar" ? 0 : 1]!,
        cover: m.org.coverUrl, logo: m.org.logoUrl,
      }))));
  }, [lang]);

  const openSubscribe = (planName: string) => setSubscribeModal({ open: true, planName });
  const closeSubscribe = () => setSubscribeModal({ open: false, planName: "" });

  const toggleLang = () => setLang((l) => (l === "ar" ? "en" : "ar"));

  return (
    <div
      className={`min-h-screen bg-[#050f0a] text-white overflow-x-hidden ${c.fontClass}`}
      dir={c.dir}
      style={{ fontFamily: lang === "ar" ? "'Cairo', sans-serif" : "'Inter', sans-serif" }}
    >
      {/* ── NAV ──────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-black" />
            </div>
            <span className="font-black text-lg tracking-tight">{lang === "ar" ? "منيو فور يو" : "Menu For You"}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language Toggle */}
            <button onClick={toggleLang}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white border border-white/15 hover:border-white/30 rounded-lg transition-all">
              <Languages className="w-3.5 h-3.5" />
              {lang === "ar" ? "EN" : "ع"}
            </button>
            <a href="#demos" className="hidden md:block text-sm text-white/70 hover:text-white transition-colors">{c.nav.demo}</a>
            <a href="#pricing" className="hidden md:block text-sm text-white/70 hover:text-white transition-colors">{c.footer.pricing}</a>
            <a href={`https://wa.me/${waNum}`} target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors">
              <MessageCircle className="w-4 h-4 text-green-400" />
              {c.nav.contact}
            </a>
            {user ? (
              <Link href="/shop"
                className="flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-400 text-black font-bold text-sm rounded-lg transition-colors">
                <LayoutDashboard className="w-3.5 h-3.5" />
                {c.nav.dashboard}
              </Link>
            ) : (
              <>
                <Link href="/login"
                  className="px-3 py-2 text-sm font-semibold text-white/70 hover:text-white transition-colors">
                  {c.nav.login}
                </Link>
                <Link href="/login?register=1"
                  className="px-4 py-2 bg-green-500 hover:bg-green-400 text-black font-bold text-sm rounded-lg transition-colors">
                  {c.nav.start}
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        <motion.div className="absolute inset-0 pointer-events-none"
          animate={{ background: [
            "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(34,197,94,0.15) 0%, transparent 70%)",
            "radial-gradient(ellipse 80% 60% at 55% 35%, rgba(16,185,129,0.18) 0%, transparent 70%)",
            "radial-gradient(ellipse 80% 60% at 45% 45%, rgba(34,197,94,0.12) 0%, transparent 70%)",
          ]}}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 pointer-events-none">
          {PARTICLES.map((p, i) => <Particle key={i} {...p} />)}
        </div>
        <div className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: "linear-gradient(#22c55e 1px, transparent 1px), linear-gradient(90deg, #22c55e 1px, transparent 1px)", backgroundSize: "60px 60px" }}
        />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/25 rounded-full px-5 py-2 text-sm text-green-400 font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            {c.badge}
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl sm:text-5xl md:text-6xl font-black leading-tight mb-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-green-400 to-emerald-300">
              {c.headline}
            </span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-xl text-white/50 mb-3 font-medium">{c.sub}</motion.p>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25 }}
            className="text-base text-white/30 mb-10" dir={lang === "ar" ? "ltr" : "rtl"}>
            {c.subEn}
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="flex flex-wrap items-center justify-center gap-4">
            <Link href={user ? "/shop" : "/login?register=1"}
              className="flex items-center gap-2.5 px-6 sm:px-7 py-4 bg-green-500 hover:bg-green-400 text-black font-black rounded-xl text-base transition-all shadow-2xl shadow-green-500/30 hover:shadow-green-400/40 hover:scale-105">
              <QrCode className="w-5 h-5" />
              {c.ctaStart}
            </Link>
            <a href="#demos"
              className="flex items-center gap-2.5 px-6 sm:px-7 py-4 bg-white/8 hover:bg-white/14 border border-white/15 text-white font-bold rounded-xl text-base transition-all">
              <Play className="w-5 h-5 text-green-400 fill-green-400" />
              {c.ctaDemo}
            </a>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2">
            <motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 1.8, repeat: Infinity }}>
              <ChevronDown className="w-6 h-6 text-white/25" />
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* ── TRUST QUOTE ──────────────────────────────────────────── */}
      <Section className="py-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-sm text-green-400 font-medium mb-6">
            <TrendingUp className="w-4 h-4" />
            {c.trustQuote.label}
          </div>
          <blockquote className="text-2xl sm:text-3xl font-bold text-white leading-relaxed mb-6">
            "{c.trustQuote.text.split(c.trustQuote.highlight).map((part, i, arr) => (
              i < arr.length - 1
                ? <span key={i}>{part}<span className="text-green-400">{c.trustQuote.highlight}</span></span>
                : <span key={i}>{part}</span>
            ))}"
          </blockquote>
          <p className="text-white/50 text-base leading-relaxed max-w-2xl mx-auto">
            {c.trustQuote.body}
            <br /><br />
            <strong className="text-white">{c.trustQuote.cta}</strong>
          </p>
        </div>
      </Section>

      {/* ── LIVE DEMOS ───────────────────────────────────────────── */}
      {demos.length > 0 && (
        <Section className="py-16 px-4 sm:px-6" id="demos">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3">{lang === "ar" ? "أمثلة حيّة" : "Live examples"}</p>
              <h2 className="text-3xl sm:text-4xl font-black text-white">{lang === "ar" ? "افتح منيو حقيقي وجرّبه بنفسك" : "Open a real menu and try it"}</h2>
              <p className="text-white/50 mt-4 max-w-xl mx-auto">{lang === "ar" ? "تصفّح الأصناف، أضف للسلة، واحجز دورك — كما يراه زبونك." : "Browse the items, add to the cart and join the queue — just as your guest sees it."}</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {demos.map((d, i) => (
                <motion.a key={d.slug} href={`/${d.slug}`} target="_blank" rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }} transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="group bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-green-500/40 transition-all duration-300">
                  <div className="relative h-44 overflow-hidden">
                    {d.cover && <img src={d.cover} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#050f0a] via-transparent to-transparent" />
                    <span className="absolute top-3 right-3 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500 text-black">{d.kind}</span>
                  </div>
                  <div className="p-5 flex items-center gap-3">
                    {d.logo && <img src={d.logo} alt="" className="w-12 h-12 rounded-xl object-cover -mt-10 relative border-2 border-[#050f0a]" />}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white truncate">{d.name}</h3>
                      <p className="text-white/50 text-xs truncate">{d.tagline}</p>
                    </div>
                    <span className="text-green-400 text-sm font-bold whitespace-nowrap">{lang === "ar" ? "افتح ←" : "Open →"}</span>
                  </div>
                </motion.a>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* ── STATS ────────────────────────────────────────────────── */}
      <Section className="py-16 px-4 sm:px-6 border-y border-white/5">
        <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {c.stats.map((s, i) => (
            <div key={i}>
              <div className="text-3xl sm:text-4xl font-black text-green-400 tabular-nums">
                <AnimatedCounter to={s.to} suffix={s.suffix} />
              </div>
              <p className="text-white/50 text-sm mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── INDUSTRIES ───────────────────────────────────────────── */}
      <Section className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3">{c.industries.label}</p>
            <h2 className="text-3xl sm:text-4xl font-black text-white">{c.industries.title}</h2>
            <p className="text-white/50 mt-4 max-w-xl mx-auto">{c.industries.body}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {c.industries.items.map((item, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }} transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-green-500/40 hover:bg-white/8 transition-all duration-300">
                <div className="text-3xl mb-4">{item.icon}</div>
                <h3 className="font-bold text-white text-lg mb-3">{item.title}</h3>
                <p className="text-white/60 text-sm leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── WHY WHATSAPP ─────────────────────────────────────────── */}
      <Section className="py-20 px-4 sm:px-6 bg-gradient-to-b from-green-900/10 to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">{c.whyWa.title}</h2>
            <p className="text-white/50 max-w-lg mx-auto">{c.whyWa.sub}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {c.whyWa.items.map((item, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }} transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-7 text-center hover:border-green-500/30 transition-all">
                <div className="text-4xl font-black text-green-400 mb-1">{item.stat}</div>
                <div className="font-bold text-white mb-2">{item.label}</div>
                <p className="text-white/50 text-sm">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <Section className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3">{c.features.label}</p>
            <h2 className="text-3xl sm:text-4xl font-black text-white">{c.features.title}</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {c.features.items.map((item, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-60px" }} transition={{ delay: i * 0.05, duration: 0.5 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-green-500/30 transition-all">
                <div className="w-12 h-12 rounded-xl bg-green-500/15 flex items-center justify-center mb-4">
                  <Zap className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="font-bold text-white mb-2">{item.title}</h3>
                <p className="text-white/55 text-sm leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── DIFFERENTIATORS ──────────────────────────────────────── */}
      <Section className="py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-green-900/30 to-emerald-900/20 border border-green-500/20 rounded-3xl p-8 sm:p-12">
            <div className="flex items-center gap-3 mb-8">
              <Award className="w-7 h-7 text-green-400" />
              <h2 className="text-2xl font-black text-white">{c.differentiators.title}</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {c.differentiators.items.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <span className="text-white/80 text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── PRICING ──────────────────────────────────────────────── */}
      <Section className="py-24 px-4 sm:px-6" id="pricing">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3">{c.pricing.label}</p>
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">{c.pricing.title}</h2>
            <p className="text-white/50 max-w-md mx-auto text-sm">{c.pricing.sub}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {plans.length > 0
              ? plans.map((plan, i) => (
                  <PriceCard key={plan.id}
                    label={lang === "ar" ? plan.name : (plan.name_en || plan.name)}
                    price={Number(plan.price).toLocaleString("en-US")}
                    period={plan.period_label || plan.period}
                    badge={lang === "ar" ? (plan.badge || undefined) : (plan.badge_en || plan.badge || undefined)}
                    features={lang === "ar" ? plan.features : (plan.features_en || plan.features)}
                    cta={lang === "ar" ? "اشترك الآن" : "Subscribe Now"}
                    highlight={plan.is_featured}
                    delay={i * 0.1}
                    onSubscribe={openSubscribe}
                  />
                ))
              : c.pricing.plans.map((plan, i) => (
                  <PriceCard key={i} {...plan} delay={i * 0.1} onSubscribe={openSubscribe} />
                ))
            }
          </div>
          <p className="text-center text-white/30 text-sm mt-10">{c.pricing.note}</p>
        </div>
      </Section>

      {/* ── TESTIMONIALS ─────────────────────────────────────────── */}
      <Section className="py-20 px-4 sm:px-6 bg-gradient-to-b from-transparent to-green-900/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-3">{c.testimonials.label}</p>
            <h2 className="text-3xl font-black text-white">{c.testimonials.title}</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-5">
            {c.testimonials.items.map((t, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }} transition={{ delay: i * 0.1 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <p className="text-sm font-bold text-green-400 mb-3">{t.name}</p>
                <p className="text-white/70 text-sm leading-relaxed">{t.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <Section className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black text-white">{c.faq.title}</h2>
          </div>
          <div className="bg-white/3 border border-white/8 rounded-2xl p-6 sm:p-8">
            {c.faq.items.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}
          </div>
        </div>
      </Section>

      {/* ── CTA BOTTOM ───────────────────────────────────────────── */}
      <Section className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative bg-gradient-to-br from-green-600/25 to-emerald-900/20 border border-green-500/25 rounded-3xl p-8 sm:p-14 overflow-hidden">
            <motion.div className="absolute inset-0 pointer-events-none"
              animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 4, repeat: Infinity }}
              style={{ background: "radial-gradient(ellipse 60% 50% at 50% 100%, rgba(34,197,94,0.2), transparent)" }}
            />
            <div className="relative z-10">
              <h2 className="text-2xl sm:text-3xl font-black text-white mb-4">{c.cta.title}</h2>
              <p className="text-white/55 mb-8 leading-relaxed">{c.cta.body}</p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <a href={`https://wa.me/${waNum}?text=${lang === "ar" ? "أريد الاشتراك في منيو فور يو" : "I want to subscribe to Menu For You"}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-7 py-4 bg-green-500 hover:bg-green-400 text-black font-black rounded-xl text-base transition-all shadow-2xl shadow-green-500/30 hover:scale-105">
                  <MessageCircle className="w-5 h-5 fill-black" />
                  {c.cta.btnStart}
                </a>
                <a href={`https://wa.me/${waNum}?text=${lang === "ar" ? "أريد حجز عرض مباشر" : "I want to book a live demo"}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-7 py-4 bg-white/10 hover:bg-white/18 border border-white/20 text-white font-bold rounded-xl text-base transition-all">
                  <ArrowLeft className="w-5 h-5" />
                  {c.cta.btnDemo}
                </a>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="border-t border-white/8 py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                <UtensilsCrossed className="w-4 h-4 text-black" />
              </div>
              <span className="font-black text-lg">{lang === "ar" ? "منيو فور يو" : "Menu For You"}</span>
            </div>
            <div className="flex items-center gap-5">
              <a href={`https://wa.me/${waNum}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm text-white/50 hover:text-green-400 transition-colors">
                <MessageCircle className="w-4 h-4" />
                {c.footer.contact}
              </a>
              <a href="/staff-login" className="text-sm text-white/50 hover:text-white transition-colors">
                {c.footer.email}
              </a>
              <a href="#pricing" className="text-sm text-white/50 hover:text-white transition-colors">
                {c.footer.pricing}
              </a>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/25">
            <p>{c.footer.rights}</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-white/50 transition-colors">{c.footer.privacy}</a>
              <a href="#" className="hover:text-white/50 transition-colors">{c.footer.terms}</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ── VIDEO MODAL ──────────────────────────────────────────── */}
      <AnimatePresence>
        {videoOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setVideoOpen(false)}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }} onClick={(e) => e.stopPropagation()}
              className="bg-white/5 border border-white/15 rounded-2xl p-8 text-center max-w-md w-full">
              <Smartphone className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">{c.modal.title}</h3>
              <p className="text-white/50 text-sm mb-6">{c.modal.body}</p>
              <a href={`https://wa.me/${waNum}?text=${lang === "ar" ? "أريد مشاهدة العرض التوضيحي" : "I want to see the demo"}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-400 text-black font-bold rounded-xl text-sm transition-colors">
                <MessageCircle className="w-4 h-4 fill-black" />
                {c.modal.cta}
              </a>
              <button onClick={() => setVideoOpen(false)} className="mt-3 text-sm text-white/40 hover:text-white/70 transition-colors">
                {c.modal.close}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SUBSCRIBE MODAL ──────────────────────────────────────── */}
      <AnimatePresence>
        {subscribeModal.open && (
          <SubscribeModal
            planName={subscribeModal.planName}
            salesWaNum={salesWaNum}
            onClose={closeSubscribe}
            lang={lang}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
