// ── /reports — how the shop is doing ──────────────────────────────
// Answers the owner's questions in the order they ask them: how many came,
// how long they waited, whether the time we promised was true, what sold,
// and when it gets busy. The ETA line is said plainly, including when the
// promise was too short.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, BarChart3, Clock, Target, MessageCircle, ShoppingBag, CalendarDays, Users, Star, AlertTriangle, Table2 } from "lucide-react";
import { addDays, formatMoney } from "@workspace/menu-shared";
import { get, useShop } from "@/lib/shop-api";
import { Empty, Stat, errText, isPlanError, n, PlanNotice } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface QRow { day: string; branch_id: number; joined: number; served: number; no_shows: number; left: number; avg_wait: number | null; eta_error: string | number | null; eta_bias: string | number | null; on_whatsapp: number }
interface ORow { day: string; branch_id: number; orders: number; abandoned: number; revenue: number }
interface BRow { day: string; branch_id: number; bookings: number; no_shows: number; cancelled: number }
interface Overview {
  days: number; since: string; branches: Array<{ id: number; name: string }>;
  queue: QRow[]; orders: ORow[]; bookings: BRow[];
  topItems: Array<{ item_id: number; name: string; qty: number; revenue: number }>;
  byHour: Array<{ hour: number; joined: number }>;
  customers: { total: number; newInRange: number; returning: number; avgRating: number | null };
}

// Validated for the dark chart surface (lightness band, chroma, CVD and
// contrast) — served is the brand gold; the other two are reserved for the
// queue outcomes so their meaning never shifts between charts.
const C = { served: "#b08a30", noShow: "#c4607f", left: "#3f8ad0" };
const SURFACE = "hsl(30 11% 9%)";
const AXIS = { fontSize: 11, fill: "hsl(36 8% 58%)" };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function weighted(rows: Array<{ v: number | null; w: number }>): number | null {
  const ok = rows.filter((r) => r.v !== null && r.w > 0);
  const W = ok.reduce((a, r) => a + r.w, 0);
  return W ? ok.reduce((a, r) => a + (r.v as number) * r.w, 0) / W : null;
}

export default function Reports() {
  const shop = useShop();
  const tz = shop.org.timezone;
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [branch, setBranch] = useState<number | "all">("all");
  const [table, setTable] = useState(false);
  const money = (v: number) => formatMoney(Math.round(v), shop.org.currency);

  const q = useQuery<Overview>({ queryKey: ["/api/reports/overview", days, branch], queryFn: () => get(`/api/reports/overview?days=${days}${branch === "all" ? "" : `&branch=${branch}`}`), placeholderData: (p) => p });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => addDays(today, i - (days - 1))), [days, today]);

  const data = q.data;
  const pick = <T extends { branch_id: number }>(rows: T[] | undefined) => (rows ?? []).filter((r) => branch === "all" || r.branch_id === branch);

  const daily = useMemo(() => {
    const qs = pick(data?.queue), os = pick(data?.orders), bs = pick(data?.bookings);
    return dayList.map((d) => {
      const qd = qs.filter((r) => r.day === d), od = os.filter((r) => r.day === d), bd = bs.filter((r) => r.day === d);
      const s = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
      return {
        day: d,
        // "25/9" — Arabic month names are too long for a 90-day axis.
        label: `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`,
        joined: s(qd, "joined"), served: s(qd, "served"), noShows: s(qd, "no_shows"), left: s(qd, "left"), onWa: s(qd, "on_whatsapp"),
        avgWait: weighted(qd.map((r) => ({ v: num(r.avg_wait), w: r.served + r.no_shows || r.joined }))),
        orders: s(od, "orders"), abandoned: s(od, "abandoned"), revenue: s(od, "revenue"),
        bookings: s(bd, "bookings"), bookNoShows: s(bd, "no_shows"),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, branch, dayList, days]);

  if (q.isLoading) return <div className="h-full grid place-items-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (q.error) return isPlanError(q.error) ? <PlanNotice what="التقارير" /> : <Empty title="تعذّر تحميل التقارير" icon={<AlertTriangle />}>{errText(q.error)}</Empty>;
  if (!data) return null;

  const qRows = pick(data.queue);
  const tot = daily.reduce((a, d) => ({
    joined: a.joined + d.joined, served: a.served + d.served, noShows: a.noShows + d.noShows, left: a.left + d.left, onWa: a.onWa + d.onWa,
    orders: a.orders + d.orders, abandoned: a.abandoned + d.abandoned, revenue: a.revenue + d.revenue, bookings: a.bookings + d.bookings, bookNoShows: a.bookNoShows + d.bookNoShows,
  }), { joined: 0, served: 0, noShows: 0, left: 0, onWa: 0, orders: 0, abandoned: 0, revenue: 0, bookings: 0, bookNoShows: 0 });
  const w = (r: QRow) => r.served + r.no_shows || r.joined;
  const avgWait = weighted(qRows.map((r) => ({ v: num(r.avg_wait), w: w(r) })));
  const etaErr = weighted(qRows.map((r) => ({ v: num(r.eta_error), w: w(r) })));
  const etaBias = weighted(qRows.map((r) => ({ v: num(r.eta_bias), w: w(r) })));
  const noShowRate = tot.served + tot.noShows ? Math.round((tot.noShows / (tot.served + tot.noShows)) * 100) : null;
  const waShare = tot.joined ? Math.round((tot.onWa / tot.joined) * 100) : null;
  const abandonRate = tot.orders + tot.abandoned ? Math.round((tot.abandoned / (tot.orders + tot.abandoned)) * 100) : null;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}`, joined: data.byHour.find((x) => x.hour === h)?.joined ?? 0 }))
    .filter((h, _, all) => { const lo = all.findIndex((x) => x.joined > 0), hi = all.length - 1 - [...all].reverse().findIndex((x) => x.joined > 0); return lo >= 0 && h.hour >= Math.max(0, lo - 1) && h.hour <= Math.min(23, hi + 1); });
  const peak = hours.reduce((m, h) => (h.joined > (m?.joined ?? 0) ? h : m), null as null | (typeof hours)[number]);
  const topMax = Math.max(1, ...data.topItems.map((i) => i.qty));
  const nothing = tot.joined === 0 && tot.orders === 0 && tot.bookings === 0 && tot.abandoned === 0;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold">التقارير</h1>
          <p className="text-sm text-muted-foreground mt-0.5">آخر {days} يوماً{q.isFetching ? " · يحدّث…" : ""}</p>
        </div>
        {data.branches.length > 1 && (
          <select className="h-10 rounded-xl bg-secondary border border-border px-3 text-sm" value={String(branch)} onChange={(e) => setBranch(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">كل الفروع</option>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="flex rounded-xl bg-secondary p-1 gap-1">
          {([7, 30, 90] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)} className={cn("px-3 h-8 rounded-lg text-sm tabular-nums", days === d ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}>{d} يوم</button>
          ))}
        </div>
      </div>

      {nothing ? (
        <Empty title="لا بيانات في هذه الفترة بعد" icon={<BarChart3 />} className="py-16">
          التقارير تمتلئ تلقائياً مع أول زبائن في الصف وأول طلبات. جرّب فترة أطول، أو شارك رابط المنيو والـ QR.
        </Empty>
      ) : (
        <>
          {/* ── Queue ── */}
          <Section icon={<Clock className="w-4 h-4" />} title="الصف">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Stat label="انضموا" value={n(tot.joined)} tone="gold" />
              <Stat label="خُدموا" value={n(tot.served)} />
              <Stat label="لم يحضروا" value={n(tot.noShows)} hint={noShowRate !== null ? `${noShowRate}% ممن نودي عليهم` : undefined} tone={noShowRate && noShowRate >= 15 ? "warn" : undefined} />
              <Stat label="خرجوا قبل دورهم" value={n(tot.left)} />
              <Stat label="متوسط الانتظار" value={avgWait === null ? "—" : `${Math.round(avgWait)} د`} />
            </div>

            <EtaHonesty error={etaErr} bias={etaBias} />

            <div className="grid md:grid-cols-2 gap-3">
              <ChartCard title="كل يوم: من خُدم ومن لم يحضر ومن خرج">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={daily} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="hsl(32 10% 15%)" />
                    <XAxis dataKey="label" reversed tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis orientation="right" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip content={<Tip />} cursor={{ fill: "hsl(32 10% 14% / .6)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Bar isAnimationActive={false} maxBarSize={32} dataKey="served" name="خُدم" stackId="q" fill={C.served} stroke={SURFACE} strokeWidth={2} />
                    <Bar isAnimationActive={false} maxBarSize={32} dataKey="noShows" name="لم يحضر" stackId="q" fill={C.noShow} stroke={SURFACE} strokeWidth={2} />
                    <Bar isAnimationActive={false} maxBarSize={32} dataKey="left" name="خرج" stackId="q" fill={C.left} stroke={SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="متوسط الانتظار (دقيقة)">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={daily} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(32 10% 15%)" />
                    <XAxis dataKey="label" reversed tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis orientation="right" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip content={<Tip unit="د" />} cursor={{ stroke: "hsl(36 8% 40%)", strokeDasharray: "3 3" }} />
                    <Line isAnimationActive={false} dataKey="avgWait" name="الانتظار" stroke={C.served} strokeWidth={2} dot={{ r: 3, fill: C.served, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
              <div className="rounded-xl border border-card-border bg-card p-4 flex gap-3 items-start">
                <MessageCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-sm leading-relaxed">
                  <div className="font-semibold">{waShare === null ? "—" : `${waShare}%`} تابعوا دورهم على واتساب</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    {waShare === null ? "لا انضمامات في الفترة." : waShare < 50
                      ? "أغلب الزبائن تابعوا من الصفحة فقط. لافتة صغيرة عند الـ QR («انضم وتابع على واتساب») ترفع النسبة، وتعني إشعاراً لكل زبون بدوره."
                      : "ممتاز — هؤلاء يصلهم «قرّب دورك» و«جاء دورك» بدون أن ينادي عليهم أحد."}
                  </div>
                </div>
              </div>
              <ChartCard title={peak ? `أوقات الذروة — أكثرها الساعة ${peak.hour}:00` : "أوقات الذروة"}>
                {hours.length === 0 ? <div className="text-sm text-muted-foreground py-8 text-center">لا بيانات بعد.</div> : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={hours} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="label" reversed tick={AXIS} tickLine={false} axisLine={false} interval={0} />
                      <YAxis hide />
                      <Tooltip content={<Tip labelPrefix="الساعة " />} cursor={{ fill: "hsl(32 10% 14% / .6)" }} />
                      <Bar isAnimationActive={false} maxBarSize={32} dataKey="joined" name="انضموا" fill={C.served} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>
          </Section>

          {/* ── Orders ── */}
          <Section icon={<ShoppingBag className="w-4 h-4" />} title="الطلبات">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="طلبات وصلت" value={n(tot.orders)} tone="gold" />
              <Stat label="المبيعات" value={money(tot.revenue)} />
              <Stat label="متوسط الطلب" value={tot.orders ? money(tot.revenue / tot.orders) : "—"} />
              <Stat label="لم تُرسل على واتساب" value={n(tot.abandoned)} hint={abandonRate !== null ? `${abandonRate}% ممن فتحوا السلة وضغطوا إرسال` : undefined} tone={abandonRate && abandonRate >= 30 ? "warn" : undefined} />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <ChartCard title="الطلبات كل يوم">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={daily} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(32 10% 15%)" />
                    <XAxis dataKey="label" reversed tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis orientation="right" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip content={<Tip />} cursor={{ fill: "hsl(32 10% 14% / .6)" }} />
                    <Bar isAnimationActive={false} maxBarSize={32} dataKey="orders" name="طلبات" fill={C.served} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title={`المبيعات كل يوم (${shop.org.currency})`}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={daily} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(32 10% 15%)" />
                    <XAxis dataKey="label" reversed tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<Tip format={money} />} cursor={{ fill: "hsl(32 10% 14% / .6)" }} />
                    <Bar isAnimationActive={false} maxBarSize={32} dataKey="revenue" name="المبيعات" fill={C.served} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            <div className="rounded-xl border border-card-border bg-card p-4">
              <div className="text-sm font-semibold mb-3">الأكثر طلباً</div>
              {data.topItems.length === 0 ? <div className="text-sm text-muted-foreground">لا طلبات مكتملة في الفترة.</div> : (
                <ol className="space-y-2">
                  {data.topItems.map((i, k) => (
                    <li key={i.item_id} className="flex items-center gap-3 text-sm" title={`${i.qty} · ${money(i.revenue)}`}>
                      <span className="w-5 text-muted-foreground tabular-nums">{k + 1}</span>
                      <span className="w-40 sm:w-56 truncate">{i.name}</span>
                      <span className="flex-1 h-2.5 rounded-full bg-secondary overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${(i.qty / topMax) * 100}%`, background: C.served }} /></span>
                      <span className="w-10 text-left tabular-nums">{i.qty}</span>
                      <span className="w-24 text-left tabular-nums text-muted-foreground hidden sm:block">{money(i.revenue)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>

          {/* ── Bookings and customers ── */}
          <div className="grid md:grid-cols-2 gap-5">
            <Section icon={<CalendarDays className="w-4 h-4" />} title="الحجوزات">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="حجوزات" value={n(tot.bookings)} tone="gold" />
                <Stat label="لم يحضروا" value={n(tot.bookNoShows)} hint={tot.bookings ? `${Math.round((tot.bookNoShows / tot.bookings) * 100)}%` : undefined} />
              </div>
            </Section>
            <Section icon={<Users className="w-4 h-4" />} title="الزبائن">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="جدد في الفترة" value={n(data.customers.newInRange)} tone="gold" />
                <Stat label="رجعوا" value={n(data.customers.returning)} hint={`من ${n(data.customers.total)}`} />
                <Stat label="التقييم" value={data.customers.avgRating ? <span className="flex items-center gap-1">{Number(data.customers.avgRating).toFixed(1)}<Star className="w-4 h-4 fill-primary text-primary" /></span> : "—"} />
              </div>
            </Section>
          </div>

          {/* ── The numbers behind the charts ── */}
          <div>
            <button onClick={() => setTable((v) => !v)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <Table2 className="w-4 h-4" />{table ? "إخفاء الجدول" : "عرض الأرقام كجدول"}
            </button>
            {table && (
              <div className="mt-2 rounded-xl border border-card-border bg-card overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                      <th>اليوم</th><th>انضموا</th><th>خُدموا</th><th>لم يحضروا</th><th>خرجوا</th><th>الانتظار</th><th>طلبات</th><th>لم تُرسل</th><th>المبيعات</th><th>حجوزات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...daily].reverse().map((d) => (
                      <tr key={d.day} className="border-b border-border/50 last:border-0 [&>td]:px-3 [&>td]:py-1.5">
                        <td dir="ltr" className="text-start">{d.day}</td><td>{d.joined}</td><td>{d.served}</td><td>{d.noShows}</td><td>{d.left}</td>
                        <td>{d.avgWait === null ? "—" : Math.round(d.avgWait)}</td><td>{d.orders}</td><td>{d.abandoned}</td><td>{money(d.revenue)}</td><td>{d.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-base text-foreground/90"><span className="text-primary">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 min-w-0">
      <div className="text-sm font-semibold mb-2 px-1">{title}</div>
      <div dir="ltr">{children}</div>
    </div>
  );
}

function Tip({ active, payload, label, unit, format, labelPrefix }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div dir="rtl" className="rounded-lg border border-popover-border bg-popover px-3 py-2 text-xs shadow-xl">
      <div className="text-muted-foreground mb-1">{labelPrefix ?? ""}{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color ?? p.fill }} />
          <span className="text-foreground/80">{p.name}</span>
          <span className="font-semibold tabular-nums ms-auto">{p.value === null || p.value === undefined ? "—" : format ? format(p.value) : `${Math.round(p.value * 10) / 10}${unit ? ` ${unit}` : ""}`}</span>
        </div>
      ))}
    </div>
  );
}

/** The promise, measured — said the way the owner would say it. */
function EtaHonesty({ error, bias }: { error: number | null; bias: number | null }) {
  if (error === null || bias === null) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 flex gap-3 text-sm text-muted-foreground">
        <Target className="w-5 h-5 shrink-0" />دقة الوقت التقريبي تظهر هنا بعد أن يُنادى على أول زبائن انضموا من الرابط.
      </div>
    );
  }
  const b = Math.round(Math.abs(bias));
  const e = Math.round(error);
  let headline: string, advice: string, tone: string;
  if (bias >= 1) {
    headline = `وعدنا الزبائن بوقت أقل من الواقع بـ${b} ${b === 1 ? "دقيقة" : "دقائق"} في المتوسط`;
    advice = "انتظروا أطول مما قلنا لهم. ارفع «متوسط وقت الخدمة» في إعدادات الصف، أو اضغط «+5» في شاشة الصف في أوقات الضغط.";
    tone = "border-amber-500/30 bg-amber-500/5";
  } else if (bias <= -1) {
    headline = `الانتظار الفعلي أقصر مما وعدنا بـ${b} ${b === 1 ? "دقيقة" : "دقائق"} في المتوسط`;
    advice = "مفاجأة لطيفة للزبون، لكن رقماً أعلى من الواقع قد يُبعد من كان سينتظر. خفّض «متوسط وقت الخدمة» قليلاً.";
    tone = "border-sky-500/25 bg-sky-500/5";
  } else {
    headline = "الوقت الذي نعد به الزبائن قريب جداً من الواقع";
    advice = "استمر — الزبون الذي يُصدَق في الوقت يرجع.";
    tone = "border-emerald-500/25 bg-emerald-500/5";
  }
  return (
    <div className={cn("rounded-xl border p-4 flex gap-3", tone)}>
      <Target className="w-5 h-5 text-primary shrink-0 mt-0.5" />
      <div className="text-sm leading-relaxed">
        <div className="font-semibold">{headline}</div>
        <div className="text-muted-foreground mt-1">
          الفرق المعتاد بين ما قلناه وما حصل ±{e} {e === 1 ? "دقيقة" : "د"}. {advice}
        </div>
      </div>
    </div>
  );
}
