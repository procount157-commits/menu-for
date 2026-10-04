// ── /admin/metrics — the platform in numbers ──────────────────────
// For the platform owner: what comes in each month, where shops fall out
// between signing up and paying, which signup months are still active, what
// the platform carried each day, where requests come from, and which growth
// tools shops switched on. Every chart is one series in one colour.

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { AlertTriangle, BarChart3, Loader2, ShieldAlert } from "lucide-react";
import { get } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Empty, Stat, errText, n } from "@/components/shop/ops/kit";

interface Metrics {
  money: { mrr: number; arr: number; paying: number; arpa: number; priced: boolean };
  shops: { total: number; byPlan: Record<string, number>; newThisMonth: number; newLastMonth: number; active14: number; lapsed30: number };
  funnel: Array<{ key: string; label: string; n: number }>;
  cohorts: Array<{ month: string; signed: number; active: number; paying: number }>;
  daily: Array<{ day: string; orders: number; tickets: number; bookings: number; messages: number }>;
  leads: { total: number; bySource: Array<{ source: string; n: number }>; converted: number };
  adoption: Array<{ label: string; n: number }>;
  growth: { giftSales: number; friendReferrals: number; shopReferrals: number };
}

// One series per chart; this green step sits inside the dark-mode lightness band (validated).
const MARK = "#16a34a";
const PLAN_AR: Record<string, string> = { free: "تجريبي", basic: "أساسي", pro: "احترافي", business: "أعمال" };
const SOURCE_AR: Record<string, string> = { landing: "الصفحة الرئيسية", in_app: "طلب ترقية من اللوحة" };
const aed = (v: number) => `${n(v)} د.إ`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default function AdminMetrics() {
  const { user } = useAuth();
  const q = useQuery<Metrics>({ queryKey: ["/api/admin/orgs/metrics"], queryFn: () => get("/api/admin/orgs/metrics"), enabled: !!user?.isAdmin, refetchInterval: 60_000 });
  if (!user?.isAdmin) return <Empty title="هذه الصفحة لمشرف المنصة فقط" icon={<ShieldAlert />} className="py-24" />;
  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <Empty title="تعذّر التحميل" icon={<AlertTriangle />} className="py-24">{errText(q.error)}</Empty>;
  const d = q.data;
  const top = Math.max(1, d.funnel[0]?.n ?? 1);
  const adoptTop = Math.max(1, d.shops.total);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" />أرقام المنصة</h1>
        <p className="text-sm text-muted-foreground mt-0.5">الدخل، ومن يصل للدفع، ومن بقي، وما تحمله المنصة كل يوم.</p>
      </div>

      <section className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="الدخل الشهري المتكرر" value={aed(d.money.mrr)} tone="gold" hint="من أسعار الخطط في صفحة الإدارة" />
          <Stat label="السنوي المتوقع" value={aed(d.money.arr)} />
          <Stat label="محلات تدفع" value={n(d.money.paying)} hint={`من ${n(d.shops.total)} محل`} />
          <Stat label="متوسط الدخل لكل محل" value={aed(d.money.arpa)} />
        </div>
        {!d.money.priced && <p className="text-xs text-amber-300">لا توجد أسعار خطط مفعّلة — أضفها من «الاشتراكات والخطط» ليُحسب الدخل.</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="جدد هذا الشهر" value={n(d.shops.newThisMonth)} hint={`الشهر الماضي ${n(d.shops.newLastMonth)}`} />
          <Stat label="نشطون آخر 14 يوماً" value={n(d.shops.active14)} hint={pct(d.shops.active14, d.shops.total)} tone="ok" />
          <Stat label="انتهت خطتهم آخر 30 يوماً" value={n(d.shops.lapsed30)} tone={d.shops.lapsed30 ? "warn" : undefined} hint="لم يجدّدوا" />
          <Stat label="حسب الخطة" value={<span className="text-sm font-semibold">{Object.entries(d.shops.byPlan).map(([k, v]) => `${PLAN_AR[k] ?? k} ${v}`).join(" · ") || "—"}</span>} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <h2 className="font-bold">من التسجيل إلى الدفع</h2>
          <p className="text-xs text-muted-foreground">كل المحلات منذ البداية. أكبر هبوط بين مرحلتين هو أول ما يستحق العمل عليه.</p>
          {d.funnel.map((s, i) => {
            const prev = i ? d.funnel[i - 1]!.n : s.n;
            return (
              <div key={s.key} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0 text-muted-foreground">{s.label}</span>
                <div className="flex-1 h-6 rounded-md bg-secondary/50 overflow-hidden" title={`${s.n} — ${pct(s.n, top)} من المسجّلين`}>
                  <div className="h-full rounded-md" style={{ width: `${Math.max(2, (s.n / top) * 100)}%`, background: MARK }} />
                </div>
                <span className="w-10 text-left tabular-nums font-semibold">{n(s.n)}</span>
                <span className="w-12 text-left tabular-nums text-xs text-muted-foreground">{i ? pct(s.n, prev) : ""}</span>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">النسبة الصغيرة: من وصل لهذه المرحلة من المرحلة السابقة.</p>
        </section>

        <section className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <h2 className="font-bold">شهر التسجيل: من بقي ومن يدفع</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="[&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium">
              <th>الشهر</th><th>سجّلوا</th><th>نشطون الآن</th><th>يدفعون الآن</th>
            </tr></thead>
            <tbody>
              {d.cohorts.map((c) => (
                <tr key={c.month} className="border-t border-border/60 tabular-nums [&>td]:py-1.5">
                  <td dir="ltr" className="text-start">{c.month}</td><td>{n(c.signed)}</td>
                  <td>{n(c.active)} <span className="text-xs text-muted-foreground">{c.signed ? pct(c.active, c.signed) : ""}</span></td>
                  <td>{n(c.paying)} <span className="text-xs text-muted-foreground">{c.signed ? pct(c.paying, c.signed) : ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground">«نشط»: طلب أو دور أو حجز أو دخول خلال آخر 14 يوماً.</p>
        </section>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <h2 className="font-bold">ما تحمله المنصة كل يوم — آخر 30 يوماً</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {([["orders", "الطلبات"], ["tickets", "تذاكر الصف"], ["bookings", "الحجوزات"], ["messages", "رسائل واتساب"]] as const).map(([k, label]) => {
            const total = d.daily.reduce((a, r) => a + r[k], 0);
            return (
              <div key={k}>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className="font-bold tabular-nums">{n(total)}</span></div>
                <div className="h-24 mt-1" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.daily} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
                      <XAxis dataKey="day" hide />
                      <Tooltip cursor={{ fill: "rgba(255,255,255,0.05)" }} contentStyle={{ background: "#0b1411", border: "1px solid #1f2d27", borderRadius: 8, fontSize: 12, direction: "rtl" }}
                        labelFormatter={(v) => String(v)} formatter={(v) => [n(Number(v)), label]} />
                      <Bar dataKey={k} fill={MARK} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <h2 className="font-bold">أدوات النمو التي فعّلتها المحلات</h2>
          {d.adoption.map((a) => (
            <div key={a.label} className="flex items-center gap-3 text-sm">
              <span className="w-44 shrink-0 text-muted-foreground">{a.label}</span>
              <div className="flex-1 h-5 rounded-md bg-secondary/50 overflow-hidden"><div className="h-full rounded-md" style={{ width: `${Math.max(2, Math.min(100, (a.n / adoptTop) * 100))}%`, background: MARK }} /></div>
              <span className="w-10 text-left tabular-nums font-semibold">{n(a.n)}</span>
            </div>
          ))}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <Stat label="مبيعات بطاقات الهدايا" value={aed(d.growth.giftSales)} />
            <Stat label="أصدقاء بدعوة زبون" value={n(d.growth.friendReferrals)} />
            <Stat label="محلات بدعوة محل" value={n(d.growth.shopReferrals)} />
          </div>
        </section>

        <section className="rounded-xl border border-card-border bg-card p-4 space-y-2">
          <h2 className="font-bold">طلبات الاشتراك — آخر 30 يوماً</h2>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="طلبات" value={n(d.leads.total)} tone="gold" />
            <Stat label="تحوّلت لاشتراك" value={n(d.leads.converted)} hint={pct(d.leads.converted, d.leads.total)} tone="ok" />
          </div>
          {d.leads.bySource.length === 0 ? <p className="text-sm text-muted-foreground">لا طلبات بعد.</p> : (
            <ul className="text-sm space-y-1">
              {d.leads.bySource.map((s) => <li key={s.source} className="flex justify-between"><span className="text-muted-foreground">{SOURCE_AR[s.source] ?? s.source}</span><span className="tabular-nums font-semibold">{n(s.n)}</span></li>)}
            </ul>
          )}
          <a href="/admin" className="text-xs text-primary underline underline-offset-4">إدارة الطلبات والخطط</a>
        </section>
      </div>
    </div>
  );
}
