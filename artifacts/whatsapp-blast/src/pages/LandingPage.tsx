// ── The public home page ──────────────────────────────────────────
// What a shop owner sees before signing up. Every claim here is something
// the product does today; there are no invented numbers, ratings or
// testimonials, and plan prices come from the admin's plan table (or say
// «تواصل معنا» when none are set).

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import {
  QrCode, MessageCircle, Users, CalendarDays, Store, Bot, Tv, BarChart3, Sparkles, Bell, ArrowLeft, ArrowRight,
  CheckCircle2, UtensilsCrossed, Coffee, CakeSlice, Scissors, Languages, ChevronDown, Clock,
} from "lucide-react";

type Lang = "ar" | "en";

const C = {
  ar: {
    nav: { features: "المزايا", how: "كيف يعمل", plans: "الخطط", faq: "أسئلة", login: "دخول", staff: "دخول الموظفين", start: "ابدأ مجاناً", dashboard: "لوحة التحكم" },
    hero: {
      kicker: "للمطاعم والكافيهات والحلويات وصالونات التجميل",
      title: ["منيو أنيق،", "وصف انتظار رقمي", "يكلّم زبائنك على واتساب"],
      sub: "رابط واحد أو QR على الباب: الزبون يشوف المنيو بالصور، يطلب على واتساب، يحجز دوره بدون تطبيق ولا تسجيل — ويوصله «جاء دورك» على واتساب.",
      cta: "أنشئ منيو محلك", demo: "شوف منيو تجريبي",
      note: "بدون تطبيق للزبون · عربي وإنجليزي · يشتغل على أي جوال",
    },
    how: {
      title: "من الباب إلى الطاولة في ثلاث خطوات",
      steps: [
        { t: "يمسح الكود", d: "على الباب أو الطاولة أو من رابط أرسلته له — يفتح المنيو فوراً، بدون تحميل وبدون حساب." },
        { t: "يحجز دوره", d: "يشوف كم قدامه والوقت التقريبي، ويتابع دوره حيّاً وهو بالسيارة أو بالمول." },
        { t: "يوصله «جاء دورك»", d: "الموظف يضغط «التالي» — شاشة الزبون تتحول، وتوصله رسالة واتساب من رقم محلك." },
      ],
    },
    features: {
      title: "كل اللي يحتاجه محلك في رابط واحد",
      list: [
        { i: "menu", t: "منيو رقمي بحركات", d: "صور تكبر عند اللمس، تصنيفات تتابع التمرير، أربعة قوالب أنيقة بألوان محلك." },
        { i: "wa", t: "السلة تنتهي على واتساب", d: "الطلب يوصلك مرتّب برقمه وإجماليه — والسعر يحسبه الخادم، ما يقدر أحد يغيّره." },
        { i: "queue", t: "صف انتظار رقمي", d: "رقم لكل زبون، وقت تقريبي يتعلّم من سرعة خدمتك اليوم، وزر «التالي» واحد للموظف." },
        { i: "book", t: "حجوزات وطلبات مسبقة", d: "طاولة، موعد صالون، أو صينية ليوم الخميس — مع تذكير قبل الموعد." },
        { i: "bot", t: "مضيف ذكي على واتساب", d: "يرد على «بكم الكنافة؟» من المنيو نفسه، ولا يخترع سعراً ولا صنفاً غير موجود." },
        { i: "store", t: "فروع وموظفون", d: "كل فرع برابطه وصفه، ورقم واتساب له إذا تبي، وكل موظف يشوف شاشته فقط." },
        { i: "tv", t: "شاشة «الآن يُخدم»", d: "على تلفزيون المحل: الأرقام الكبيرة، القادمون، وكود الانضمام للصف." },
        { i: "chart", t: "تقارير صادقة", d: "متوسط الانتظار، نسبة عدم الحضور، الأصناف الأكثر طلباً — وكم كان الوقت الموعود دقيقاً." },
      ],
    },
    verticals: { title: "مصمم لأربعة أنواع من المحلات", list: [["مطاعم", "طاولات، سفري، توصيل"], ["كافيهات", "دور الطلبات والاستلام"], ["حلويات", "صواني وطلبات مسبقة"], ["تجميل", "خدمات ومواعيد ودور"]] },
    honest: {
      title: "يحمي رقم محلك",
      body: "الرسائل تروح فقط لزبون راسلك أولاً أو كتب رقمه بنفسه ووافق. لا رسائل لغرباء، ولا رسالة «جاء دورك» متأخرة: إذا فات وقتها تُلغى. وكل شيء يشتغل حتى لو انقطع واتساب — صفحة التذكرة حيّة دائماً.",
    },
    plans: { title: "الخطط", contact: "تواصل معنا", perMonth: "شهرياً", features: ["المنيو والطلب على واتساب", "الصف الرقمي", "الحجوزات", "إشعارات واتساب والمضيف الذكي", "الفروع", "الحملات والمتابعات"] },
    faq: {
      title: "أسئلة متكررة",
      list: [
        ["هل يحتاج الزبون تطبيق أو حساب؟", "لا. يفتح الرابط أو يمسح الكود ويكمل مباشرة."],
        ["كيف يوصل الزبون إشعار دوره؟", "عند الانضمام يفتح واتساب برسالة جاهزة فيها رمز تذكرته؛ لما يرسلها نربط رقمه بالتذكرة ونرسل له لما يقرب دوره ولما يجي."],
        ["أقدر أستخدم رقم واتساب محلي الحالي؟", "نعم، تربطه بمسح كود من لوحة التحكم. وننصح برقم مخصص للمحل لا رقمك الشخصي."],
        ["ماذا لو انقطع واتساب؟", "المنيو والصف وصفحة التذكرة تكمل بدون أي تأثير — فقط الإشعارات تتوقف حتى يرجع الاتصال."],
        ["هل يدعم أكثر من فرع؟", "نعم، كل فرع برابط وصف وساعات عمل خاصة، وتتنقل بينها من حساب واحد."],
      ],
    },
    cta: { title: "جهّز منيو محلك اليوم", sub: "اكتب اسم المحل، ارفع الشعار، أضف الأصناف — والكود جاهز للطباعة.", btn: "ابدأ مجاناً" },
    footer: "منيو فور يو — المنيو والصف الرقمي وواتساب",
  },
  en: {
    nav: { features: "Features", how: "How it works", plans: "Plans", faq: "FAQ", login: "Sign in", staff: "Staff sign-in", start: "Start free", dashboard: "Dashboard" },
    hero: {
      kicker: "For restaurants, cafés, sweets shops and beauty salons",
      title: ["A beautiful menu,", "a digital queue,", "talking to guests on WhatsApp"],
      sub: "One link or a QR on the door: guests browse the menu with photos, order on WhatsApp, and take a place in line with no app and no sign-up — then get «it's your turn» on WhatsApp.",
      cta: "Create your menu", demo: "See a demo menu",
      note: "No app for guests · Arabic & English · Works on any phone",
    },
    how: {
      title: "From the door to the table in three steps",
      steps: [
        { t: "Scan the code", d: "On the door, the table, or a link you sent — the menu opens at once, nothing to install." },
        { t: "Join the line", d: "See how many are ahead and the estimated wait, and follow it live from the car or the mall." },
        { t: "Get «it's your turn»", d: "Staff press Next — the guest's screen changes and a WhatsApp message arrives from your number." },
      ],
    },
    features: {
      title: "Everything your shop needs, in one link",
      list: [
        { i: "menu", t: "An animated menu", d: "Photos that grow on tap, categories that follow the scroll, four elegant templates in your colours." },
        { i: "wa", t: "The cart ends on WhatsApp", d: "Orders arrive neatly with a number and total — priced by the server, so nobody can change it." },
        { i: "queue", t: "A digital queue", d: "A number per guest, a wait that learns from today's pace, and one Next button for staff." },
        { i: "book", t: "Bookings & pre-orders", d: "A table, a salon slot, or a tray for Thursday — with a reminder before." },
        { i: "bot", t: "A smart WhatsApp host", d: "Answers «how much is the kunafa?» from your menu, and never invents a price or a dish." },
        { i: "store", t: "Branches & staff", d: "Each branch with its own link and queue, its own WhatsApp number if you like; each staff member sees only their screen." },
        { i: "tv", t: "A «now serving» screen", d: "On the shop's TV: big numbers, who's next, and a code to join." },
        { i: "chart", t: "Honest reports", d: "Average wait, no-show rate, best sellers — and how accurate the promised wait was." },
      ],
    },
    verticals: { title: "Built for four kinds of shop", list: [["Restaurants", "Tables, takeaway, delivery"], ["Cafés", "Order & pickup queue"], ["Sweets", "Trays and pre-orders"], ["Beauty", "Services, slots, walk-ins"]] },
    honest: {
      title: "It protects your number",
      body: "Messages only go to a guest who wrote to you first or typed their number and agreed. No messages to strangers, and no late «it's your turn»: if its moment passed, it's dropped. Everything keeps working if WhatsApp drops — the ticket page is always live.",
    },
    plans: { title: "Plans", contact: "Contact us", perMonth: "per month", features: ["Menu & WhatsApp ordering", "Digital queue", "Bookings", "WhatsApp notifications & AI host", "Branches", "Campaigns & follow-ups"] },
    faq: {
      title: "FAQ",
      list: [
        ["Do guests need an app or an account?", "No. They open the link or scan the code and carry on."],
        ["How do guests get notified?", "When they join, WhatsApp opens with a ready message carrying their ticket code; once sent, we link their number and message them when they're close and when it's their turn."],
        ["Can I use my shop's current WhatsApp number?", "Yes — link it by scanning a code in the dashboard. We recommend a dedicated shop number rather than a personal one."],
        ["What if WhatsApp disconnects?", "The menu, queue and ticket page carry on unaffected — only notifications pause until it reconnects."],
        ["Does it support several branches?", "Yes — each branch has its own link, queue and hours, all from one account."],
      ],
    },
    cta: { title: "Set up your menu today", sub: "Type your shop's name, upload the logo, add items — the QR is ready to print.", btn: "Start free" },
    footer: "Menu For You — the menu, the queue and WhatsApp",
  },
};

const ICON: Record<string, any> = { menu: UtensilsCrossed, wa: MessageCircle, queue: Users, book: CalendarDays, bot: Bot, store: Store, tv: Tv, chart: BarChart3 };
const VERT_ICON = [UtensilsCrossed, Coffee, CakeSlice, Scissors];

const fade = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as any } };

interface PlanRow { id: number; name: string; name_en: string | null; price: string; period: string; period_label: string | null; features: string[] | null; features_en: string[] | null; badge: string | null; is_featured: boolean }

export default function LandingPage() {
  const { user } = useAuth();
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("mfy:landing-lang") === "en" ? "en" : "ar"));
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [demo, setDemo] = useState<string | null>(null);
  const [faq, setFaq] = useState<number | null>(0);
  const c = C[lang];
  const Arrow = lang === "ar" ? ArrowLeft : ArrowRight;

  useEffect(() => { localStorage.setItem("mfy:landing-lang", lang); document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; return () => { document.documentElement.dir = "rtl"; }; }, [lang]);
  useEffect(() => {
    fetch("/api/plans").then((r) => (r.ok ? r.json() : [])).then((d) => Array.isArray(d) && setPlans(d)).catch(() => {});
    // A live demo menu, when the platform has one (DEMO_SHOP, or the seeded demo).
    fetch("/api/public/m/bait-shami").then((r) => r.ok && setDemo("/bait-shami")).catch(() => {});
  }, []);

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/75 border-b border-border/60">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="font-bold">{lang === "ar" ? "منيو فور يو" : "Menu For You"}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#how" className="hover:text-foreground">{c.nav.how}</a>
            <a href="#features" className="hover:text-foreground">{c.nav.features}</a>
            <a href="#plans" className="hover:text-foreground">{c.nav.plans}</a>
            <a href="#faq" className="hover:text-foreground">{c.nav.faq}</a>
          </nav>
          <div className="flex-1" />
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5"><Languages className="w-4 h-4" />{lang === "ar" ? "EN" : "ع"}</button>
          {user ? (
            <Link href="/shop" className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center">{c.nav.dashboard}</Link>
          ) : (
            <>
              <Link href="/login" className="hidden sm:flex h-10 px-4 rounded-xl text-sm font-semibold items-center hover:bg-muted">{c.nav.login}</Link>
              <Link href="/login?register=1" className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center">{c.nav.start}</Link>
            </>
          )}
        </div>
      </header>

      <section className="relative">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 50% at 75% 10%, hsl(var(--primary) / .16), transparent 60%), radial-gradient(40% 40% at 10% 60%, hsl(var(--primary) / .08), transparent 60%)" }} />
        <div className="relative max-w-6xl mx-auto px-5 pt-14 pb-20 grid lg:grid-cols-[1.1fr_.9fr] gap-14 items-center">
          <div>
            <motion.p {...fade} className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary"><Sparkles className="w-3.5 h-3.5" />{c.hero.kicker}</motion.p>
            <motion.h1 {...fade} transition={{ ...fade.transition, delay: 0.05 }} className="mt-5 text-4xl sm:text-5xl lg:text-[56px] font-extrabold leading-[1.15] tracking-tight">
              {c.hero.title[0]} <span className="text-primary">{c.hero.title[1]}</span><br className="hidden sm:block" /> {c.hero.title[2]}
            </motion.h1>
            <motion.p {...fade} transition={{ ...fade.transition, delay: 0.1 }} className="mt-5 text-lg text-muted-foreground leading-relaxed max-w-xl">{c.hero.sub}</motion.p>
            <motion.div {...fade} transition={{ ...fade.transition, delay: 0.15 }} className="mt-8 flex flex-wrap gap-3">
              <Link href={user ? "/shop" : "/login?register=1"} className="h-12 px-6 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center gap-2 shadow-lg shadow-primary/20 hover:brightness-110 transition">{c.hero.cta}<Arrow className="w-4 h-4" /></Link>
              {demo && <a href={demo} target="_blank" rel="noreferrer" className="h-12 px-6 rounded-xl border border-border font-semibold flex items-center gap-2 hover:bg-muted transition"><QrCode className="w-4 h-4" />{c.hero.demo}</a>}
            </motion.div>
            <p className="mt-5 text-sm text-muted-foreground">{c.hero.note}</p>
          </div>
          <Phones lang={lang} />
        </div>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-5 py-20">
        <motion.h2 {...fade} className="text-3xl font-bold text-center">{c.how.title}</motion.h2>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {c.how.steps.map((s, i) => (
            <motion.div key={i} {...fade} transition={{ ...fade.transition, delay: i * 0.08 }} className="relative rounded-2xl border border-border bg-card p-6">
              <span className="absolute -top-4 start-6 w-9 h-9 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center">{i + 1}</span>
              <div className="mt-3 w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">{[<QrCode key="a" />, <Clock key="b" />, <Bell key="c" />][i]}</div>
              <h3 className="mt-4 text-lg font-bold">{s.t}</h3>
              <p className="mt-2 text-muted-foreground leading-relaxed">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="features" className="bg-card/40 border-y border-border/60">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <motion.h2 {...fade} className="text-3xl font-bold text-center">{c.features.title}</motion.h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {c.features.list.map((f, i) => {
              const I = ICON[f.i];
              return (
                <motion.div key={f.t} {...fade} transition={{ ...fade.transition, delay: (i % 4) * 0.06 }} className="rounded-2xl bg-background border border-border p-5 hover:border-primary/40 transition-colors">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><I className="w-5 h-5" /></div>
                  <h3 className="mt-4 font-bold">{f.t}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{f.d}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-20">
        <motion.h2 {...fade} className="text-3xl font-bold text-center">{c.verticals.title}</motion.h2>
        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {c.verticals.list.map(([t, d], i) => {
            const I = VERT_ICON[i]!;
            return (
              <motion.div key={t} {...fade} transition={{ ...fade.transition, delay: i * 0.06 }} className="rounded-2xl border border-border p-6 text-center bg-gradient-to-b from-primary/[.06] to-transparent">
                <I className="w-8 h-8 mx-auto text-primary" />
                <p className="mt-3 font-bold text-lg">{t}</p>
                <p className="text-sm text-muted-foreground mt-1">{d}</p>
              </motion.div>
            );
          })}
        </div>
        <motion.div {...fade} className="mt-12 rounded-3xl border border-primary/25 bg-primary/[.06] p-8 grid md:grid-cols-[auto_1fr] gap-6 items-start">
          <div className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center"><MessageCircle className="w-7 h-7" /></div>
          <div>
            <h3 className="text-xl font-bold">{c.honest.title}</h3>
            <p className="mt-2 text-muted-foreground leading-relaxed">{c.honest.body}</p>
          </div>
        </motion.div>
      </section>

      <section id="plans" className="bg-card/40 border-y border-border/60">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <motion.h2 {...fade} className="text-3xl font-bold text-center">{c.plans.title}</motion.h2>
          {plans.length > 0 ? (
            <div className="mt-12 grid md:grid-cols-3 gap-5">
              {plans.map((p) => {
                const feats = (lang === "en" ? p.features_en : p.features) ?? [];
                return (
                  <motion.div key={p.id} {...fade} className={`rounded-2xl p-6 border ${p.is_featured ? "border-primary bg-primary/[.06]" : "border-border bg-background"}`}>
                    {p.badge && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary text-primary-foreground">{p.badge}</span>}
                    <p className="mt-3 text-lg font-bold">{lang === "en" && p.name_en ? p.name_en : p.name}</p>
                    <p className="mt-2"><span className="text-4xl font-extrabold">{p.price}</span> <span className="text-muted-foreground text-sm">{p.period_label ?? c.plans.perMonth}</span></p>
                    <ul className="mt-5 space-y-2.5">
                      {feats.map((f) => <li key={f} className="flex gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />{f}</li>)}
                    </ul>
                    <Link href="/login?register=1" className={`mt-6 h-11 rounded-xl font-semibold flex items-center justify-center ${p.is_featured ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}>{c.nav.start}</Link>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <motion.div {...fade} className="mt-10 max-w-xl mx-auto rounded-2xl border border-border bg-background p-6">
              <ul className="space-y-3">{c.plans.features.map((f) => <li key={f} className="flex gap-2.5"><CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />{f}</li>)}</ul>
              <Link href="/login?register=1" className="mt-6 h-11 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center">{c.plans.contact}</Link>
            </motion.div>
          )}
        </div>
      </section>

      <section id="faq" className="max-w-3xl mx-auto px-5 py-20">
        <motion.h2 {...fade} className="text-3xl font-bold text-center">{c.faq.title}</motion.h2>
        <div className="mt-10 space-y-3">
          {c.faq.list.map(([q, a], i) => (
            <div key={q} className="rounded-2xl border border-border bg-card overflow-hidden">
              <button onClick={() => setFaq(faq === i ? null : i)} className="w-full p-5 flex items-center justify-between gap-4 text-start font-semibold">
                {q}<ChevronDown className={`w-5 h-5 flex-shrink-0 transition-transform ${faq === i ? "rotate-180" : ""}`} />
              </button>
              {faq === i && <p className="px-5 pb-5 text-muted-foreground leading-relaxed">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-24">
        <motion.div {...fade} className="rounded-3xl p-10 text-center bg-gradient-to-br from-primary to-[hsl(32_55%_38%)] text-primary-foreground">
          <h2 className="text-3xl font-extrabold">{c.cta.title}</h2>
          <p className="mt-3 opacity-90">{c.cta.sub}</p>
          <Link href={user ? "/shop" : "/login?register=1"} className="mt-7 inline-flex h-12 px-7 rounded-xl bg-background text-foreground font-semibold items-center gap-2">{c.cta.btn}<Arrow className="w-4 h-4" /></Link>
        </motion.div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <span>{c.footer}</span>
          <Link href="/staff-login" className="hover:text-foreground">{c.nav.staff}</Link>
        </div>
      </footer>
    </div>
  );
}

function Mark() {
  return (
    <span className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.2" opacity=".6" />
        <path d="M3.5 4.5v5M5.25 4.5v5M3.5 7h1.75M4.4 9.5v10" /><path d="M20.5 4.5c-1.3 1-1.9 2.6-1.9 4.4v2.1h1.9v8.5" />
      </svg>
    </span>
  );
}

/** Two phones drawn in CSS: the menu, and a ticket being called. */
function Phones({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  return (
    <div className="relative h-[520px] hidden sm:block">
      <motion.div initial={{ opacity: 0, y: 40, rotate: -6 }} animate={{ opacity: 1, y: 0, rotate: -6 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="absolute top-4 start-0 w-[250px] h-[500px] rounded-[38px] border-[7px] border-[#2a2620] bg-[#0d0c0a] shadow-2xl overflow-hidden">
        <div className="h-32 bg-gradient-to-b from-primary/30 to-transparent" />
        <div className="-mt-10 px-4">
          <div className="w-14 h-14 rounded-2xl bg-[#17150f] border-4 border-[#0d0c0a] flex items-center justify-center text-primary font-bold">ب</div>
          <p className="mt-2 text-white font-bold">{ar ? "البيت الشامي" : "Bait Shami"}</p>
          <p className="text-[11px] text-white/50">{ar ? "مشاوي ومناقيش على الفحم" : "Charcoal grills & manakish"}</p>
          <div className="mt-3 flex gap-1.5">{(ar ? ["المقبلات", "المشاوي", "الحلويات"] : ["Mezze", "Grills", "Desserts"]).map((x, i) => <span key={x} className={`text-[10px] px-2.5 py-1 rounded-full ${i === 1 ? "bg-primary text-[#1a1305]" : "bg-white/5 text-white/60"}`}>{x}</span>)}</div>
          {[[ar ? "مشاوي مشكل" : "Mixed grill", "79"], [ar ? "شيش طاووق" : "Shish tawook", "45"], [ar ? "كباب حلبي" : "Aleppo kebab", "52"]].map(([n, p]) => (
            <div key={n} className="mt-2.5 p-2.5 rounded-xl bg-[#17150f] flex justify-between items-center">
              <div><p className="text-[12px] text-white font-semibold">{n}</p><p className="text-[11px] text-primary">{p} {ar ? "د.إ" : "AED"}</p></div>
              <span className="w-6 h-6 rounded-full bg-primary text-[#1a1305] text-sm flex items-center justify-center">+</span>
            </div>
          ))}
          <div className="mt-4 h-10 rounded-full bg-[#f4efe4] flex items-center gap-2 px-1.5">
            <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center"><Users className="w-3.5 h-3.5 text-[#1a1305]" /></span>
            <span className="text-[11px] font-bold text-[#0d0c0a]">{ar ? "احجز دورك · 5 في الصف" : "Join · 5 in line"}</span>
          </div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 60, rotate: 5 }} animate={{ opacity: 1, y: 0, rotate: 5 }} transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="absolute top-16 end-0 w-[230px] h-[460px] rounded-[36px] border-[7px] border-[#2a2620] bg-[#3fbf7f] shadow-2xl overflow-hidden flex flex-col items-center justify-center text-[#04210f]">
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }} className="w-14 h-14 rounded-full bg-white/30 flex items-center justify-center"><Bell className="w-7 h-7" /></motion.div>
        <p className="mt-4 font-bold text-lg">{ar ? "جاء دورك!" : "It's your turn!"}</p>
        <p className="text-6xl font-extrabold mt-2">A-27</p>
        <div className="mt-6 mx-4 p-3 rounded-2xl bg-white/90 text-[11px] text-[#0b1f14] leading-relaxed shadow">
          <p className="font-bold flex items-center gap-1"><MessageCircle className="w-3 h-3" /> WhatsApp</p>
          {ar ? "🔔 جاء دورك يا سارة! رقمك A-27 — تفضّلي الحين." : "🔔 It's your turn, Sara! Number A-27 — please come in."}
        </div>
      </motion.div>
    </div>
  );
}
