// ── /deals — coupons and timed deals ──────────────────────────────
// Two kinds, one list: a code the customer types («RAMADAN20»), or a deal
// that applies by itself during its hours («ساعة سعيدة 3 إلى 6»). Each shows
// whether it is running now and what it has brought in.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Clock, Loader2, Plus, Tag, Ticket, Trash2 } from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { get, patch, post, del, useShop, inputCls, labelCls } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, Stat, errText, n, shortDate } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";
import { ReferralPanel } from "@/components/shop/ReferralPanel";
import { LoyaltyPanel } from "@/components/shop/LoyaltyPanel";

interface Deal {
  id: number; code: string | null; title: string; kind: "pct" | "amount"; value: number; minSubtotal: number; maxDiscount: number | null;
  days: number[]; fromTime: string | null; toTime: string | null; startsAt: string | null; endsAt: string | null;
  maxUses: number | null; uses: number; isActive: boolean; oncePerPhone: boolean; phone: string | null; source: string;
  status: "live" | "scheduled" | "ended" | "off" | "used_up"; orders: number; discountGiven: number; sales: number;
}
interface Resp { allowed: boolean; planName: string; deals: Deal[] }

const DAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const STATUS: Record<Deal["status"], { label: string; cls: string }> = {
  live: { label: "يعمل الآن", cls: "bg-emerald-500/15 text-emerald-300" },
  scheduled: { label: "ينتظر وقته", cls: "bg-sky-500/15 text-sky-300" },
  ended: { label: "انتهى", cls: "bg-secondary text-muted-foreground" },
  used_up: { label: "استُخدم بالكامل", cls: "bg-secondary text-muted-foreground" },
  off: { label: "متوقف", cls: "bg-secondary text-muted-foreground" },
};
const SOURCE: Record<string, string> = { birthday: "هدية عيد ميلاد", referral: "مكافأة دعوة صديق", loyalty: "هدية بطاقة الأختام" };

export default function Deals() {
  const shop = useShop();
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: ["/api/deals"], queryFn: () => get("/api/deals") });
  const [creating, setCreating] = useState<"code" | "auto" | null>(null);
  const [showPersonal, setShowPersonal] = useState(false);
  const money = (v: number) => formatMoney(v, shop.org.currency);
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/deals"] });

  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <Empty title="تعذّر التحميل" icon={<AlertTriangle />} className="py-24">{errText(q.error)}</Empty>;
  const all = q.data.deals;
  const owner = all.filter((d) => d.source === "owner");
  const personal = all.filter((d) => d.source !== "owner");
  const tot = owner.reduce((a, d) => ({ orders: a.orders + d.orders, off: a.off + d.discountGiven, sales: a.sales + d.sales }), { orders: 0, off: 0, sales: 0 });

  const toggle = async (d: Deal, v: boolean) => { try { await patch(`/api/deals/${d.id}`, { isActive: v }); refresh(); } catch (e) { toast.error(errText(e)); } };
  const remove = async (d: Deal) => { if (!confirm(`حذف «${d.title}»؟`)) return; try { await del(`/api/deals/${d.id}`); refresh(); } catch (e) { toast.error(errText(e)); } };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold flex items-center gap-2"><Tag className="w-5 h-5 text-primary" />العروض والكوبونات</h1>
          <p className="text-sm text-muted-foreground mt-0.5">كود يكتبه الزبون في السلة، أو عرض يعمل وحده في ساعات تختارها ليملأ الأوقات الهادئة.</p>
        </div>
        <Btn tone="plain" disabled={!q.data.allowed} onClick={() => setCreating("auto")}><Clock className="w-4 h-4" />عرض بالساعات</Btn>
        <Btn tone="gold" disabled={!q.data.allowed} onClick={() => setCreating("code")}><Plus className="w-4 h-4" />كود خصم</Btn>
      </div>

      {!q.data.allowed && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300" />العروض والكوبونات من خطة «احترافي» — خطتك الحالية {q.data.planName}.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        <LoyaltyPanel />
        <ReferralPanel />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="طلبات استخدمت عرضاً" value={n(tot.orders)} tone="gold" />
        <Stat label="مبيعاتها" value={money(tot.sales)} />
        <Stat label="مجموع الخصم" value={money(tot.off)} />
      </div>

      <div className="rounded-xl border border-card-border bg-card divide-y divide-border/60">
        {owner.length === 0 ? (
          <Empty title="لا عروض بعد" icon={<Ticket />}>جرّب «ساعة سعيدة»: خصم 15% من 3 إلى 6 العصر أيام الأسبوع — يظهر في المنيو ويُطبّق وحده.</Empty>
        ) : owner.map((d) => <Row key={d.id} d={d} money={money} tz={shop.org.timezone} onToggle={toggle} onRemove={remove} />)}
      </div>

      {personal.length > 0 && (
        <div>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowPersonal((v) => !v)}>
            أكواد شخصية أُرسلت تلقائياً ({personal.length}) — أعياد ميلاد، دعوات، وبطاقات أختام {showPersonal ? "▲" : "▼"}
          </button>
          {showPersonal && (
            <div className="mt-2 rounded-xl border border-card-border bg-card divide-y divide-border/60">
              {personal.map((d) => <Row key={d.id} d={d} money={money} tz={shop.org.timezone} onToggle={toggle} onRemove={remove} />)}
            </div>
          )}
        </div>
      )}

      <DealDialog mode={creating} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); refresh(); }} currency={shop.org.currency} />
    </div>
  );
}

function Row({ d, money, tz, onToggle, onRemove }: { d: Deal; money: (v: number) => string; tz: string; onToggle: (d: Deal, v: boolean) => void; onRemove: (d: Deal) => void }) {
  const when = [
    d.days.length && d.days.length < 7 ? d.days.map((x) => DAYS[x]).join("، ") : null,
    d.fromTime && d.toTime ? `${d.fromTime}–${d.toTime}` : null,
    d.endsAt ? `حتى ${shortDate(d.endsAt, tz)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="p-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={cn("text-[11px] rounded-full px-2 py-0.5", STATUS[d.status].cls)}>{STATUS[d.status].label}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm flex flex-wrap items-center gap-2">
          {d.title}
          {d.code ? <span className="font-mono text-xs rounded bg-secondary px-1.5 py-0.5" dir="ltr">{d.code}</span> : <span className="text-[11px] text-sky-300">تلقائي</span>}
          {SOURCE[d.source] && <span className="text-[11px] text-muted-foreground">{SOURCE[d.source]}</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {d.kind === "pct" ? `خصم ${d.value}%` : `خصم ${money(d.value)}`}
          {d.minSubtotal > 0 ? ` · من ${money(d.minSubtotal)}` : ""}{d.maxDiscount ? ` · بحد أقصى ${money(d.maxDiscount)}` : ""}
          {when ? ` · ${when}` : ""}{d.maxUses ? ` · ${d.uses}/${d.maxUses} استخدام` : ""}{d.oncePerPhone ? " · مرة لكل رقم" : ""}
        </div>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums text-left">{n(d.orders)} طلب · {money(d.sales)}</div>
      <Switch checked={d.isActive} onCheckedChange={(v) => onToggle(d, v)} dir="ltr" />
      <button onClick={() => onRemove(d)} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:text-red-300 hover:bg-secondary/60" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

function DealDialog({ mode, onClose, onSaved, currency }: { mode: "code" | "auto" | null; onClose: () => void; onSaved: () => void; currency: string }) {
  const empty = { title: "", code: "", kind: "pct" as "pct" | "amount", value: "", minSubtotal: "", maxDiscount: "", days: [] as number[], fromTime: "", toTime: "", endsAt: "", maxUses: "", oncePerPhone: false };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const isCode = mode === "code";
  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const close = () => { setF(empty); onClose(); };
  const save = async () => {
    setBusy(true);
    try {
      await post("/api/deals", { ...f, code: isCode ? f.code : null, endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:00`).toISOString() : null });
      toast.success(isCode ? "أُضيف الكود" : "أُضيف العرض");
      setF(empty); onSaved();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  const preset = () => setF({ ...empty, title: "ساعة سعيدة", value: "15", fromTime: "15:00", toTime: "18:00", days: [0, 1, 2, 3, 4] });

  return (
    <Modal open={!!mode} onOpenChange={(v) => !v && close()} wide title={isCode ? "كود خصم جديد" : "عرض بالساعات"}
      description={isCode ? "يكتبه الزبون في السلة. شاركه في الحالة أو الإنستغرام أو مع زبائنك المميزين." : "يظهر في المنيو ويُطبّق وحده في الأيام والساعات التي تختارها."}>
      <div className="space-y-3">
        {!isCode && !f.title && <button type="button" onClick={preset} className="text-xs text-primary underline underline-offset-4">املأ مثالاً: ساعة سعيدة 15% من 3 إلى 6 العصر، الأحد–الخميس</button>}
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className={labelCls}>الاسم الذي يراه الزبون</span><input className={inputCls} value={f.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder={isCode ? "عرض رمضان" : "ساعة سعيدة"} /></label>
          {isCode && <label><span className={labelCls}>الكود</span><input className={cn(inputCls, "font-mono uppercase")} dir="ltr" value={f.code} maxLength={24} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="RAMADAN20" /></label>}
          <div>
            <span className={labelCls}>الخصم</span>
            <div className="flex gap-2">
              <input className={cn(inputCls, "tabular-nums")} type="number" min={1} value={f.value} onChange={(e) => set("value", e.target.value)} />
              <div className="flex rounded-lg bg-secondary p-0.5 shrink-0">
                {(["pct", "amount"] as const).map((k) => <button key={k} type="button" onClick={() => set("kind", k)} className={cn("px-3 rounded-md text-sm", f.kind === k ? "bg-background font-semibold" : "text-muted-foreground")}>{k === "pct" ? "%" : currency}</button>)}
              </div>
            </div>
          </div>
          <label><span className={labelCls}>أقل قيمة للطلب (اختياري)</span><input className={cn(inputCls, "tabular-nums")} type="number" min={0} value={f.minSubtotal} onChange={(e) => set("minSubtotal", e.target.value)} /></label>
          {f.kind === "pct" && <label><span className={labelCls}>أقصى خصم بالمبلغ (اختياري)</span><input className={cn(inputCls, "tabular-nums")} type="number" min={0} value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} /></label>}
          <label><span className={labelCls}>ينتهي في (اختياري)</span><input className={inputCls} type="date" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></label>
          {isCode && <label><span className={labelCls}>عدد مرات الاستخدام (اختياري)</span><input className={cn(inputCls, "tabular-nums")} type="number" min={1} value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} placeholder="بلا حد" /></label>}
        </div>
        <div>
          <span className={labelCls}>الأيام {isCode ? "(اختياري — فارغ يعني كل يوم)" : ""}</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((l, i) => {
              const on = f.days.includes(i);
              return <button key={i} type="button" onClick={() => set("days", on ? f.days.filter((x) => x !== i) : [...f.days, i])} className={cn("px-3 h-9 rounded-lg text-sm", on ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary text-muted-foreground")}>{l}</button>;
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label><span className={labelCls}>من الساعة {isCode ? "(اختياري)" : ""}</span><input className={inputCls} type="time" value={f.fromTime} onChange={(e) => set("fromTime", e.target.value)} /></label>
          <label><span className={labelCls}>إلى الساعة</span><input className={inputCls} type="time" value={f.toTime} onChange={(e) => set("toTime", e.target.value)} /></label>
        </div>
        {isCode && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-[hsl(var(--primary))]" checked={f.oncePerPhone} onChange={(e) => set("oncePerPhone", e.target.checked)} />مرة واحدة لكل رقم واتساب</label>
        )}
        <div className="flex gap-2 pt-1">
          <Btn tone="gold" disabled={busy || !f.title.trim() || !f.value} onClick={save}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}حفظ</Btn>
          <Btn tone="ghost" onClick={close}>إلغاء</Btn>
        </div>
      </div>
    </Modal>
  );
}
