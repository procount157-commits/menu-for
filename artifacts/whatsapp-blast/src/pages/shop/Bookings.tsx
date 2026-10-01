// ── /bookings — the day's reservations ────────────────────────────
// A strip of the next two weeks, then the chosen day grouped by time. The
// one action that matters on the night is «وصل»: it marks the guest arrived
// and puts them at the front of the queue, so a reservation is worth having.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, Check, Loader2, Minus, Phone, Plus, UserCheck, UserX, X, Clock, StickyNote, Settings2, Users } from "lucide-react";
import { addDays, zonedToUtc } from "@workspace/menu-shared";
import { ApiError, get, patch, post, useShop, useStream, inputCls, labelCls } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Btn, Empty, PlanNotice, WaDot, clock, errText } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

type BStatus = "pending" | "confirmed" | "arrived" | "done" | "cancelled" | "no_show";
interface Booking {
  id: number; code: string; customerName: string; phone: string | null; phoneVerified: boolean; partySize: number;
  itemId: number | null; startsAt: string; endsAt: string; status: BStatus; notes: string | null; source: string; createdAt: string;
}
interface Settings { enabled: boolean; slotMin: number; maxParty: number; maxDaysAhead: number; autoConfirm: boolean }
interface Item { id: number; name: string; kind: string; durationMin: number | null; isActive: boolean }

const DAYS = 15; // today + the next 14

const STATUS: Record<BStatus, { label: string; cls: string }> = {
  pending: { label: "بانتظار التأكيد", cls: "bg-amber-500/15 text-amber-300" },
  confirmed: { label: "مؤكد", cls: "bg-sky-500/15 text-sky-300" },
  arrived: { label: "وصل", cls: "bg-emerald-500/15 text-emerald-300" },
  done: { label: "انتهى", cls: "bg-secondary text-muted-foreground" },
  cancelled: { label: "ملغي", cls: "bg-red-500/10 text-red-300/80" },
  no_show: { label: "لم يحضر", cls: "bg-red-500/15 text-red-300" },
};

/** YYYY-MM-DD in the shop's own timezone. */
function ymd(at: Date | string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

export default function Bookings() {
  const shop = useShop();
  if (!shop.plan.features.booking) return <PlanNotice what={shop.vocab.booking[0]}>الحجوزات متاحة في الخطة الاحترافية وما فوق. <Link href="/shop/settings" className="text-primary underline">إعدادات المحل</Link></PlanNotice>;
  return <Day />;
}

function Day() {
  const shop = useShop();
  const { user } = useAuth();
  const tz = shop.org.timezone;
  const today = ymd(new Date(), tz);
  const [date, setDate] = useState(today);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isStaff = user?.role === "staff";

  // Staff cannot read the settings; for them the bookings themselves are enough.
  const settings = useQuery<Settings | null>({
    queryKey: ["/api/booking-settings", shop.branch.id],
    queryFn: () => get<Settings>("/api/booking-settings").catch((e) => { if (e instanceof ApiError && e.status === 403) return null; throw e; }),
    enabled: !isStaff,
  });

  const stream = useStream<Booking[]>(`/api/bookings/stream?from=${today}&days=${DAYS}`, { pollMs: 15_000 });
  const [rows, setRows] = useState<Booking[] | undefined>();
  useEffect(() => { if (stream.data) setRows(stream.data); }, [stream.data]);
  useEffect(() => { get<Booking[]>(`/api/bookings?from=${today}&days=${DAYS}`).then((d) => setRows((c) => c ?? d)).catch(() => {}); }, [today, shop.branch.id]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i)), [today]);
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of rows ?? []) if (b.status !== "cancelled") m.set(ymd(b.startsAt, tz), (m.get(ymd(b.startsAt, tz)) ?? 0) + 1);
    return m;
  }, [rows, tz]);
  const list = (rows ?? []).filter((b) => ymd(b.startsAt, tz) === date);
  const groups = useMemo(() => {
    const g = new Map<string, Booking[]>();
    for (const b of list) { const k = b.startsAt; g.set(k, [...(g.get(k) ?? []), b]); }
    return [...g.entries()].sort(([a], [b]) => +new Date(a) - +new Date(b));
  }, [list]);

  const replace = (u: Booking) => setRows((cur) => cur?.map((x) => (x.id === u.id ? { ...x, ...u } : x)));

  const setStatus = async (b: Booking, status: BStatus) => {
    setBusy(`${status}:${b.id}`);
    try { replace(await patch<Booking>(`/api/bookings/${b.id}`, { status })); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(null); }
  };

  const checkIn = async (b: Booking) => {
    setBusy(`in:${b.id}`);
    try {
      const r = await post<{ ticket: { displayCode: string } | null }>(`/api/bookings/${b.id}/check-in`);
      replace({ ...b, status: "arrived" });
      toast.success(r.ticket ? `${b.customerName} دخل الصف أولاً برقم ${r.ticket.displayCode}` : `سُجّل وصول ${b.customerName}`, {
        description: r.ticket ? "تجده في أعلى قائمة الانتظار في شاشة الصف" : undefined,
      });
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(null); }
  };

  // Staff cannot read the settings; the shop context says whether bookings are on.
  const disabled = settings.data ? !settings.data.enabled : !shop.booking.enabled;
  const live = list.filter((b) => b.status !== "cancelled");

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 flex flex-wrap items-center gap-2">
        <h1 className="font-bold text-base">{shop.vocab.booking[0] === "موعد" ? "المواعيد" : "الحجوزات"}</h1>
        <span title={stream.live ? "متصل مباشرة" : "تحديث دوري"} className={cn("w-2 h-2 rounded-full", stream.live ? "bg-emerald-400" : "bg-muted-foreground/50")} />
        <div className="flex-1" />
        <Btn tone="gold" className="min-h-10" onClick={() => setCreating(true)}><CalendarPlus className="w-4 h-4" />حجز جديد</Btn>
      </div>

      {disabled && (
        <div className="mx-3 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm flex flex-wrap items-center gap-2">
          <Settings2 className="w-4 h-4 text-amber-300" />
          <span className="flex-1 min-w-[12rem]">الحجز من صفحة المنيو متوقف لهذا الفرع — الزبائن لا يرون زر الحجز. تقدر تسجّل حجوزات بنفسك من هنا.</span>
          {user?.role !== "staff" && <Link href="/shop/settings" className="text-primary underline underline-offset-4">تفعيل الحجز</Link>}
        </div>
      )}

      {/* The date strip */}
      <div className="shrink-0 flex gap-1.5 overflow-x-auto px-3 pb-2.5 border-b border-border [scrollbar-width:thin]">
        {days.map((d, i) => {
          const at = zonedToUtc(tz, d, "12:00");
          const count = perDay.get(d) ?? 0;
          return (
            <button key={d} onClick={() => setDate(d)}
              className={cn("shrink-0 w-[4.25rem] rounded-xl border px-1 py-2 text-center transition",
                d === date ? "bg-primary text-primary-foreground border-primary" : "bg-card border-card-border hover:bg-secondary/60")}>
              <div className="text-[11px] opacity-80">{i === 0 ? "اليوم" : i === 1 ? "غداً" : new Intl.DateTimeFormat("ar-AE-u-nu-latn", { timeZone: tz, weekday: "short" }).format(at)}</div>
              <div className="text-lg font-bold tabular-nums leading-tight">{new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" }).format(at)}</div>
              <div className={cn("text-[10px] tabular-nums h-3.5", d === date ? "opacity-90" : count ? "text-primary" : "opacity-0")}>{count ? `${count} حجز` : "·"}</div>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!rows ? <div className="grid place-items-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          : groups.length === 0 ? (
            <Empty title={date === today ? "لا حجوزات اليوم" : "لا حجوزات في هذا اليوم"} icon={<CalendarDays />}>
              الحجوزات من صفحة المنيو تظهر هنا مباشرة. لزبون اتصل أو حضر، اضغط «حجز جديد».
            </Empty>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="text-xs text-muted-foreground">{live.length} حجز · {live.reduce((s, b) => s + b.partySize, 0)} شخص</div>
              {groups.map(([at, bs]) => (
                <section key={at} className="flex gap-3">
                  <div className="w-16 shrink-0 pt-2.5 text-left">
                    <div className="font-bold tabular-nums">{clock(at, tz)}</div>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2 border-s border-border ps-3">
                    {bs.map((b) => <BookingCard key={b.id} b={b} tz={tz} busy={busy} onStatus={setStatus} onCheckIn={checkIn} isToday={date === today} />)}
                  </div>
                </section>
              ))}
            </div>
          )}
      </div>

      <NewBooking open={creating} onOpenChange={setCreating} days={days} initialDate={date} settings={settings.data ?? null}
        onCreated={(b) => { setRows((cur) => (cur ? [...cur.filter((x) => x.id !== b.id), b] : [b])); setDate(ymd(b.startsAt, tz)); }} />
    </div>
  );
}

function BookingCard({ b, tz, busy, onStatus, onCheckIn, isToday }: {
  b: Booking; tz: string; busy: string | null; isToday: boolean;
  onStatus: (b: Booking, s: BStatus) => void; onCheckIn: (b: Booking) => void;
}) {
  const s = STATUS[b.status] ?? STATUS.confirmed;
  const open = b.status === "pending" || b.status === "confirmed";
  const late = open && isToday && Date.now() - new Date(b.startsAt).getTime() > 15 * 60_000;
  const is = (k: string) => busy === `${k}:${b.id}`;
  return (
    <article className={cn("rounded-xl border bg-card p-3", late ? "border-amber-500/40" : "border-card-border", (b.status === "cancelled" || b.status === "done") && "opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-base truncate">{b.customerName}</span>
            <WaDot on={b.phoneVerified} />
            <span className={cn("text-[11px] rounded-full px-2 py-0.5", s.cls)}>{s.label}</span>
            {late && <span className="text-[11px] rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-300">تأخر</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{b.partySize}</span>
            <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3.5 h-3.5" />{clock(b.startsAt, tz)}–{clock(b.endsAt, tz)}</span>
            <span dir="ltr" className="tabular-nums">#{b.code}</span>
            {b.phone && <a href={`tel:${b.phone}`} className="flex items-center gap-1 hover:text-foreground" dir="ltr"><Phone className="w-3.5 h-3.5" />{b.phone}</a>}
            {b.source === "staff" && <span>سجّله الموظف</span>}
          </div>
          {b.notes && <div className="mt-1.5 text-xs bg-secondary/60 rounded-lg px-2.5 py-1.5 flex gap-1.5"><StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" />{b.notes}</div>}
        </div>
      </div>
      {(open || b.status === "arrived") && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {b.status === "pending" && <Btn tone="plain" className="min-h-10" disabled={is("confirmed")} onClick={() => onStatus(b, "confirmed")}><Check className="w-4 h-4" />تأكيد</Btn>}
          {open && <Btn tone="ok" className="min-h-10 flex-1 sm:flex-none" disabled={is("in")} onClick={() => onCheckIn(b)}>{is("in") ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}وصل</Btn>}
          {open && <Btn tone="ghost" className="min-h-10" disabled={is("no_show")} onClick={() => onStatus(b, "no_show")}><UserX className="w-4 h-4" />لم يحضر</Btn>}
          {open && <Btn tone="ghost" className="min-h-10 hover:text-red-300" disabled={is("cancelled")} onClick={() => { if (confirm(`إلغاء حجز ${b.customerName}؟ يصله إشعار بالإلغاء إن كان على واتساب.`)) onStatus(b, "cancelled"); }}><X className="w-4 h-4" />إلغاء</Btn>}
          {b.status === "arrived" && <Btn tone="plain" className="min-h-10" disabled={is("done")} onClick={() => onStatus(b, "done")}><Check className="w-4 h-4" />انتهى</Btn>}
        </div>
      )}
    </article>
  );
}

// ── «حجز جديد» ────────────────────────────────────────────────────

function NewBooking({ open, onOpenChange, days, initialDate, settings, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; days: string[]; initialDate: string; settings: Settings | null;
  onCreated: (b: Booking) => void;
}) {
  const shop = useShop();
  const tz = shop.org.timezone;
  const services = shop.vocab.services;
  const [date, setDate] = useState(initialDate);
  const [party, setParty] = useState(2);
  const [item, setItem] = useState<number | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(initialDate); setParty(services ? 1 : 2); setItem(null); setSlot(null); setCustom(""); setName(""); setPhone(""); setNotes("");
  }, [open, initialDate, services]);

  const items = useQuery<Item[]>({ queryKey: ["/api/menu/items"], queryFn: () => get("/api/menu/items"), enabled: open && services });
  const svcList = (items.data ?? []).filter((i) => i.isActive && (i.kind === "service" || i.durationMin));

  const slots = useQuery<{ slots: Array<{ start: string; remaining: number }> }>({
    queryKey: ["/api/bookings/slots", date, party, item],
    queryFn: () => get(`/api/bookings/slots?date=${date}&party=${party}${item ? `&item=${item}` : ""}`),
    enabled: open,
  });
  useEffect(() => setSlot(null), [date, party, item]);

  const startsAt = custom ? zonedToUtc(tz, date, custom).toISOString() : slot;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("اكتب اسم الزبون"); return; }
    if (!startsAt) { toast.error("اختر الوقت"); return; }
    setBusy(true);
    try {
      const b = await post<Booking>("/api/bookings", { startsAt, customerName: name.trim(), phone: phone.trim() || null, partySize: party, itemId: item, notes: notes.trim() || null });
      onCreated(b);
      toast.success(`تم الحجز — ${clock(b.startsAt, tz)}`, { description: phone.trim() ? "يصله التأكيد على واتساب لو سبق وراسلنا" : undefined });
      onOpenChange(false);
    } catch (err) { toast.error(errText(err)); }
    finally { setBusy(false); }
  };

  const freeSlots = slots.data?.slots ?? [];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="حجز جديد" description="لزبون اتصل أو حضر. تقدر تختار أي وقت حتى لو كان ممتلئاً." wide>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelCls}>اليوم</label>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map((d, i) => (
              <button type="button" key={d} onClick={() => setDate(d)}
                className={cn("shrink-0 px-3 h-10 rounded-lg text-sm whitespace-nowrap", d === date ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>
                {i === 0 ? "اليوم" : i === 1 ? "غداً" : new Intl.DateTimeFormat("ar-AE-u-nu-latn", { timeZone: tz, weekday: "short", day: "numeric" }).format(zonedToUtc(tz, d, "12:00"))}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>عدد الأشخاص</label>
            <div className="flex items-center gap-2">
              <button type="button" className="w-11 h-11 rounded-xl bg-secondary grid place-items-center" onClick={() => setParty((p) => Math.max(1, p - 1))} aria-label="أقل"><Minus className="w-4 h-4" /></button>
              <div className="w-12 text-center text-xl font-bold tabular-nums">{party}</div>
              <button type="button" className="w-11 h-11 rounded-xl bg-secondary grid place-items-center" onClick={() => setParty((p) => Math.min(50, p + 1))} aria-label="أكثر"><Plus className="w-4 h-4" /></button>
            </div>
            {settings && party > settings.maxParty && <div className="text-[11px] text-amber-300 mt-1">أكبر من حد الحجز ({settings.maxParty}) — اختر وقتاً بنفسك.</div>}
          </div>
          {services && (
            <div>
              <label className={labelCls}>{shop.vocab.item[0]}</label>
              <select className={inputCls} value={item ?? ""} onChange={(e) => setItem(e.target.value ? Number(e.target.value) : null)}>
                <option value="">بدون تحديد</option>
                {svcList.map((i) => <option key={i.id} value={i.id}>{i.name}{i.durationMin ? ` · ${i.durationMin} د` : ""}</option>)}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>الوقت</label>
          {slots.isLoading ? <div className="py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div> : (
            freeSlots.length ? (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-44 overflow-y-auto">
                {freeSlots.map((s) => (
                  <button type="button" key={s.start} onClick={() => { setSlot(s.start); setCustom(""); }}
                    className={cn("h-10 rounded-lg text-sm tabular-nums", slot === s.start && !custom ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary hover:bg-secondary/70")}>
                    {clock(s.start, tz)}
                  </button>
                ))}
              </div>
            ) : <div className="text-sm text-muted-foreground py-1">لا مواعيد متاحة في هذا اليوم حسب إعدادات الحجز — اختر وقتاً بنفسك.</div>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">أو وقت آخر:</span>
            <input type="time" className={cn(inputCls, "w-36")} dir="ltr" value={custom} onChange={(e) => { setCustom(e.target.value); setSlot(null); }} />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>اسم الزبون</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div>
            <label className={labelCls}>رقم الواتساب (اختياري)</label>
            <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05x xxx xxxx" />
          </div>
        </div>
        <div>
          <label className={labelCls}>ملاحظات (اختياري)</label>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مناسبة، طاولة قرب النافذة…" maxLength={200} />
        </div>
        <Btn tone="gold" type="submit" className="w-full min-h-12 text-base" disabled={busy || !startsAt}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
          {startsAt ? `احجز ${clock(startsAt, tz)}` : "اختر الوقت"}
        </Btn>
      </form>
    </Modal>
  );
}
