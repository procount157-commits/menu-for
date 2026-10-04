// ── /shop — the owner's home ──────────────────────────────────────
// What is happening in each branch right now, the menu link to hand out,
// and, while the shop is new, the four things that make it work.

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, CalendarCheck, CheckCircle2, Circle, Clock, ExternalLink, Hourglass, MessageCircle, QrCode,
  ShoppingBag, Store, TrendingUp, UserX, Users, UtensilsCrossed, Wallet,
} from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { cn } from "@/lib/utils";
import { get, useShop, useSwitchBranch } from "@/lib/shop-api";
import { CopyButton, PageHeader, Skel, btnGhost, btnPrimary, isQrDone } from "@/components/shop/setup/kit";
import { askUpgrade } from "@/components/shop/Upgrade";

interface LiveBranch {
  id: number; name: string; isActive: boolean; waiting: number; served: number; noShows: number; avgWait: number | null;
  eta: { expected: number; low: number; high: number; soon: boolean } | null;
  orders: number; openOrders: number; revenue: number; bookingsToday: number;
  wa: { connected: boolean; phone: string | null }; noShowRate: number | null;
}
interface Live { branches: LiveBranch[]; currency: string }

function etaText(eta: LiveBranch["eta"], waiting: number) {
  if (!waiting) return "لا أحد ينتظر";
  if (!eta) return "—";
  if (eta.soon) return "دقائق قليلة";
  return `~${eta.low}–${eta.high} د`;
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: "warn" }) {
  return (
    <div className="rounded-xl bg-muted/40 border border-card-border/60 px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums truncate", tone === "warn" && "text-amber-400")}>{value}</div>
    </div>
  );
}

function BranchCard({ b, currency, current, multi }: { b: LiveBranch; currency: string; current: boolean; multi: boolean }) {
  const switchBranch = useSwitchBranch();
  const [, go] = useLocation();
  // Every staff screen follows the session's branch, so step into this one first.
  const open = async (path: string) => { if (!current) await switchBranch(b.id); go(path); };
  return (
    <div className={cn("bg-card border rounded-2xl p-4 sm:p-5 space-y-4", current && multi ? "border-primary/40" : "border-card-border", !b.isActive && "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Store className="w-4 h-4 text-primary shrink-0" />
          <h3 className="font-semibold truncate">{b.name}</h3>
          {!b.isActive && <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">موقوف</span>}
          {current && multi && <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">الفرع الحالي</span>}
        </div>
        {b.wa.connected ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />واتساب مربوط</span>
        ) : (
          <button onClick={() => open("/connect")} className="flex items-center gap-1.5 text-xs text-amber-400 hover:underline underline-offset-4 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />اربط واتساب
          </button>
        )}
      </div>

      <div className="grid grid-cols-[1.2fr_1fr] gap-3">
        <button onClick={() => open("/queue")} className="text-start rounded-xl bg-primary/10 border border-primary/25 p-3 hover:border-primary/50 transition-colors">
          <div className="text-xs text-primary/90 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />ينتظرون الآن</div>
          <div className="text-4xl font-bold tabular-nums mt-1">{b.waiting}</div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Hourglass className="w-3 h-3" />{etaText(b.eta, b.waiting)}</div>
        </button>
        <div className="grid grid-rows-2 gap-3">
          <Stat icon={<CheckCircle2 className="w-3 h-3" />} label="خُدموا اليوم" value={b.served} />
          <Stat icon={<UserX className="w-3 h-3" />} label="ما حضروا" value={b.noShowRate == null ? "—" : `${b.noShowRate}%`} tone={b.noShowRate != null && b.noShowRate >= 20 ? "warn" : undefined} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat icon={<ShoppingBag className="w-3 h-3" />} label="طلبات مفتوحة" value={b.openOrders} />
        <Stat icon={<TrendingUp className="w-3 h-3" />} label="طلبات اليوم" value={b.orders} />
        <Stat icon={<Wallet className="w-3 h-3" />} label="مبيعات اليوم" value={<span className="text-base">{formatMoney(b.revenue, currency)}</span>} />
        <Stat icon={<CalendarCheck className="w-3 h-3" />} label="حجوزات اليوم" value={b.bookingsToday} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button onClick={() => open("/queue")} className={cn(btnGhost, "text-xs")}><Users className="w-3.5 h-3.5" />شاشة الصف</button>
        <button onClick={() => open("/orders")} className={cn(btnGhost, "text-xs")}><ShoppingBag className="w-3.5 h-3.5" />الطلبات</button>
        <button onClick={() => open("/bookings")} className={cn(btnGhost, "text-xs")}><CalendarCheck className="w-3.5 h-3.5" />الحجوزات</button>
        {b.avgWait != null && <span className="ms-auto text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />متوسط الانتظار اليوم {b.avgWait} د</span>}
      </div>
    </div>
  );
}

function NextSteps() {
  const shop = useShop();
  const items = useQuery<any[]>({ queryKey: ["/api/menu/items"], queryFn: () => get("/api/menu/items") });
  const staff = useQuery<{ staff: any[] }>({ queryKey: ["/api/staff"], queryFn: () => get("/api/staff"), enabled: shop.role === "owner" });
  if (items.isLoading || staff.isLoading) return null;
  const steps = [
    { done: (items.data?.length ?? 0) > 0, title: `أضف ${shop.vocab.items[0]}`, sub: "يدوياً، أو ارفع Excel، أو صوّر المنيو الورقي", href: "/menu", icon: <UtensilsCrossed className="w-4 h-4" /> },
    { done: shop.wa.connected, title: "اربط واتساب", sub: "عشان يوصل الزبون «جاء دورك» و«طلبك جاهز»", href: "/connect", icon: <MessageCircle className="w-4 h-4" /> },
    { done: isQrDone(shop.org.id), title: "اطبع الـ QR", sub: "ملصق للكاونتر وبطاقة لكل طاولة", href: "/qr", icon: <QrCode className="w-4 h-4" /> },
    { done: (staff.data?.staff.length ?? 0) > 0, title: "أضف موظف", sub: "حساب للكاشير يشغّل الصف من جهازه", href: "/staff", icon: <Users className="w-4 h-4" /> },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  return (
    <section className="bg-card border border-card-border rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">خطوات تجهيز المحل</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{doneCount} من {steps.length}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden mb-2">
        <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ul className="divide-y divide-border">
        {steps.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="flex items-center gap-3 py-3 group">
              {s.done ? <CheckCircle2 className="w-5 h-5 text-primary shrink-0" /> : <Circle className="w-5 h-5 text-muted-foreground/50 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{s.title}</div>
                {!s.done && <div className="text-xs text-muted-foreground mt-0.5">{s.sub}</div>}
              </div>
              {!s.done && <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Shop brings shop: the owner's invitation link, and what it has earned. */
function ShopReferral() {
  const q = useQuery<{ code: string; link: string; freeDays: number; stats: { brought: number; rewarded: number; freeDays: number } }>({ queryKey: ["/api/growth/shop-referral"], queryFn: () => get("/api/growth/shop-referral") });
  if (!q.data) return null;
  const d = q.data;
  const text = `جرّب منيو فور يو لمحلك 👌 منيو رقمي، طلبات وصف انتظار على واتساب. اشترك من رابطي وتاخذ شهراً مجانياً:\n${d.link}`;
  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <h3 className="font-semibold">🎁 ادعُ محلاً واكسب شهراً مجاناً</h3>
          <p className="text-xs text-muted-foreground mt-1">تعرف صاحب محل ثاني؟ إذا اشترك من رابطك، تأخذان أنتما الاثنان {d.freeDays} يوماً مجاناً.</p>
        </div>
        <CopyButton text={d.link} label="نسخ الرابط" />
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={cn(btnPrimary, "text-xs px-3 py-1.5")}><MessageCircle className="w-3.5 h-3.5" />أرسل على واتساب</a>
      </div>
      {d.stats.brought > 0 && <div className="text-xs text-muted-foreground mt-2">دعوت {d.stats.brought} محل · اشترك منهم {d.stats.rewarded} · كسبت {d.stats.freeDays} يوماً</div>}
    </section>
  );
}

/** How close each limit is; from 80% it says so and offers the next plan. */
function PlanUsage() {
  const shop = useShop();
  const L = shop.plan.limits, U = shop.usage;
  if (!U) return null;
  const rows = ([["الفروع", U.branches, L.branches], ["الأصناف", U.items, L.items], ["الموظفون", U.staff, L.staff]] as const).filter(([, , l]) => l > 0);
  const near = rows.filter(([, u, l]) => u / l >= 0.8);
  const top = shop.plan.plan === "business";
  if (!rows.length && top) return null;
  return (
    <section className={cn("rounded-2xl border p-4 sm:p-5", near.length ? "border-amber-500/40 bg-amber-500/5" : "border-card-border bg-card")}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="font-semibold flex-1">خطتك: {shop.plan.planName}</h3>
        {!top && <button onClick={() => askUpgrade(near.length ? `وصلت ${near.map(([n]) => n).join(" و")} لحد خطتك تقريباً.` : "")} className={cn(btnPrimary, "text-xs px-3 py-1.5")}><TrendingUp className="w-3.5 h-3.5" />ارفع خطتك</button>}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {rows.map(([n, u, l]) => {
          const pct = Math.min(100, Math.round((u / l) * 100));
          return (
            <div key={n}>
              <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{n}</span><span className={cn("tabular-nums", pct >= 100 ? "text-red-300" : pct >= 80 ? "text-amber-300" : "")}>{u} / {l}</span></div>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-amber-400" : "bg-primary")} style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>
      {near.length > 0 && <p className="text-xs text-amber-200/90 mt-3">{near.some(([, u, l]) => u >= l) ? "وصلت للحد — لن تقدر تضيف أكثر في هذه الخطة." : "قربت من الحد."} الخطة الأعلى تفتح المزيد مع أدوات تبيع أكثر.</p>}
    </section>
  );
}

export default function ShopHome() {
  const shop = useShop();
  const live = useQuery<Live>({ queryKey: ["/api/reports/live"], queryFn: () => get("/api/reports/live"), refetchInterval: 20_000 });
  const greeting = new Date().getHours() < 12 ? "صباح الخير" : "مساء الخير";
  const name = shop.person?.name?.split(" ")[0];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl" dir="rtl">
      <PageHeader
        title={`${greeting}${name ? ` يا ${name}` : ""}`}
        sub={<>هذا {shop.org.name} الحين · <span className="text-foreground/80">باقة {shop.plan.planName}</span>{shop.plan.expired && <span className="text-amber-400"> · منتهية — جدّدها عشان ما يتوقف الصف</span>}</>}
      />

      <section className="rounded-2xl border border-primary/25 bg-gradient-to-l from-primary/10 via-card to-card p-4 sm:p-5">
        <div className="text-xs text-muted-foreground mb-1.5">رابط المنيو — حطّه في الإنستغرام وفي حالة الواتساب</div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={shop.links.menu} target="_blank" rel="noreferrer" className="font-mono text-sm sm:text-base text-primary truncate max-w-full" dir="ltr">{shop.links.menu.replace(/^https?:\/\//, "")}</a>
          <div className="flex gap-2 ms-auto">
            <CopyButton text={shop.links.menu} />
            <a href={shop.links.menu} target="_blank" rel="noreferrer" className={cn(btnGhost, "text-xs px-3 py-1.5")}><ExternalLink className="w-3.5 h-3.5" />افتح</a>
            <Link href="/qr" className={cn(btnPrimary, "text-xs px-3 py-1.5")}><QrCode className="w-3.5 h-3.5" />الـ QR</Link>
          </div>
        </div>
      </section>

      <NextSteps />

      {shop.role === "owner" && <PlanUsage />}
      {shop.role === "owner" && <ShopReferral />}

      <div className="space-y-4">
        {live.isLoading && [0, 1].map((i) => <Skel key={i} className="h-64 rounded-2xl" />)}
        {live.error && <div className="text-sm text-destructive">{(live.error as Error).message}</div>}
        {live.data?.branches.map((b) => (
          <BranchCard key={b.id} b={b} currency={live.data!.currency} current={b.id === shop.branch.id} multi={live.data!.branches.length > 1} />
        ))}
      </div>
    </div>
  );
}
