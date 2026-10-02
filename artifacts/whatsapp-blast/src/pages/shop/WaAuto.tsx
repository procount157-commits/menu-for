// ── /wa-auto — WhatsApp as the shop runs it, in one place ─────────
// What goes out by itself (order, booking and queue messages, the weekly
// campaign), whether it arrived and was opened, what is protecting the
// number right now, and who a campaign can reach. The owner decides here;
// the sending is Flow Hub's engine underneath.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  AlertTriangle, BellRing, Bot, CalendarClock, Check, CheckCheck, Eye, Loader2, Megaphone, Plus, Repeat, Send, ShieldCheck,
  Sparkles, Trash2, Users, Wifi, WifiOff, X, Zap, PauseCircle, Gauge,
} from "lucide-react";
import { get, patch, post, useShop, inputCls, labelCls } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, Stat, clock, errText, isPlanError, n, shortDate } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface Funnel { kind: string; sent: number; delivered: number; read: number; skipped: number; failed: number }
interface Autopilot {
  enabled: boolean; weekday: number; hour: number; audience: string; mode: "approval" | "auto"; source: "agent" | "fixed";
  fixedMessage: string | null; instructions: string | null; maxRecipients: number; restDays: number; lastRunAt: string | null;
}
interface Run {
  id: number; status: "awaiting_approval" | "started" | "skipped" | "rejected" | "failed"; campaignId: number | null; audience: string | null;
  recipients: number; message: string | null; writtenBy: string | null; note: string | null; createdAt: string;
  campaign: { status: string; sent: number; delivered: number; read: number; failed: number; total: number } | null;
}
interface Overview {
  whatsapp: { connected: boolean; status: string; phone: string | null; numberAgeDays: number };
  plan: { name: string; notify: boolean; marketing: boolean };
  protection: {
    risk: { score: number; level: string; levelAr: string; reasons: string[] } | null;
    throttle: number; dailyCeiling: number | null; holdUntil: string | null; holdReason: string | null;
    campaigns: { sentToday: number; dailyLimit: number };
    lanes: { replied: { sentToday: number; cap: number }; consented: { sentToday: number; cap: number }; staff: { sentToday: number } };
  };
  notifications: { funnel: Funnel[]; skippedReasons: Array<{ reason: string | null; n: number }> };
  campaigns30d: { campaigns: number; sent: number; delivered: number; read: number };
  alerts: { phones: string[] };
  agent: { autoReply: boolean; model: string | null; knowledgeEntries: number };
  autopilot: Autopilot;
  runs: Run[];
  segments: Array<{ key: string; label: string; count: number }>;
  retargets: Array<{ key: string; label: string }>;
}
interface Camp { id: number; name: string; status: string; createdAt: string; sent: number; delivered: number; read: number; total: number }

const KEY = ["/api/wa-auto"];
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const KIND: Record<string, string> = {
  queue_joined: "تأكيد الدور", queue_near: "اقترب دورك", queue_called: "حان دورك", queue_no_show: "فات الدور", status_reply: "رد «وين دوري»",
  order_received: "تأكيد الطلب", order_accepted: "قبول الطلب", order_ready: "الطلب جاهز", order_out: "الطلب في الطريق", order_cancelled: "إلغاء الطلب",
  booking_received: "استلام الحجز", booking_confirmed: "تأكيد الحجز", booking_reminder: "تذكير الحجز", booking_cancelled: "إلغاء الحجز",
  review_request: "طلب التقييم", winback: "اشتقنا لك",
  alert_order: "تنبيه المحل: طلب", alert_booking: "تنبيه المحل: حجز", alert_rating: "تنبيه المحل: تقييم", alert_campaign: "تنبيه المحل: حملة",
};
const REASON: Record<string, string> = {
  no_thread: "الزبون لم يراسلنا ولم يكتب رقمه", expired: "انتهت صلاحيتها", wa_disconnected: "واتساب غير متصل", opted_out: "الزبون طلب عدم المراسلة",
  daily_cap: "حد اليوم", plan: "غير متاح في الخطة", superseded: "حلّت محلها رسالة أحدث", ops_hold: "إيقاف مؤقت لحماية الرقم",
};
const RUN_STATUS: Record<Run["status"], { label: string; cls: string }> = {
  awaiting_approval: { label: "بانتظار موافقتك", cls: "bg-amber-500/15 text-amber-300" },
  started: { label: "أُرسلت", cls: "bg-emerald-500/15 text-emerald-300" },
  skipped: { label: "لم تُجهَّز", cls: "bg-secondary text-muted-foreground" },
  rejected: { label: "رفضتها", cls: "bg-secondary text-muted-foreground" },
  failed: { label: "فشلت", cls: "bg-red-500/15 text-red-300" },
};
const WRITER: Record<string, string> = { agent: "كتبها الوكيل", owner: "نصّك أنت", template: "نص جاهز من عروضك" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

type Tab = "overview" | "weekly" | "audience";

export default function WaAuto() {
  const shop = useShop();
  const [tab, setTab] = useState<Tab>("overview");
  const q = useQuery<Overview>({ queryKey: KEY, queryFn: () => get("/api/wa-auto"), refetchInterval: 30_000 });

  if (shop.role !== "owner") return <Empty title="هذه الصفحة لصاحب المحل" icon={<ShieldCheck />} className="py-24" />;
  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <Empty title="تعذّر التحميل" icon={<AlertTriangle />} className="py-24">{errText(q.error)}</Empty>;
  const d = q.data;
  const waiting = d.runs.filter((r) => r.status === "awaiting_approval").length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold flex items-center gap-2"><Zap className="w-5 h-5 text-primary" />واتساب الآلي</h1>
          <p className="text-sm text-muted-foreground mt-0.5">ما يرسله رقم المحل بنفسه، هل وصل وفُتح، وما الذي يحمي الرقم الآن.</p>
        </div>
        <div className="flex rounded-xl bg-secondary p-1 gap-1">
          {([["overview", "الحالة والحماية"], ["weekly", "الحملة الأسبوعية"], ["audience", "الشرائح وإعادة الاستهداف"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("px-3 md:px-4 h-9 rounded-lg text-sm flex items-center gap-1.5", tab === k ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}>
              {l}{k === "weekly" && waiting > 0 && <span className="w-5 h-5 rounded-full bg-amber-400 text-black text-[11px] font-bold grid place-items-center">{waiting}</span>}
            </button>
          ))}
        </div>
      </div>

      {!d.whatsapp.connected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <WifiOff className="w-4 h-4 text-amber-300" />
          <span className="flex-1">رقم المحل غير مربوط — لا شيء يُرسل حتى تمسح رمز QR من جوال المحل.</span>
          <Link href="/connect" className="text-primary font-semibold underline underline-offset-4">اربط الواتساب</Link>
        </div>
      )}
      {d.whatsapp.connected && d.protection.holdUntil && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm flex items-start gap-2">
          <PauseCircle className="w-4 h-4 text-red-300 mt-0.5" />
          <span>الإرسال التسويقي موقوف مؤقتاً حتى {clock(d.protection.holdUntil, shop.org.timezone)} لحماية الرقم{d.protection.holdReason ? ` — ${d.protection.holdReason}` : ""}. ردودنا على من راسلنا مستمرة.</span>
        </div>
      )}

      {tab === "overview" && <OverviewTab d={d} />}
      {tab === "weekly" && <WeeklyTab d={d} />}
      {tab === "audience" && <AudienceTab d={d} />}
    </div>
  );
}

function Card({ title, icon, children, aside }: { title: string; icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3 min-w-0">
      <header className="flex items-center gap-2">
        <span className="text-primary [&_svg]:w-5 [&_svg]:h-5">{icon}</span>
        <h2 className="font-bold flex-1">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

// ── Status, what went out, and the protection in force ────────────

function OverviewTab({ d }: { d: Overview }) {
  const qc = useQueryClient();
  const f = d.notifications.funnel;
  const tot = f.reduce((a, r) => ({ sent: a.sent + r.sent, delivered: a.delivered + r.delivered, read: a.read + r.read, skipped: a.skipped + r.skipped, failed: a.failed + r.failed }), { sent: 0, delivered: 0, read: 0, skipped: 0, failed: 0 });
  const risk = d.protection.risk;
  const p = d.protection;

  const [auto, setAuto] = useState(d.agent.autoReply);
  useEffect(() => setAuto(d.agent.autoReply), [d.agent.autoReply]);
  const toggleAuto = async (v: boolean) => {
    setAuto(v);
    try { await patch("/api/wa-auto/auto-reply", { enabled: v }); toast.success(v ? "الوكيل يرد على الزبائن" : "أُوقف الرد الآلي"); qc.invalidateQueries({ queryKey: KEY }); }
    catch (e) { setAuto(!v); toast.error(errText(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="رقم المحل" tone={d.whatsapp.connected ? "ok" : "warn"}
          value={<span className="flex items-center gap-1.5 text-base">{d.whatsapp.connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}{d.whatsapp.connected ? "متصل" : "غير متصل"}</span>}
          hint={d.whatsapp.phone ? <span dir="ltr">+{d.whatsapp.phone}</span> : "امسح QR من «ربط الواتساب»"} />
        <Stat label="مستوى الخطر على الرقم" value={risk ? <span className="text-base">{risk.levelAr} <span className="text-muted-foreground text-sm">({risk.score}/100)</span></span> : "—"}
          tone={!risk ? undefined : risk.score >= 50 ? "warn" : "ok"} hint={d.whatsapp.numberAgeDays ? `الرقم مرتبط منذ ${n(d.whatsapp.numberAgeDays, 0)} يوم` : undefined} />
        <Stat label="رسائل آلية هذا الأسبوع" value={n(tot.sent)} hint={`وصل ${pct(tot.delivered, tot.sent)} · فُتح ${pct(tot.read, tot.sent)}`} tone="gold" />
        <Stat label="حملات اليوم" value={<span>{n(p.campaigns.sentToday)}<span className="text-sm text-muted-foreground"> / {n(p.campaigns.dailyLimit)}</span></span>} hint="حد اليوم يكبر مع عمر الرقم" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
        <Card title="ما وصل الزبائن تلقائياً — آخر 7 أيام" icon={<Send />} aside={<Link href="/messages" className="text-xs text-primary underline underline-offset-4">عدّل نصوص الرسائل</Link>}>
          {f.length === 0 ? (
            <Empty title="لا رسائل بعد" icon={<Send />}>أول ما يكتب زبون رقمه مع طلب أو حجز أو دور، تصله رسالته فوراً وتظهر هنا مع «وصلت» و«فُتحت».</Empty>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium [&>th]:text-start">
                    <th>الرسالة</th><th>أُرسلت</th><th><span className="inline-flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5" />وصلت</span></th>
                    <th><span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" />فُتحت</span></th><th>لم تُرسل</th>
                  </tr>
                </thead>
                <tbody>
                  {[...f].sort((a, b) => b.sent - a.sent).map((r) => (
                    <tr key={r.kind} className="border-t border-border/60 [&>td]:px-2 [&>td]:py-2 tabular-nums">
                      <td className="font-medium">{KIND[r.kind] ?? r.kind}</td>
                      <td>{n(r.sent)}</td>
                      <td>{n(r.delivered)} <span className="text-xs text-muted-foreground">{pct(r.delivered, r.sent)}</span></td>
                      <td className="text-sky-300">{n(r.read)} <span className="text-xs text-muted-foreground">{pct(r.read, r.sent)}</span></td>
                      <td className="text-muted-foreground">{n(r.skipped + r.failed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.notifications.skippedReasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground">سبب عدم الإرسال:</span>
              {d.notifications.skippedReasons.map((s) => <span key={s.reason ?? "x"} className="text-xs rounded-full bg-secondary px-2.5 py-1">{REASON[s.reason ?? ""] ?? s.reason ?? "—"} <span className="tabular-nums text-muted-foreground">{s.n}</span></span>)}
            </div>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">«فُتحت» تظهر فقط لمن لم يوقف إشعار القراءة في واتسابه — فالرقم الحقيقي أعلى قليلاً.</p>
        </Card>

        <Card title="طبقات الحماية من الحظر" icon={<ShieldCheck />} aside={<Link href="/ops" className="text-xs text-primary underline underline-offset-4">غرفة العمليات</Link>}>
          <ul className="space-y-2.5 text-sm">
            <Layer on title="لا نراسل غريباً" text="الرسائل الآلية تصل فقط من كتب رقمه بنفسه أو راسلنا أولاً، والحملات فقط لمن وافق على العروض." />
            <Layer on title="إيقاع بشري" text={`فواصل عشوائية بين الرسائل${p.throttle > 1 ? ` — مُبطّأة الآن ×${p.throttle}` : ""}، ومؤشر «يكتب…» قبل الإرسال.`} warn={p.throttle > 1} />
            <Layer on title="حد يومي يكبر مع الرقم" text={`اليوم: ${n(p.campaigns.sentToday)} من ${n(p.campaigns.dailyLimit)} للحملات${p.dailyCeiling ? ` · سقف مسؤول التشغيل ${n(p.dailyCeiling)}` : ""}.`} />
            <Layer on title="مسارات منفصلة" text={`ردود على من راسلنا ${n(p.lanes.replied.sentToday)}/${n(p.lanes.replied.cap)} · لمن كتب رقمه ${n(p.lanes.consented.sentToday)}/${n(p.lanes.consented.cap)} · تنبيهات المحل ${n(p.lanes.staff.sentToday)}.`} />
            <Layer on title="مراقب التسليم" text="لو هبطت نسبة الوصول أو كثر الإلغاء، تتوقف الحملة لوحدها ويصلك تنبيه." />
            <Layer on title="«توقف» تُحترم فوراً" text="من يرسل «توقف» لا تصله عروض بعدها، في الحملات والرسائل الآلية." />
          </ul>
          {risk && risk.reasons.length > 0 && (
            <div className="rounded-lg bg-secondary/50 p-3 text-xs space-y-1 leading-relaxed">
              <div className="font-semibold text-foreground flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />ما يراه المراقب الآن</div>
              {risk.reasons.slice(0, 4).map((r, i) => <div key={i} className="text-muted-foreground">• {r}</div>)}
            </div>
          )}
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <AlertPhones phones={d.alerts.phones} />
        <Card title="الوكيل الذي يرد على الزبائن" icon={<Bot />} aside={<Switch checked={auto} onCheckedChange={toggleAuto} dir="ltr" />}>
          <p className="text-sm text-muted-foreground leading-relaxed">
            يرد على أسئلة الزبائن في واتساب من المنيو والأسعار وساعات العمل، ويرسل رابط المنيو أو الحجز. ما لا يعرفه يحوّله لك ولا يخترع جواباً.
          </p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-secondary px-2.5 py-1">المعرفة: {n(d.agent.knowledgeEntries)} معلومة</span>
            <span className={cn("rounded-full px-2.5 py-1", d.agent.model ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>{d.agent.model ? `النموذج: ${d.agent.model}` : "لا يوجد مفتاح نموذج — الردود الآلية متوقفة"}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/knowledge" className="text-primary underline underline-offset-4">معرفة البوت</Link>
            <Link href="/conversations" className="text-primary underline underline-offset-4">المحادثات</Link>
            <Link href="/follow-ups" className="text-primary underline underline-offset-4">المتابعات</Link>
            <Link href="/employees" className="text-primary underline underline-offset-4">فريق الوكلاء</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Layer({ title, text, warn }: { on?: boolean; title: string; text: string; warn?: boolean }) {
  return (
    <li className="flex gap-2.5">
      <span className={cn("w-5 h-5 rounded-full grid place-items-center shrink-0 mt-0.5", warn ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/15 text-emerald-300")}><Check className="w-3 h-3" /></span>
      <div className="min-w-0"><div className="font-semibold">{title}</div><div className="text-xs text-muted-foreground leading-relaxed">{text}</div></div>
    </li>
  );
}

function AlertPhones({ phones }: { phones: string[] }) {
  const qc = useQueryClient();
  const [list, setList] = useState(phones);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setList(phones), [phones]);
  const save = async (next: string[]) => {
    setBusy(true);
    try { const r = await patch<{ phones: string[] }>("/api/wa-auto/alerts", { phones: next }); setList(r.phones); setV(""); toast.success("حُفظت أرقام التنبيه"); qc.invalidateQueries({ queryKey: KEY }); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="تنبيهات المحل على واتساب" icon={<BellRing />}>
      <p className="text-sm text-muted-foreground leading-relaxed">كل طلب أو حجز جديد، وكل تقييم ضعيف، يصل هذه الأرقام فوراً من رقم المحل — حتى لو الشاشة مقفلة.</p>
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-xs text-muted-foreground">لا أرقام بعد.</span>}
        {list.map((ph) => (
          <span key={ph} className="inline-flex items-center gap-1.5 rounded-full bg-secondary ps-3 pe-1 py-1 text-sm tabular-nums" dir="ltr">
            +{ph}<button disabled={busy} onClick={() => save(list.filter((x) => x !== ph))} className="w-6 h-6 grid place-items-center rounded-full hover:bg-background text-muted-foreground" aria-label="حذف"><X className="w-3.5 h-3.5" /></button>
          </span>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) void save([...list, v.trim()]); }}>
        <input className={cn(inputCls, "tabular-nums")} dir="ltr" inputMode="tel" value={v} onChange={(e) => setV(e.target.value)} placeholder="05xxxxxxxx" />
        <Btn tone="plain" type="submit" disabled={busy || !v.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}أضف</Btn>
      </form>
    </Card>
  );
}

// ── The weekly campaign ───────────────────────────────────────────

function WeeklyTab({ d }: { d: Overview }) {
  const shop = useShop();
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<Autopilot>(d.autopilot);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setCfg(d.autopilot), [d.autopilot]);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(d.autopilot);
  const set = <K extends keyof Autopilot>(k: K, v: Autopilot[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const save = async (body: Partial<Autopilot>, ok: string) => {
    setBusy("save");
    try { await patch("/api/wa-auto/autopilot", body); toast.success(ok); await refresh(); }
    catch (e) { toast.error(isPlanError(e) ? errText(e) : errText(e)); setCfg(d.autopilot); }
    finally { setBusy(null); }
  };
  const prepare = async () => {
    setBusy("run");
    try {
      const r = await post<Run>("/api/wa-auto/autopilot/run");
      if (r.status === "awaiting_approval") toast.success("الحملة جاهزة — راجعها ووافق عليها"); else toast.message(r.note ?? "لم تُجهَّز حملة");
      await refresh();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(null); }
  };

  const seg = d.segments.find((s) => s.key === cfg.audience);
  const waiting = d.runs.filter((r) => r.status === "awaiting_approval");
  const history = d.runs.filter((r) => r.status !== "awaiting_approval");

  return (
    <div className="space-y-4">
      {!d.plan.marketing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300" />
          <span className="flex-1">الحملات غير متاحة في خطتك الحالية ({d.plan.name}) — تبدأ من خطة «احترافي».</span>
          <Link href="/shop/settings" className="text-primary underline underline-offset-4">الخطة</Link>
        </div>
      )}

      {waiting.map((r) => <Approval key={r.id} run={r} onDone={refresh} />)}

      <Card title="حملة كل أسبوع، لوحدها" icon={<CalendarClock />}
        aside={<label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{cfg.enabled ? "تعمل" : "متوقفة"}</span>
          <Switch checked={cfg.enabled} dir="ltr" onCheckedChange={(v) => { set("enabled", v); void save({ enabled: v }, v ? "الحملة الأسبوعية تعمل" : "أُوقفت الحملة الأسبوعية"); }} /></label>}>
        <p className="text-sm text-muted-foreground leading-relaxed">
          مرة في الأسبوع، في اليوم والساعة التي تختارها: نجمع زبائنك الذين وافقوا على العروض، يكتب الوكيل رسالة قصيرة من عروضك والمنيو،
          ثم تُرسل بإيقاع آمن عبر محرك الحملات. لا أحد تصله حملتان في أقل من {cfg.restDays} أيام.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label><span className={labelCls}>اليوم</span>
            <select className={inputCls} value={cfg.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>{DAYS.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></label>
          <label><span className={labelCls}>الساعة</span>
            <select className={inputCls} value={cfg.hour} onChange={(e) => set("hour", Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 9).map((h) => <option key={h} value={h}>{h > 12 ? `${h - 12} مساءً` : h === 12 ? "12 ظهراً" : `${h} صباحاً`}</option>)}
            </select></label>
          <label><span className={labelCls}>لمن</span>
            <select className={inputCls} value={cfg.audience} onChange={(e) => set("audience", e.target.value)}>{d.segments.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.count})</option>)}</select></label>
          <label><span className={labelCls}>أقصى عدد في الحملة</span>
            <input className={cn(inputCls, "tabular-nums")} type="number" min={10} max={1500} value={cfg.maxRecipients} onChange={(e) => set("maxRecipients", Number(e.target.value))} /></label>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <Choice label="قبل الإرسال" value={cfg.mode} onChange={(v) => set("mode", v as Autopilot["mode"])} options={[
            ["approval", "أراجعها أولاً", "تجهز الحملة ويصلك تنبيه على واتساب، وتُرسل بعد موافقتك."],
            ["auto", "تُرسل لوحدها", "تُرسل إذا اجتازت فحص القواعد (لا أسعار مخترعة، لا مبالغة). وإلا تنتظرك."],
          ]} />
          <Choice label="نص الرسالة" value={cfg.source} onChange={(v) => set("source", v as Autopilot["source"])} options={[
            ["agent", "يكتبها الوكيل", "من عروضك الحالية والمنيو — جديدة كل أسبوع."],
            ["fixed", "نص ثابت أكتبه أنا", "نفس الرسالة كل أسبوع حتى تغيّرها."],
          ]} />
        </div>

        {cfg.source === "fixed" ? (
          <label className="block"><span className={labelCls}>الرسالة — اكتب {"{الاسم}"} مكان اسم الزبون</span>
            <textarea className={cn(inputCls, "leading-relaxed")} rows={5} value={cfg.fixedMessage ?? ""} maxLength={900} onChange={(e) => set("fixedMessage", e.target.value)} placeholder={"أهلاً {الاسم} 👋\nجديدنا هذا الأسبوع…"} />
            <span className="text-xs text-muted-foreground">رابط المنيو وسطر «لإيقاف العروض أرسل: توقف» يُضافان تلقائياً.</span></label>
        ) : (
          <label className="block"><span className={labelCls}>توجيه للوكيل (اختياري)</span>
            <input className={inputCls} value={cfg.instructions ?? ""} maxLength={500} onChange={(e) => set("instructions", e.target.value)} placeholder="مثال: ركّز على الحلويات الجديدة، وبأسلوب مرح" /></label>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Btn tone="gold" disabled={!dirty || !!busy} onClick={() => save(cfg, "حُفظت الإعدادات")}>{busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}حفظ</Btn>
          <Btn tone="plain" disabled={!!busy || dirty || !d.plan.marketing} onClick={prepare} title={dirty ? "احفظ أولاً" : undefined}>{busy === "run" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}جهّز حملة الآن</Btn>
          <span className="text-xs text-muted-foreground flex-1 min-w-[10rem]">
            {seg ? `${n(seg.count)} زبون في هذه الشريحة الآن.` : ""} {d.autopilot.lastRunAt ? `آخر تشغيل: ${shortDate(d.autopilot.lastRunAt, shop.org.timezone)}.` : ""}
          </span>
        </div>
      </Card>

      <Card title="سجل الحملات الأسبوعية" icon={<Megaphone />} aside={<span className="text-xs text-muted-foreground">آخر 30 يوماً: {n(d.campaigns30d.campaigns)} حملة · فُتح {pct(d.campaigns30d.read, d.campaigns30d.sent)}</span>}>
        {history.length === 0 ? <Empty title="لا حملات بعد" icon={<Megaphone />}>فعّل الحملة الأسبوعية أو اضغط «جهّز حملة الآن».</Empty> : (
          <div className="divide-y divide-border/60">
            {history.map((r) => (
              <div key={r.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className={cn("text-[11px] rounded-full px-2 py-0.5", RUN_STATUS[r.status].cls)}>{RUN_STATUS[r.status].label}</span>
                <span className="text-muted-foreground tabular-nums">{shortDate(r.createdAt, shop.org.timezone)}</span>
                {r.campaign ? (
                  <>
                    <span className="tabular-nums">أُرسلت {n(r.campaign.sent)}/{n(r.campaign.total)}</span>
                    <span className="tabular-nums text-muted-foreground">وصلت {pct(r.campaign.delivered, r.campaign.sent)}</span>
                    <span className="tabular-nums text-sky-300">فُتحت {pct(r.campaign.read, r.campaign.sent)}</span>
                  </>
                ) : r.note ? <span className="text-muted-foreground">{r.note}</span> : null}
                <span className="flex-1" />
                {r.campaignId && r.campaign && <Link href={`/campaigns/${r.campaignId}`} className="text-xs text-primary underline underline-offset-4">التفاصيل</Link>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string, string]> }) {
  return (
    <div>
      <div className={labelCls}>{label}</div>
      <div className="grid gap-2">
        {options.map(([k, title, text]) => (
          <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
            className={cn("text-start rounded-xl border px-3 py-2.5 transition", value === k ? "border-primary/60 bg-primary/10" : "border-border hover:bg-secondary/50")}>
            <div className="text-sm font-semibold flex items-center gap-2"><span className={cn("w-3.5 h-3.5 rounded-full border-2", value === k ? "border-primary bg-primary" : "border-muted-foreground/50")} />{title}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Approval({ run, onDone }: { run: Run; onDone: () => void }) {
  const [text, setText] = useState(run.message ?? "");
  const [busy, setBusy] = useState<"ok" | "no" | null>(null);
  const act = async (kind: "ok" | "no") => {
    if (kind === "no" && !confirm("رفض هذه الحملة؟ لن تُرسل.")) return;
    setBusy(kind);
    try {
      if (kind === "ok") { await post(`/api/wa-auto/runs/${run.id}/approve`, { message: text !== run.message ? text : undefined }); toast.success(`بدأ الإرسال إلى ${run.recipients} زبوناً`); }
      else { await post(`/api/wa-auto/runs/${run.id}/reject`); toast.message("رُفضت الحملة"); }
      onDone();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(null); }
  };
  return (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Megaphone className="w-5 h-5 text-amber-300" />
        <h2 className="font-bold flex-1">حملة هذا الأسبوع بانتظار موافقتك</h2>
        <span className="text-xs rounded-full bg-secondary px-2.5 py-1 tabular-nums">{n(run.recipients)} زبون</span>
        {run.writtenBy && <span className="text-xs rounded-full bg-secondary px-2.5 py-1">{WRITER[run.writtenBy] ?? run.writtenBy}</span>}
      </header>
      {run.note && <div className="text-xs text-amber-300 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{run.note}</div>}
      <div className="grid md:grid-cols-[minmax(0,1fr)_17rem] gap-3">
        <textarea className={cn(inputCls, "leading-relaxed min-h-40")} rows={8} value={text} maxLength={900} onChange={(e) => setText(e.target.value)} />
        <div className="rounded-2xl p-3 bg-[#0b141a]">
          <div className="max-w-[95%] ms-auto rounded-xl rounded-tr-sm px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-[#e9edef] bg-[#005c4b] shadow">{text.replace(/\{الاسم\}/g, "أحمد") || <span className="opacity-60">فارغة</span>}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn tone="gold" disabled={!!busy || !text.trim()} onClick={() => act("ok")}>{busy === "ok" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}وافق وأرسل</Btn>
        <Btn tone="danger" disabled={!!busy} onClick={() => act("no")}>{busy === "no" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}ارفض</Btn>
      </div>
    </section>
  );
}

// ── Segments and retargeting ──────────────────────────────────────

function AudienceTab({ d }: { d: Overview }) {
  const [, go] = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const camps = useQuery<Camp[]>({ queryKey: ["/api/wa-auto/campaigns"], queryFn: () => get("/api/wa-auto/campaigns") });
  const [campId, setCampId] = useState<number | null>(null);
  const done = (camps.data ?? []).filter((c) => c.sent > 0);
  const picked = done.find((c) => c.id === campId) ?? done[0] ?? null;

  const makeList = async (key: string, path: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const r = await post<{ groupId: number | null; total: number }>(path, body);
      toast.success(`قائمة جاهزة: ${r.total} رقم`);
      go(r.groupId ? `/campaigns/new?group=${r.groupId}` : "/campaigns/new");
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <Card title="شرائح الزبائن" icon={<Users />}>
        <p className="text-sm text-muted-foreground leading-relaxed">كل شريحة مأخوذة من زبائنك الذين وافقوا بأنفسهم على استلام العروض. اختر شريحة لتصير قائمة جاهزة في «حملة جديدة».</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {d.segments.map((s) => (
            <div key={s.key} className="rounded-xl border border-border p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{s.label}</div>
                <div className="text-2xl font-bold tabular-nums text-primary leading-tight mt-0.5">{n(s.count)}</div>
              </div>
              <Btn tone="plain" disabled={!s.count || !!busy || !d.plan.marketing} onClick={() => makeList(`seg:${s.key}`, "/api/wa-auto/segment-list", { segment: s.key })}>
                {busy === `seg:${s.key}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}حملة لهم
              </Btn>
            </div>
          ))}
        </div>
        {d.segments.every((s) => !s.count) && <p className="text-xs text-muted-foreground">لا أحد وافق على العروض بعد — خانة «أرسلوا لي العروض» تظهر للزبون عند الطلب والحجز وأخذ الدور.</p>}
      </Card>

      <Card title="إعادة الاستهداف من حملة سابقة" icon={<Repeat />}>
        {camps.isLoading ? <div className="py-8 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          : !picked ? <Empty title="لا حملات مُرسلة بعد" icon={<Repeat />}>بعد أول حملة تقدر ترسل رسالة ثانية لمن لم يفتحها، أو لمن فتحها ولم يرد.</Empty> : (
            <>
              <label className="block"><span className={labelCls}>الحملة</span>
                <select className={inputCls} value={picked.id} onChange={(e) => setCampId(Number(e.target.value))}>
                  {done.map((c) => <option key={c.id} value={c.id}>{c.name} — أُرسلت {c.sent}</option>)}
                </select></label>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="أُرسلت" value={n(picked.sent)} />
                <Stat label="وصلت" value={n(picked.delivered)} hint={pct(picked.delivered, picked.sent)} />
                <Stat label="فُتحت" value={n(picked.read)} hint={pct(picked.read, picked.sent)} tone="ok" />
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {d.retargets.map((r) => (
                  <Btn key={r.key} tone="plain" className="h-auto py-3" disabled={!!busy || !d.plan.marketing} onClick={() => makeList(`rt:${r.key}`, "/api/wa-auto/retarget", { campaignId: picked.id, who: r.key })}>
                    {busy === `rt:${r.key}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />}{r.label}
                  </Btn>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">تُنشأ قائمة جديدة بهؤلاء فقط وتفتح «حملة جديدة» عليها. من أرسل «توقف» لا يدخل أي قائمة.</p>
            </>
          )}
      </Card>
    </div>
  );
}
