// ── Menu analytics on /reports ────────────────────────────────────
// From menu opened to order placed, what each item is looked at and bought,
// what is looked at and not bought, when orders come — and what the people
// the queue lost were roughly worth.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Eye, Lock, MousePointerClick, ShoppingCart, TrendingDown, Clock, DoorOpen } from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { get } from "@/lib/shop-api";
import { n } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface Item { item_id: number; name: string; views: number; adds: number; ordered: number }
type Resp =
  | { locked: true; planName: string; recorded: number }
  | { locked: false; days: number; funnel: { menuViews: number; itemViews: number; adds: number; carts: number; orders: number }; items: Item[]; lookedNotBought: Item[]; byHour: Array<{ hour: number; orders: number }>; lostQueue: { people: number; avgOrder: number; value: number } };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export function MenuStatsCard({ days, branch, currency, services }: { days: number; branch: number | "all"; currency: string; services: boolean }) {
  const q = useQuery<Resp>({ queryKey: ["/api/growth/menu-stats", days, branch], queryFn: () => get(`/api/growth/menu-stats?days=${days}${branch === "all" ? "" : `&branch=${branch}`}`) });
  const money = (v: number) => formatMoney(Math.round(v), currency);
  if (!q.data) return null;
  const d = q.data;

  if (d.locked) {
    return (
      <section className="rounded-xl border border-card-border bg-card p-5 flex flex-wrap items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center"><Lock className="w-5 h-5" /></div>
        <div className="flex-1 min-w-[14rem]">
          <h2 className="font-bold">تحليلات المنيو</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            ما يشاهده زبائنك ولا يطلبونه، ونسبة من فتح المنيو وطلب، وأوقات الذروة. نسجّلها لمحلك من الآن
            {d.recorded ? ` (${n(d.recorded)} مرة فُتح فيها منيوك حتى اليوم)` : ""} — وتظهر كاملة في خطة «أعمال». خطتك الحالية {d.planName}.
          </p>
        </div>
        <Link href="/shop/settings" className="text-sm text-primary underline underline-offset-4">الترقية</Link>
      </section>
    );
  }

  const f = d.funnel;
  const steps = [
    { label: "فتحوا المنيو", v: f.menuViews, icon: Eye },
    { label: "فتحوا صنفاً", v: f.itemViews, icon: MousePointerClick },
    { label: "أضافوا للسلة", v: f.adds, icon: ShoppingCart },
    { label: "فتحوا السلة", v: f.carts, icon: ShoppingCart },
    { label: "طلبوا", v: f.orders, icon: ShoppingCart },
  ];
  const top = Math.max(1, ...steps.map((s) => s.v));
  const hourMax = Math.max(1, ...d.byHour.map((h) => h.orders));
  const peak = [...d.byHour].sort((a, b) => b.orders - a.orders)[0];

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-5">
      <header className="flex items-center gap-2"><Eye className="w-5 h-5 text-primary" /><h2 className="font-bold flex-1">تحليلات المنيو</h2><span className="text-xs text-muted-foreground">آخر {d.days} يوماً</span></header>

      {f.menuViews === 0 && f.orders === 0 ? (
        <p className="text-sm text-muted-foreground">لا مشاهدات مسجّلة بعد — تبدأ الأرقام مع أول من يفتح رابط المنيو أو الـ QR.</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">من فتح المنيو إلى الطلب</div>
            {steps.map((s, i) => (
              <div key={s.label} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{s.label}</span>
                <div className="flex-1 h-6 rounded-md bg-secondary/50 overflow-hidden">
                  <div className="h-full rounded-md bg-primary/70" style={{ width: `${Math.max(2, (s.v / top) * 100)}%` }} />
                </div>
                <span className="w-16 text-left tabular-nums font-semibold">{n(s.v)}</span>
                <span className="w-12 text-left tabular-nums text-xs text-muted-foreground">{i ? pct(s.v, steps[0]!.v) : ""}</span>
              </div>
            ))}
            {!services && d.lostQueue.people > 0 && (
              <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-sm flex items-start gap-2">
                <DoorOpen className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                <span>{n(d.lostQueue.people)} خرجوا من الصف أو لم يحضروا — تقريباً {money(d.lostQueue.value)} بمتوسط طلبك ({money(d.lostQueue.avgOrder)}).</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" />الطلبات حسب الساعة{peak ? ` — الذروة ${peak.hour}:00` : ""}</div>
            <div className="flex items-end gap-1 h-32">
              {Array.from({ length: 24 }, (_, h) => {
                const v = d.byHour.find((x) => x.hour === h)?.orders ?? 0;
                return <div key={h} className="flex-1 flex flex-col items-center gap-1" title={`${h}:00 — ${v}`}>
                  <div className={cn("w-full rounded-t", v ? "bg-primary/70" : "bg-secondary/40")} style={{ height: `${Math.max(3, (v / hourMax) * 100)}%` }} />
                  {h % 3 === 0 && <span className="text-[9px] text-muted-foreground tabular-nums">{h}</span>}
                </div>;
              })}
            </div>
          </div>
        </div>
      )}

      {d.lookedNotBought.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold flex items-center gap-1.5"><TrendingDown className="w-4 h-4 text-amber-300" />يُشاهَد كثيراً ولا يُطلب</div>
          <p className="text-xs text-muted-foreground mt-0.5">جرّب صورة أوضح، وصفاً يشرح الطعم والحجم، أو راجع السعر.</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {d.lookedNotBought.map((i) => <span key={i.item_id} className="text-xs rounded-full bg-secondary px-2.5 py-1">{i.name} · {n(i.views)} مشاهدة · {n(i.ordered)} طلب</span>)}
          </div>
        </div>
      )}

      {d.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium">
              <th>{services ? "الخدمة" : "الصنف"}</th><th>شوهد</th><th>أُضيف للسلة</th><th>طُلب</th><th>من شاهد وطلب</th>
            </tr></thead>
            <tbody>
              {d.items.slice(0, 15).map((i) => (
                <tr key={i.item_id} className="border-t border-border/60 [&>td]:px-2 [&>td]:py-1.5 tabular-nums">
                  <td className="font-medium">{i.name}</td><td>{n(i.views)}</td><td>{n(i.adds)}</td><td>{n(i.ordered)}</td>
                  <td className={cn(i.views >= 10 && i.ordered / i.views < 0.05 && "text-amber-300")}>{pct(i.ordered, i.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
