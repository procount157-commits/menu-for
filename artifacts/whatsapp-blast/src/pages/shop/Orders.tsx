// ── /orders — the live order board ────────────────────────────────
// Columns left to right in the order food moves: waiting for the customer's
// WhatsApp message, new, being made, ready. Each card has one obvious next
// step. A received order chimes; a pending one sits quietly because the
// customer may still be choosing to send it.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChefHat, CheckCheck, ClipboardCopy, Clock, Hourglass, Inbox, Loader2, MapPin, Bike, ShoppingBag, Utensils,
  CalendarClock, X, History, BellRing, Phone, StickyNote, Undo2,
} from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { get, patch, useShop, useStream } from "@/lib/shop-api";
import { Btn, Empty, WaDot, ago, chime, clock, errText } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

type OrderStatus = "pending" | "received" | "preparing" | "ready" | "completed" | "cancelled";
type OrderType = "dine_in" | "pickup" | "delivery" | "preorder";

interface OrderLine { itemId: number; name: string; nameEn?: string | null; qty: number; unitPrice: number; options: Array<{ group: string; choice: string; priceDelta: number }>; note?: string; lineTotal: number }
interface Order {
  id: number; code: string; token: string; type: OrderType; tableLabel: string | null; customerName: string | null;
  phone: string | null; phoneVerified: boolean; address: string | null; items: OrderLine[]; subtotal: number; notes: string | null;
  scheduledFor: string | null; status: OrderStatus; createdAt: string; updatedAt: string;
}

const COLUMNS: Array<{ status: OrderStatus; label: string; hint: string; icon: typeof Inbox; tone: string }> = [
  { status: "pending", label: "بانتظار واتساب", hint: "فتح الزبون واتساب ولم تصل رسالته بعد", icon: Hourglass, tone: "text-muted-foreground" },
  { status: "received", label: "جديد", hint: "وصلت رسالة الزبون", icon: BellRing, tone: "text-primary" },
  { status: "preparing", label: "قيد التحضير", hint: "", icon: ChefHat, tone: "text-sky-300" },
  { status: "ready", label: "جاهز", hint: "يصل الزبون إشعار الجاهزية إن كان على واتساب", icon: CheckCheck, tone: "text-emerald-300" },
];

const TYPE: Record<OrderType, { label: string; icon: typeof Inbox }> = {
  dine_in: { label: "داخل المحل", icon: Utensils },
  pickup: { label: "استلام", icon: ShoppingBag },
  delivery: { label: "توصيل", icon: Bike },
  preorder: { label: "طلب مسبق", icon: CalendarClock },
};

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  pending: { to: "received", label: "قبول يدوياً" },
  received: { to: "preparing", label: "ابدأ التحضير" },
  preparing: { to: "ready", label: "جاهز" },
  ready: { to: "completed", label: "تم التسليم" },
};

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Older tablets without the clipboard API over plain http.
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}

export default function Orders() {
  const shop = useShop();
  const now = useNow();
  const stream = useStream<Order[]>("/api/orders/stream", { pollMs: 8_000 });
  const [orders, setOrders] = useState<Order[] | undefined>();
  const [busy, setBusy] = useState<number | null>(null);
  const [mobileCol, setMobileCol] = useState<OrderStatus>("received");
  const [showHistory, setShowHistory] = useState(false);
  const money = (v: number) => formatMoney(v, shop.org.currency);

  useEffect(() => { if (stream.data) setOrders(stream.data); }, [stream.data]);
  useEffect(() => { get<Order[]>("/api/orders").then((d) => setOrders((cur) => cur ?? d)).catch(() => {}); }, [shop.branch.id]);

  // Chime when a new order lands in «جديد» — whether it came in that way or
  // a pending one just had its WhatsApp message arrive.
  const seenReceived = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!orders) return;
    const rec = orders.filter((o) => o.status === "received").map((o) => o.id);
    if (seenReceived.current) {
      const fresh = orders.filter((o) => o.status === "received" && !seenReceived.current!.has(o.id));
      if (fresh.length) {
        chime("order");
        toast.success(`طلب جديد ${fresh.map((o) => `#${o.code}`).join("، ")}`, { duration: 4000 });
      }
    }
    // Remember everything that has ever been past pending, so moving a card
    // back does not chime again.
    seenReceived.current = new Set([...(seenReceived.current ?? []), ...rec, ...orders.filter((o) => o.status !== "pending").map((o) => o.id)]);
  }, [orders]);

  const move = async (o: Order, to: OrderStatus, undoable = true) => {
    if (busy) return;
    const from = o.status;
    setBusy(o.id);
    // Accepting by hand is not news to the person who did it — no chime.
    seenReceived.current?.add(o.id);
    setOrders((cur) => cur?.map((x) => (x.id === o.id ? { ...x, status: to } : x)));
    try {
      const u = await patch<Order>(`/api/orders/${o.id}`, { status: to });
      setOrders((cur) => cur?.map((x) => (x.id === o.id ? u : x)));
      if (undoable && from !== "pending") {
        toast(`#${o.code} ← ${label(to)}`, { duration: 4000, action: { label: "تراجع", onClick: () => void move({ ...u }, from, false) } });
      }
    } catch (e) {
      toast.error(errText(e));
      setOrders((cur) => cur?.map((x) => (x.id === o.id ? { ...x, status: from } : x)));
    } finally { setBusy(null); }
  };

  const copy = async (o: Order) => {
    try {
      const { text } = await get<{ text: string }>(`/api/orders/${o.id}/text`);
      (await copyText(text)) ? toast.success("نُسخ الطلب") : toast.error("تعذّر النسخ");
    } catch (e) { toast.error(errText(e)); }
  };

  const by = useMemo(() => {
    const m: Record<OrderStatus, Order[]> = { pending: [], received: [], preparing: [], ready: [], completed: [], cancelled: [] };
    for (const o of orders ?? []) m[o.status]?.push(o);
    // Oldest first in the working columns — first in, first out of the kitchen.
    for (const k of ["received", "preparing", "ready"] as const) m[k].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return m;
  }, [orders]);

  if (!orders) return <div className="h-full grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const history = [...by.completed, ...by.cancelled].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const today = orders.filter((o) => o.status !== "pending" && o.status !== "cancelled");
  const revenue = today.reduce((s, o) => s + o.subtotal, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 flex flex-wrap items-center gap-2 border-b border-border">
        <h1 className="font-bold text-base">الطلبات</h1>
        <span title={stream.live ? "متصل مباشرة" : "تحديث كل بضع ثوانٍ"} className={cn("w-2 h-2 rounded-full", stream.live ? "bg-emerald-400" : "bg-muted-foreground/50")} />
        <span className="text-xs text-muted-foreground">آخر 36 ساعة · {today.length} طلب · {money(revenue)}</span>
        <div className="flex-1" />
        <Btn tone={showHistory ? "gold" : "plain"} className="min-h-10" onClick={() => setShowHistory((v) => !v)}>
          <History className="w-4 h-4" />السجل ({history.length})
        </Btn>
      </div>

      {/* Phones see one column at a time. */}
      <div className="md:hidden shrink-0 flex gap-1 p-2 overflow-x-auto border-b border-border">
        {COLUMNS.map((c) => (
          <button key={c.status} onClick={() => { setMobileCol(c.status); setShowHistory(false); }}
            className={cn("px-3 h-10 rounded-lg text-sm whitespace-nowrap flex items-center gap-1.5",
              mobileCol === c.status && !showHistory ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary text-muted-foreground")}>
            {c.label}<span className="text-xs tabular-nums opacity-80">{by[c.status].length}</span>
          </button>
        ))}
      </div>

      {showHistory ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {history.length === 0 ? <Empty title="لا يوجد طلبات منتهية بعد" icon={<History />}>الطلبات المسلّمة والملغاة تظهر هنا.</Empty> : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {history.map((o) => <OrderCard key={o.id} o={o} now={now} money={money} tz={shop.org.timezone} busy={busy === o.id} onMove={move} onCopy={copy} compact />)}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 md:grid md:grid-cols-4 overflow-hidden">
          {COLUMNS.map((c) => (
            <section key={c.status} className={cn("h-full min-h-0 flex-col border-border md:[&:not(:last-child)]:border-e", mobileCol === c.status ? "flex" : "hidden md:flex")}>
              <div className="hidden md:flex shrink-0 items-center gap-2 px-3 py-2.5 border-b border-border">
                <c.icon className={cn("w-4 h-4", c.tone)} />
                <span className="font-semibold text-sm">{c.label}</span>
                <span className="text-xs rounded-full bg-secondary px-2 py-0.5 tabular-nums">{by[c.status].length}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                {c.hint && by[c.status].length > 0 && <div className="text-[11px] text-muted-foreground px-1">{c.hint}</div>}
                {by[c.status].length === 0
                  ? <ColumnEmpty status={c.status} />
                  : by[c.status].map((o) => <OrderCard key={o.id} o={o} now={now} money={money} tz={shop.org.timezone} busy={busy === o.id} onMove={move} onCopy={copy} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function label(s: OrderStatus) {
  return ({ pending: "بانتظار واتساب", received: "جديد", preparing: "قيد التحضير", ready: "جاهز", completed: "سُلّم", cancelled: "ملغي" } as const)[s];
}

function ColumnEmpty({ status }: { status: OrderStatus }) {
  const text = {
    pending: "لما يضغط الزبون «أرسل الطلب على واتساب» يظهر طلبه هنا حتى تصل رسالته.",
    received: "الطلبات الجديدة تظهر هنا مع صوت تنبيه.",
    preparing: "اضغط «ابدأ التحضير» على طلب جديد.",
    ready: "الطلبات الجاهزة للاستلام أو التوصيل.",
  }[status as "pending"];
  return <div className="text-center text-xs text-muted-foreground py-10 px-4 leading-relaxed">{text}</div>;
}

function OrderCard({ o, now, money, tz, busy, onMove, onCopy, compact }: {
  o: Order; now: number; money: (v: number) => string; tz: string; busy: boolean;
  onMove: (o: Order, to: OrderStatus) => void; onCopy: (o: Order) => void; compact?: boolean;
}) {
  const age = Math.max(0, Math.round((now - new Date(o.createdAt).getTime()) / 60_000));
  const T = TYPE[o.type] ?? TYPE.pickup;
  const step = NEXT[o.status];
  const done = o.status === "completed" || o.status === "cancelled";
  const stale = o.status === "received" && age >= 10;
  const sched = o.scheduledFor ? new Date(o.scheduledFor) : null;
  return (
    <article className={cn("rounded-xl border bg-card p-3 space-y-2.5", stale ? "border-amber-500/40" : o.status === "received" ? "border-primary/40" : "border-card-border", done && "opacity-75")}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-black text-lg tabular-nums tracking-wide" dir="ltr">#{o.code}</span>
            <span className="text-[11px] rounded-full bg-secondary px-2 py-0.5 flex items-center gap-1 whitespace-nowrap"><T.icon className="w-3 h-3" />{T.label}</span>
            {o.tableLabel && <span className="text-[11px] rounded-full bg-primary/15 text-primary px-2 py-0.5 whitespace-nowrap">طاولة {o.tableLabel}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-sm">
            <span className="truncate">{o.customerName || "زبون"}</span>
            <WaDot on={o.phoneVerified} />
            {o.phone && <a href={`tel:${o.phone}`} className="text-muted-foreground hover:text-foreground" aria-label="اتصال"><Phone className="w-3.5 h-3.5" /></a>}
          </div>
        </div>
        <div className="text-left shrink-0">
          <div className="font-bold tabular-nums text-sm">{money(o.subtotal)}</div>
          <div className={cn("text-[11px] tabular-nums flex items-center gap-1 justify-end", stale ? "text-amber-400" : "text-muted-foreground")}><Clock className="w-3 h-3" />{done ? clock(o.updatedAt, tz) : ago(age)}</div>
        </div>
      </header>

      {sched && (
        <div className="text-xs rounded-lg bg-primary/10 text-primary px-2.5 py-1.5 flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" />
          للاستلام {new Intl.DateTimeFormat("ar-AE-u-nu-latn", { timeZone: tz, weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(sched)}
        </div>
      )}

      {!compact && (
        <ul className="space-y-1.5 text-sm">
          {o.items.map((l, i) => (
            <li key={i} className="leading-snug">
              <div className="flex gap-2">
                <span className="font-bold tabular-nums text-primary w-6 shrink-0">{l.qty}×</span>
                <span className="flex-1">{l.name}</span>
              </div>
              {l.options?.length > 0 && <div className="ps-8 text-xs text-muted-foreground">{l.options.map((x) => x.choice).join(" · ")}</div>}
              {l.note && <div className="ps-8 text-xs text-amber-300/90">«{l.note}»</div>}
            </li>
          ))}
        </ul>
      )}
      {compact && <div className="text-xs text-muted-foreground truncate">{o.items.map((l) => `${l.qty}× ${l.name}`).join("، ")}</div>}

      {o.notes && !compact && <div className="text-xs bg-secondary/60 rounded-lg px-2.5 py-1.5 flex gap-1.5"><StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />{o.notes}</div>}
      {o.address && o.type === "delivery" && !compact && <div className="text-xs text-muted-foreground flex gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />{o.address}</div>}

      <footer className="flex items-center gap-1.5">
        {step && (
          <Btn tone={o.status === "pending" ? "plain" : "gold"} className="flex-1 min-h-11" disabled={busy} onClick={() => onMove(o, step.to)}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{step.label}
          </Btn>
        )}
        {done && <span className={cn("flex-1 text-xs", o.status === "cancelled" ? "text-red-300" : "text-emerald-300")}>{o.status === "cancelled" ? "ملغي" : "سُلّم"}</span>}
        {done && o.status === "cancelled" && <Btn tone="ghost" className="min-h-10 px-2.5" disabled={busy} onClick={() => onMove(o, "received")} title="إرجاعه للطلبات الجديدة"><Undo2 className="w-4 h-4" /></Btn>}
        <Btn tone="ghost" className="min-h-10 px-2.5" onClick={() => onCopy(o)} title="نسخ الطلب"><ClipboardCopy className="w-4 h-4" /><span className="hidden xl:inline">نسخ الطلب</span></Btn>
        {!done && (
          <Btn tone="ghost" className="min-h-10 px-2.5 hover:text-red-300" disabled={busy} title="إلغاء الطلب"
            onClick={() => { if (confirm(`إلغاء الطلب #${o.code}؟`)) onMove(o, "cancelled"); }}><X className="w-4 h-4" /></Btn>
        )}
      </footer>
    </article>
  );
}
