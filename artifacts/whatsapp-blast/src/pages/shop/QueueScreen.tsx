// ── /queue — the counter screen ───────────────────────────────────
// Used all evening on a tablet by the door or a phone in a pocket, so it is
// built around one thumb: «التالي» at the bottom, the person just called
// large above it, and everything else one tap away. The server's view comes
// over SSE; every action also answers with the fresh view, and «التالي»
// moves the line locally before the answer arrives so it never feels slow.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Bell, BellOff, Check, ChevronLeft, Clock, Loader2, Lock, LockOpen, Minus, Pause, Play, Plus, RotateCcw,
  Undo2, UserPlus, Users, UserX, Volume2, Megaphone, Trash2, Footprints, Sparkles, ListOrdered, CalendarCheck, Phone,
} from "lucide-react";
import { formatEta, type EtaRange } from "@workspace/menu-shared";
import { get, post, useShop, useStream, inputCls, labelCls } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Btn, Empty, Eta, PlanNotice, Stat, WaDot, ago, chime, errText, isPlanError, n } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

// ── The shape staffView() sends ───────────────────────────────────

type Status = "waiting" | "called" | "serving" | "done" | "no_show" | "cancelled" | "left";

interface Ticket {
  id: number; displayCode: string; number: number; status: Status; priority: number;
  customerName: string | null; partySize: number; phone: string | null; phoneVerified: boolean;
  source: string; note: string | null; serviceItemId: number | null;
  joinedAt: string; calledAt: string | null; servingAt: string | null; onMyWay: boolean; recallCount: number;
  waitedMin: number; sinceCalledMin: number | null; late: boolean; ahead: number; eta: EtaRange;
}

interface QueueRow {
  id: number; name: string; nameEn: string | null; prefix: string; isOpen: boolean; isPaused: boolean;
  avgServiceMin: number; etaAdjustMin: number; maxWaiting: number; noShowMin: number; askPartySize: boolean;
}

interface View {
  queue: QueueRow; day: string; interval: { minutes: number; samples: number }; nextEta: EtaRange;
  counts: { waiting: number; called: number; serving: number; served: number; noShows: number };
  avgWaitToday: number | null;
  waiting: Ticket[]; called: Ticket[]; serving: Ticket[];
}

type Action = "recall" | "arrived" | "done" | "no-show" | "requeue" | "remove";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Re-render every 20 s so "منذ 3 د" keeps counting between server updates. */
function useNow(ms = 20_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
const minsSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000)) : null);

export default function QueueScreen() {
  const shop = useShop();
  if (!shop.plan.features.queue) return <PlanNotice what="الصف الرقمي" />;
  return <QueueLoader />;
}

function QueueLoader() {
  const shop = useShop();
  const { user } = useAuth();
  const queues = useQuery<QueueRow[]>({ queryKey: ["/api/queue", shop.branch.id], queryFn: () => get("/api/queue") });
  const key = `mfy.queue.${shop.branch.id}`;
  const [picked, setPicked] = useState<number | null>(() => Number(store.get(key)) || null);

  if (queues.isLoading) return <div className="h-full grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (queues.error) {
    if (isPlanError(queues.error)) return <PlanNotice what="الصف الرقمي" />;
    return <Empty title="تعذّر تحميل الصف" icon={<ListOrdered />}>{errText(queues.error)}</Empty>;
  }
  const list = queues.data ?? [];
  if (!list.length) {
    const canSetUp = user?.role !== "staff";
    return (
      <Empty title="لا يوجد صف مفعّل لهذا الفرع" icon={<ListOrdered />} className="h-full">
        {canSetUp
          ? <>أنشئ صفاً من <Link href="/shop/settings" className="text-primary underline">إعدادات المحل</Link> ثم ارجع هنا.</>
          : "اطلب من صاحب المحل تفعيل الصف لهذا الفرع."}
      </Empty>
    );
  }
  const id = list.some((q) => q.id === picked) ? picked! : list[0]!.id;
  const choose = (q: number) => { setPicked(q); store.set(key, String(q)); };
  return <Counter key={id} queueId={id} queues={list} onPick={choose} />;
}

// ── The counter ───────────────────────────────────────────────────

function Counter({ queueId, queues, onPick }: { queueId: number; queues: QueueRow[]; onPick: (id: number) => void }) {
  const shop = useShop();
  const beauty = shop.vocab.services;
  const now = useNow();
  const stream = useStream<View>(`/api/queue/${queueId}/stream`, { pollMs: 5_000 });
  const [view, setView] = useState<View | undefined>();
  const [busy, setBusy] = useState<string | null>(null); // which action is in flight
  const nextLock = useRef(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Ticket | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [sound, setSound] = useState(() => store.get("mfy.queue.sound") !== "off");

  // Whatever the server said last wins — the stream or an action's answer.
  useEffect(() => { if (stream.data) setView(stream.data); }, [stream.data]);
  // The first view, without waiting for the stream's handshake.
  useEffect(() => { get<View>(`/api/queue/${queueId}`).then((v) => setView((cur) => cur ?? v)).catch(() => {}); }, [queueId]);

  // A soft chime when someone new joins from their phone (not our own walk-ins).
  const seen = useRef<Set<number> | null>(null);
  const ours = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!view) return;
    const ids = view.waiting.map((t) => t.id);
    if (seen.current) {
      const fresh = view.waiting.filter((t) => !seen.current!.has(t.id) && !ours.current.has(t.id) && t.source !== "staff" && t.status === "waiting");
      if (fresh.length && sound) chime("join");
      if (fresh.length) toast(`انضم ${fresh.map((t) => `${t.displayCode}${t.customerName ? ` · ${t.customerName}` : ""}`).join("، ")}`, { duration: 2500 });
    }
    seen.current = new Set([...(seen.current ?? []), ...ids, ...view.called.map((t) => t.id), ...view.serving.map((t) => t.id)]);
  }, [view, sound]);

  const apply = (v: View | undefined) => { if (v) setView(v); };

  const run = useCallback(async <T,>(tag: string, fn: () => Promise<T>, ok?: (r: T) => void) => {
    setBusy(tag);
    try { const r = await fn(); ok?.(r); return r; }
    catch (e) { toast.error(errText(e)); stream.refresh(); return null; }
    finally { setBusy(null); }
  }, [stream]);

  // «التالي»: move the first waiting person to "called" on screen at once,
  // then take the server's view. The ref lock stops a double tap from
  // calling two people; the server's SKIP LOCKED handles two tablets.
  const next = useCallback(async () => {
    if (!view || nextLock.current) return;
    if (!view.waiting.length) { toast("لا أحد في الانتظار"); return; }
    nextLock.current = true;
    const first = view.waiting[0]!;
    const optimistic: Ticket = { ...first, status: "called", calledAt: new Date().toISOString(), sinceCalledMin: 0, late: false };
    setView({ ...view, waiting: view.waiting.slice(1), called: [optimistic, ...view.called],
      counts: { ...view.counts, waiting: view.counts.waiting - 1, called: view.counts.called + 1 } });
    setFocusId(null);
    try { navigator.vibrate?.(25); } catch { /* ignore */ }
    await run("next", () => post<{ called: Ticket | null; view: View }>(`/api/queue/${queueId}/next`), (r) => {
      apply(r.view);
      if (!r.called) toast("لا أحد في الانتظار");
    });
    // A short breath before the button takes another press.
    setTimeout(() => { nextLock.current = false; }, 600);
  }, [view, queueId, run]);

  const act = (t: Ticket, a: Action, body: Record<string, unknown> = {}) =>
    run(`${a}:${t.id}`, () => post<{ ticket: Ticket; view: View }>(`/api/queue/${queueId}/tickets/${t.id}/${a}`, body), (r) => apply(r.view));

  const callThis = (t: Ticket) =>
    run(`call:${t.id}`, () => post<{ called: Ticket; view: View }>(`/api/queue/${queueId}/call/${t.id}`), (r) => { apply(r.view); setFocusId(t.id); setPicked(null); });

  const state = (change: "open" | "close" | "pause" | "resume") =>
    run(`state:${change}`, () => post<View>(`/api/queue/${queueId}/state`, { change }), apply);

  const eta = (body: { delta?: number; reset?: boolean }) =>
    run("eta", () => post<View>(`/api/queue/${queueId}/eta`, body), apply);

  // Space or Enter calls the next person when a keyboard is attached and
  // nothing else has focus — the counter PC case.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && el !== document.body) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); void next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  if (!view) return <div className="h-full grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const q = view.queue;
  const focus = view.called.find((t) => t.id === focusId) ?? view.called[0] ?? null;
  const otherCalled = view.called.filter((t) => t.id !== focus?.id);
  const upNext = view.waiting[0];

  return (
    <div className="h-full flex flex-col">
      {/* ── Top: queue, state, numbers ── */}
      <div className="shrink-0 border-b border-border px-3 pt-3 pb-2.5 space-y-2.5 bg-background">
        <div className="flex flex-wrap items-center gap-2">
          {queues.length > 1 ? (
            <div className="flex rounded-xl bg-secondary p-1 gap-1 overflow-x-auto">
              {queues.map((x) => (
                <button key={x.id} onClick={() => onPick(x.id)}
                  className={cn("px-3 h-9 rounded-lg text-sm whitespace-nowrap", x.id === q.id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground")}>
                  {x.name}
                </button>
              ))}
            </div>
          ) : <h1 className="font-bold text-base">{q.name}</h1>}
          <StatePill q={q} live={stream.live} />
          <div className="flex-1" />
          <Btn tone="ghost" className="min-h-10 px-2.5" title={sound ? "كتم صوت الانضمام" : "تشغيل صوت الانضمام"}
            onClick={() => { const v = !sound; setSound(v); store.set("mfy.queue.sound", v ? "on" : "off"); if (v) chime("join"); }}>
            {sound ? <Volume2 className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </Btn>
          {q.isOpen && (q.isPaused
            ? <Btn className="min-h-10" onClick={() => state("resume")} disabled={!!busy}><Play className="w-4 h-4" />استئناف</Btn>
            : <Btn className="min-h-10" onClick={() => state("pause")} disabled={!!busy} title="يوقف الانضمام الجديد مؤقتاً، والمنتظرون يبقون"><Pause className="w-4 h-4" />إيقاف مؤقت</Btn>)}
          {q.isOpen
            ? <Btn className="min-h-10" onClick={() => { if (confirm("إغلاق الصف؟ لن يستطيع أحد الانضمام، والمنتظرون يبقون في دورهم.")) void state("close"); }} disabled={!!busy}><Lock className="w-4 h-4" />إغلاق</Btn>
            : <Btn tone="ok" className="min-h-10" onClick={() => state("open")} disabled={!!busy}><LockOpen className="w-4 h-4" />فتح الصف</Btn>}
          <Btn tone="gold" className="min-h-10" onClick={() => setWalkIn(true)}><UserPlus className="w-4 h-4" />إضافة زبون</Btn>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.6fr)] gap-2">
          <Stat label="في الانتظار" value={view.counts.waiting} tone="gold" />
          <Stat label="خُدم اليوم" value={view.counts.served} />
          <Stat label="لم يحضروا" value={view.counts.noShows} tone={view.counts.noShows ? "warn" : undefined} />
          <Stat label="متوسط الانتظار" value={view.avgWaitToday === null ? "—" : `${view.avgWaitToday} د`} />
          <div className="col-span-2 sm:col-span-4 lg:col-span-1 rounded-xl border border-card-border bg-card px-3 py-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted-foreground">لمن ينضم الآن</div>
              <div className="font-bold text-primary leading-tight truncate"><Eta r={view.nextEta} /></div>
              <div className="text-[10px] text-muted-foreground truncate">
                {q.etaAdjustMin ? `مع تعديلك ${q.etaAdjustMin > 0 ? "+" : ""}${q.etaAdjustMin} د · ` : ""}
                {view.interval.samples >= 3 ? `~${n(view.interval.minutes, 1)} د بين كل نداء` : "على تقديرك حتى تتجمع بيانات اليوم"}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button className="w-10 h-10 rounded-lg bg-secondary grid place-items-center hover:bg-secondary/70 disabled:opacity-40" disabled={busy === "eta"} onClick={() => eta({ delta: -5 })} aria-label="أنقص 5 دقائق"><Minus className="w-4 h-4" /></button>
              <button className="w-10 h-10 rounded-lg bg-secondary grid place-items-center hover:bg-secondary/70 disabled:opacity-40" disabled={busy === "eta"} onClick={() => eta({ delta: 5 })} aria-label="زِد 5 دقائق"><Plus className="w-4 h-4" /></button>
              {q.etaAdjustMin !== 0 && <button className="w-10 h-10 rounded-lg text-muted-foreground grid place-items-center hover:bg-secondary/70" disabled={busy === "eta"} onClick={() => eta({ reset: true })} aria-label="إلغاء التعديل" title="رجوع للحساب التلقائي"><RotateCcw className="w-4 h-4" /></button>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Middle: the called person, then the line ── */}
      <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="md:overflow-y-auto p-3 space-y-3 md:border-e border-border">
          {focus ? (
            <FocusCard t={focus} now={now} beauty={beauty} busy={busy} onAct={act} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
              <Megaphone className="w-9 h-9 mx-auto text-primary/50 mb-2" />
              {view.waiting.length
                ? <><div className="text-foreground font-semibold">جاهز للنداء</div><div className="text-sm mt-1">اضغط «التالي» لنداء {upNext?.displayCode}{upNext?.customerName ? ` · ${upNext.customerName}` : ""}</div></>
                : <><div className="text-foreground font-semibold">لا أحد في الانتظار</div><div className="text-sm mt-1">{q.isOpen ? "الزبائن ينضمون من الـ QR أو رابط المنيو، أو أضف زبوناً حاضراً بزر «إضافة زبون»." : "الصف مغلق — افتحه ليبدأ الانضمام."}</div></>}
            </div>
          )}

          {otherCalled.length > 0 && (
            <div>
              <SectionTitle icon={<Bell className="w-4 h-4" />} label="نودي عليهم" count={otherCalled.length} />
              <div className="space-y-1.5">
                {otherCalled.map((t) => (
                  <button key={t.id} onClick={() => setFocusId(t.id)}
                    className={cn("w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-start bg-card hover:bg-secondary/50",
                      t.late ? "border-amber-500/40" : "border-card-border")}>
                    <span className="font-bold tabular-nums text-lg w-14 shrink-0">{t.displayCode}</span>
                    <span className="flex-1 min-w-0 truncate">{t.customerName || "بدون اسم"}</span>
                    <WaDot on={t.phoneVerified} />
                    <span className={cn("text-xs tabular-nums", t.late ? "text-amber-400" : "text-muted-foreground")}>{ago(minsSince(t.calledAt, now))}{t.late ? " · متأخر" : ""}</span>
                    <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {view.serving.length > 0 && (
            <div>
              <SectionTitle icon={<Sparkles className="w-4 h-4" />} label={beauty ? "قيد الخدمة" : "حضروا"} count={view.serving.length} />
              <div className="space-y-1.5">
                {view.serving.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl border border-card-border bg-card px-3 py-2">
                    <span className="font-bold tabular-nums text-lg w-14 shrink-0">{t.displayCode}</span>
                    <span className="flex-1 min-w-0 truncate">{t.customerName || "بدون اسم"}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{ago(minsSince(t.servingAt, now))}</span>
                    <Btn tone="ok" className="min-h-10 px-3" disabled={busy === `done:${t.id}`} onClick={() => act(t, "done")}><Check className="w-4 h-4" />انتهى</Btn>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="md:overflow-y-auto p-3">
          <SectionTitle icon={<Users className="w-4 h-4" />} label="في الانتظار" count={view.waiting.length} />
          {view.waiting.length === 0 ? (
            <Empty title="الصف فاضي" icon={<ListOrdered />} className="py-8">
              أول ما ينضم أحد يظهر هنا {sound ? "مع صوت تنبيه" : ""}.
            </Empty>
          ) : (
            <ol className="space-y-1.5">
              {view.waiting.map((t, i) => {
                const waited = minsSince(t.joinedAt, now) ?? t.waitedMin;
                return (
                  <li key={t.id}>
                    <button onClick={() => setPicked(t)}
                      className={cn("w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-start bg-card hover:bg-secondary/50 transition",
                        i === 0 ? "border-primary/40" : "border-card-border")}>
                      <span className={cn("font-bold tabular-nums text-lg w-14 shrink-0", i === 0 && "text-primary")}>{t.displayCode}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{t.customerName || "بدون اسم"}</span>
                          <WaDot on={t.phoneVerified} />
                          {t.priority > 0 && <span className="text-[10px] rounded-full bg-primary/15 text-primary px-1.5 py-0.5 shrink-0">{t.source === "booking" ? "حجز" : "أولوية"}</span>}
                          {t.source === "staff" && <span className="text-[10px] rounded-full bg-secondary text-muted-foreground px-1.5 py-0.5 shrink-0">حاضر</span>}
                        </span>
                        {t.note && <span className="block text-xs text-muted-foreground truncate mt-0.5">{t.note}</span>}
                      </span>
                      {!beauty && <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums shrink-0"><Users className="w-3.5 h-3.5" />{t.partySize}</span>}
                      <span className={cn("text-xs tabular-nums shrink-0 w-12 text-left", waited >= 30 ? "text-amber-400" : "text-muted-foreground")}>
                        <Clock className="w-3 h-3 inline -mt-0.5 me-0.5" />{waited} د
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* ── Bottom: «التالي», where the thumb is ── */}
      <div className="shrink-0 border-t border-border bg-sidebar px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <div className="hidden sm:block min-w-0 w-40 text-xs text-muted-foreground leading-snug">
            {upNext ? <>التالي في الدور<div className="text-foreground text-sm font-semibold truncate">{upNext.displayCode} · {upNext.customerName || "بدون اسم"}</div></> : "لا أحد ينتظر"}
          </div>
          <button onClick={next} disabled={busy === "next" || view.waiting.length === 0}
            className="flex-1 h-16 rounded-2xl bg-primary text-primary-foreground text-2xl font-extrabold flex items-center justify-center gap-3 shadow-lg shadow-primary/20 active:scale-[0.985] transition disabled:opacity-40 select-none touch-manipulation">
            {busy === "next" ? <Loader2 className="w-6 h-6 animate-spin" /> : <Megaphone className="w-6 h-6" />}
            التالي
            {upNext && <span className="sm:hidden text-base font-semibold opacity-80 tabular-nums">{upNext.displayCode}</span>}
          </button>
        </div>
      </div>

      <TicketDialog t={picked} busy={busy} beauty={beauty} onClose={() => setPicked(null)} onCall={callThis}
        onRemove={async (t) => { await act(t, "remove"); setPicked(null); }} />
      <WalkInDialog open={walkIn} onOpenChange={setWalkIn} queue={q} beauty={beauty}
        onDone={(r) => { ours.current.add(r.ticket.id); apply(r.view); }} queueId={queueId} />
    </div>
  );
}

function StatePill({ q, live }: { q: QueueRow; live: boolean }) {
  const [label, cls] = !q.isOpen ? ["مغلق", "bg-red-500/15 text-red-300"] : q.isPaused ? ["متوقف مؤقتاً", "bg-amber-500/15 text-amber-300"] : ["مفتوح", "bg-emerald-500/15 text-emerald-300"];
  return (
    <span className="flex items-center gap-2">
      <span className={cn("text-xs rounded-full px-2.5 py-1 font-medium", cls)}>{label}</span>
      <span title={live ? "متصل مباشرة" : "تحديث كل بضع ثوانٍ"} className={cn("w-2 h-2 rounded-full", live ? "bg-emerald-400" : "bg-muted-foreground/50")} />
    </span>
  );
}

function SectionTitle({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2 px-1">
      {icon}<span className="font-semibold text-foreground/90">{label}</span>
      <span className="text-xs rounded-full bg-secondary px-2 py-0.5 tabular-nums">{count}</span>
    </div>
  );
}

// ── The person just called ────────────────────────────────────────

function FocusCard({ t, now, beauty, busy, onAct }: { t: Ticket; now: number; beauty: boolean; busy: string | null; onAct: (t: Ticket, a: Action, body?: Record<string, unknown>) => unknown }) {
  const since = minsSince(t.calledAt, now) ?? 0;
  const b = (a: string) => busy === `${a}:${t.id}`;
  return (
    <div className={cn("rounded-2xl border p-4 sm:p-5 bg-card relative overflow-hidden", t.late ? "border-amber-500/50" : "border-primary/35")}>
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary/0 via-primary/70 to-primary/0" />
      <div className="flex items-start gap-4">
        <div className="text-6xl sm:text-7xl font-black tabular-nums tracking-tight text-primary leading-none" dir="ltr">{t.displayCode}</div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold truncate">{t.customerName || "بدون اسم"}</div>
            <WaDot on={t.phoneVerified} className="w-5 h-5" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-sm text-muted-foreground">
            {!beauty && <span className="flex items-center gap-1"><Users className="w-4 h-4" />{t.partySize} {t.partySize === 1 ? "شخص" : "أشخاص"}</span>}
            <span className={cn("flex items-center gap-1 tabular-nums", t.late && "text-amber-400 font-semibold")}><Bell className="w-4 h-4" />نودي {since < 1 ? "الآن" : `منذ ${since} د`}</span>
            {t.recallCount > 0 && <span>{t.recallCount === 1 ? "نودي مرتين" : `نودي ${t.recallCount + 1} مرات`}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {t.late && <span className="text-xs rounded-full bg-amber-500/15 text-amber-300 px-2 py-0.5 animate-pulse">تأخّر عن الحضور</span>}
            {t.onMyWay && <span className="text-xs rounded-full bg-sky-500/15 text-sky-300 px-2 py-0.5 flex items-center gap-1"><Footprints className="w-3 h-3" />قال إنه في الطريق</span>}
            {t.source === "booking" && <span className="text-xs rounded-full bg-primary/15 text-primary px-2 py-0.5 flex items-center gap-1"><CalendarCheck className="w-3 h-3" />حجز</span>}
            {!t.phoneVerified && <span className="text-xs rounded-full bg-secondary text-muted-foreground px-2 py-0.5">بدون واتساب — نادِه بالصوت</span>}
          </div>
          {t.note && <div className="mt-2 text-sm bg-secondary/60 rounded-lg px-2.5 py-1.5">{t.note}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4">
        <Btn tone="ok" className="min-h-14 text-base col-span-2 sm:col-span-1" disabled={b("arrived")}
          onClick={() => onAct(t, "arrived", beauty ? {} : { finish: true })}>
          {b("arrived") ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}{beauty ? "حضرت — ابدأ الخدمة" : "حضر"}
        </Btn>
        <Btn className="min-h-14 text-base col-span-2 sm:col-span-1" disabled={b("recall") || t.recallCount >= 2}
          title={t.recallCount >= 2 ? "تم النداء مرتين" : undefined} onClick={() => onAct(t, "recall")}>
          <Megaphone className="w-5 h-5" />نداء مرة أخرى{t.recallCount > 0 ? ` (${2 - t.recallCount})` : ""}
        </Btn>
        <Btn tone="danger" className="min-h-12" disabled={b("no-show")} onClick={() => onAct(t, "no-show")}><UserX className="w-4 h-4" />لم يحضر</Btn>
        <Btn className="min-h-12" disabled={b("requeue")} onClick={() => onAct(t, "requeue")}><Undo2 className="w-4 h-4" />أرجعه للصف</Btn>
      </div>
    </div>
  );
}

// ── Someone in the line ───────────────────────────────────────────

function TicketDialog({ t, busy, beauty, onClose, onCall, onRemove }: {
  t: Ticket | null; busy: string | null; beauty: boolean; onClose: () => void;
  onCall: (t: Ticket) => unknown; onRemove: (t: Ticket) => unknown;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setConfirmRemove(false), [t?.id]);
  return (
    <Modal open={!!t} onOpenChange={(v) => !v && onClose()} title={t ? `${t.displayCode} · ${t.customerName || "بدون اسم"}` : ""}
      description={t ? `${t.ahead === 0 ? "الأول في الدور" : `قدامه ${t.ahead}`} · ينتظر منذ ${t.waitedMin} د · ${formatEta(t.eta).replace(/(\d+)–(\d+)/, "\u2066$1–$2\u2069")}` : undefined}>
      {t && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {!beauty && <span className="rounded-lg bg-secondary px-2.5 py-1 flex items-center gap-1"><Users className="w-4 h-4" />{t.partySize}</span>}
            {t.phone && <span className="rounded-lg bg-secondary px-2.5 py-1 flex items-center gap-1.5" dir="ltr"><Phone className="w-3.5 h-3.5" />{t.phone}<WaDot on={t.phoneVerified} /></span>}
            {!t.phone && <span className="rounded-lg bg-secondary px-2.5 py-1 text-muted-foreground">بدون رقم</span>}
          </div>
          {t.note && <div className="text-sm bg-secondary/60 rounded-lg px-3 py-2">{t.note}</div>}
          <Btn tone="gold" className="w-full min-h-14 text-base" disabled={busy === `call:${t.id}`} onClick={() => onCall(t)}>
            {busy === `call:${t.id}` ? <Loader2 className="w-5 h-5 animate-spin" /> : <Megaphone className="w-5 h-5" />}نادِه الآن (قبل دوره)
          </Btn>
          {confirmRemove ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 space-y-2">
              <div className="text-sm">حذف {t.displayCode} من الصف؟ لن يصله إشعار بدوره.</div>
              <div className="flex gap-2">
                <Btn tone="danger" className="flex-1" disabled={busy === `remove:${t.id}`} onClick={() => onRemove(t)}><Trash2 className="w-4 h-4" />نعم، احذفه</Btn>
                <Btn className="flex-1" onClick={() => setConfirmRemove(false)}>تراجع</Btn>
              </div>
            </div>
          ) : (
            <Btn tone="danger" className="w-full" onClick={() => setConfirmRemove(true)}><Trash2 className="w-4 h-4" />احذفه من الصف</Btn>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Walk-in ───────────────────────────────────────────────────────

function WalkInDialog({ open, onOpenChange, queue, queueId, beauty, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; queue: QueueRow; queueId: number; beauty: boolean;
  onDone: (r: { ticket: Ticket; view: View }) => void;
}) {
  const [name, setName] = useState("");
  const [party, setParty] = useState(2);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setParty(beauty ? 1 : 2); setPhone(""); setNote(""); } }, [open, beauty]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ ticket: Ticket; view: View }>(`/api/queue/${queueId}/walk-in`, {
        name: name.trim(), partySize: party, phone: phone.trim() || undefined, note: note.trim() || undefined,
      });
      onDone(r);
      toast.success(`تمت الإضافة — رقمه ${r.ticket.displayCode}`, { description: phone.trim() ? "يصله إشعار واتساب لو سبق وراسلنا" : undefined });
      onOpenChange(false);
    } catch (err) { toast.error(errText(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="إضافة زبون حاضر" description="لمن وصل المحل بدون جوال أو طلب منك تسجيله.">
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label className={labelCls}>الاسم</label>
          <input className={cn(inputCls, "text-base py-3")} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: أبو خالد" autoFocus maxLength={60} />
        </div>
        {!beauty && queue.askPartySize !== false && (
          <div>
            <label className={labelCls}>عدد الأشخاص</label>
            <div className="flex items-center gap-2">
              <button type="button" className="w-12 h-12 rounded-xl bg-secondary grid place-items-center" onClick={() => setParty((p) => Math.max(1, p - 1))} aria-label="أقل"><Minus className="w-4 h-4" /></button>
              <div className="w-14 text-center text-2xl font-bold tabular-nums">{party}</div>
              <button type="button" className="w-12 h-12 rounded-xl bg-secondary grid place-items-center" onClick={() => setParty((p) => Math.min(30, p + 1))} aria-label="أكثر"><Plus className="w-4 h-4" /></button>
              <div className="flex gap-1 ms-2">
                {[1, 2, 4, 6].map((k) => <button type="button" key={k} onClick={() => setParty(k)} className={cn("w-10 h-10 rounded-lg text-sm", party === k ? "bg-primary text-primary-foreground" : "bg-secondary")}>{k}</button>)}
              </div>
            </div>
          </div>
        )}
        <div>
          <label className={labelCls}>رقم الواتساب (اختياري)</label>
          <input className={cn(inputCls, "text-base py-3")} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05x xxx xxxx" />
        </div>
        <div>
          <label className={labelCls}>ملاحظة (اختياري)</label>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="طاولة خارجية، كرسي أطفال…" maxLength={120} />
        </div>
        <Btn tone="gold" type="submit" className="w-full min-h-12 text-base" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}أضفه للصف
        </Btn>
      </form>
    </Modal>
  );
}
