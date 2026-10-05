// ── /admin/sales — موظف مبيعات منيو فور يو ─────────────────────────
// The platform's own seller: today's numbers and advice, the list of shops
// with each one's memory and timeline, the employee's training, its day
// (quota, follow-up days, hours, links), and an arena to talk to it as a shop
// owner before anything is sent.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, BrainCircuit, CalendarClock, Eye, GraduationCap, Link2, Loader2, MessageSquare, Play, Plus, Rocket, Search, Send, Store, Trash2, Upload, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { del, get, patch, post, put, inputCls, cardCls, labelCls } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, Stat, errText, n, shortDate, clock } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/setup/kit";
import { useAuth } from "@/context/AuthContext";

type LinkKey = "restaurant" | "cafe" | "sweets" | "salon" | "barber" | "signup" | "video";
interface Step { day: number; goal: string; link: "demo" | "signup" | "none" }
interface Settings {
  active: boolean; dryRun: boolean; replies: boolean; trackLinks: boolean; waUserId: number | null;
  name: string; title: string; persona: string; instructions: string[]; offer: string; links: Record<LinkKey, string>;
  dailyNew: number; hourFrom: number; hourTo: number; days: number[]; tz: string; steps: Step[]; warmGapDays: number; openerMode: "ai" | "template";
}
interface SettingsRes {
  settings: Settings; targets: Record<LinkKey, string>; productFacts: string; prompt: string; closed: string | null;
  account: { waUserId: number; connected: boolean; phone: string | null; ageDays: number; warm: boolean; dailyLimit: number; dailyRemaining: number };
  accounts: Array<{ id: number; name: string | null; phone: string }>;
}
interface Prospect {
  id: number; phone: string; name: string | null; business: string | null; vertical: string | null; city: string | null; source: string; stage: string; step: number;
  token: string; priority: number; nextAt: string | null; firstSentAt: string | null; lastSentAt: string | null; lastReplyAt: string | null; replies: number; clicks: number;
  linksSent: Array<{ key: string; at: string }>; facts: Array<{ fact: string; at: string }>; summary: string | null; interest: number | null; stopReason: string | null; note: string | null; updatedAt: string;
}
interface Touch { id: number; kind: string; step: number | null; text: string | null; links: string[]; by: string; status: string; meta: any; at: string }

const KEY = ["/api/sales/settings"];
const STAGES: Array<[string, string]> = [["", "الكل"], ["new", "لم نتواصل"], ["contacted", "أرسلنا"], ["replied", "ردّ"], ["interested", "مهتم"], ["trial", "في التجربة"], ["won", "اشترك"], ["lost", "رفض"], ["stopped", "متوقف"], ["paused", "موقوف يدوياً"]];
const STAGE_TONE: Record<string, string> = { interested: "bg-primary/15 text-primary", replied: "bg-sky-500/15 text-sky-300", trial: "bg-emerald-500/15 text-emerald-300", won: "bg-emerald-500/25 text-emerald-200", lost: "bg-red-500/10 text-red-300", stopped: "bg-muted text-muted-foreground", paused: "bg-amber-500/15 text-amber-300" };
const VERTICALS: Array<[string, string]> = [["restaurant", "مطعم"], ["cafe", "كافيه"], ["sweets", "حلويات"], ["salon", "صالون نسائي"], ["barber", "حلاق رجالي"]];
const LINKS: Array<[LinkKey, string]> = [["restaurant", "تجربة مطعم"], ["cafe", "تجربة كافيه"], ["sweets", "تجربة حلويات"], ["salon", "تجربة صالون"], ["barber", "تجربة حلاق"], ["signup", "التسجيل"], ["video", "فيديو الشرح"]];
const WEEK = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const TOUCH: Record<string, string> = { opener: "أول رسالة", followup: "متابعة", reply: "رد", inbound: "منه", click: "فتح رابط", stage: "مرحلة", note: "ملاحظة", teach: "علّمه" };
type Tab = "today" | "shops" | "employee" | "plan" | "arena";

export default function AdminSales() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("today");
  const q = useQuery<SettingsRes>({ queryKey: KEY, queryFn: () => get("/api/sales/settings"), enabled: !!user?.isAdmin });
  if (!user?.isAdmin) return <Empty title="للمسؤول فقط" />;
  if (q.isLoading) return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <Empty title="تعذّر التحميل">{errText(q.error)}</Empty>;
  const d = q.data;
  const tabs: Array<[Tab, string, any]> = [["today", "اليوم", Rocket], ["shops", "المحلات", Store], ["employee", "الموظف والتدريب", GraduationCap], ["plan", "الخطة والروابط", CalendarClock], ["arena", "التجربة", MessageSquare]];
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="w-6 h-6 text-primary" />موظف مبيعات منيو فور يو</h1>
          <p className="text-sm text-muted-foreground mt-1">{d.settings.name}، {d.settings.title} — تكلّم المحلات على واتساب، تتابعهم، وتتذكر كل محل. أنت تدرّبها هنا.</p>
        </div>
        <StatusPill d={d} />
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(([k, l, I]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("flex items-center gap-1.5 px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px", tab === k ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <I className="w-4 h-4" />{l}
          </button>
        ))}
      </nav>
      {tab === "today" && <Today d={d} />}
      {tab === "shops" && <Shops />}
      {tab === "employee" && <Employee d={d} />}
      {tab === "plan" && <Plan d={d} />}
      {tab === "arena" && <Arena d={d} />}
    </div>
  );
}

function useSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Partial<Settings>) => put("/api/sales/settings", p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ["/api/sales/stats"] }); toast.success("انحفظ"); },
    onError: (e) => toast.error(errText(e)),
  });
}

function StatusPill({ d }: { d: SettingsRes }) {
  const s = d.settings;
  const tone = !s.active ? "bg-muted text-muted-foreground" : s.dryRun ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300";
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className={cn("rounded-full px-3 py-1.5 font-semibold", tone)}>{!s.active ? "متوقف" : s.dryRun ? "يعمل — وضع التجربة (لا يُرسل شيء)" : "يعمل ويرسل"}</span>
      <span className={cn("rounded-full px-3 py-1.5", d.account.connected ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300")}>واتساب {d.account.connected ? "متصل" : "غير متصل"}{d.account.phone ? ` · ${d.account.phone}` : ""}</span>
      {d.closed && s.active && <span className="rounded-full px-3 py-1.5 bg-secondary text-muted-foreground">الآن: {d.closed}</span>}
    </div>
  );
}

// ── Today ─────────────────────────────────────────────────────────

function Today({ d }: { d: SettingsRes }) {
  const s = d.settings;
  const save = useSave();
  const qc = useQueryClient();
  const st = useQuery<any>({ queryKey: ["/api/sales/stats"], queryFn: () => get("/api/sales/stats"), refetchInterval: 30_000 });
  const tick = useMutation({
    mutationFn: () => post<any>("/api/sales/tick"),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["/api/sales/stats"] }); toast(r.reason ? `لم يُرسل: ${r.reason}` : `دورة: ${r.openers} أول رسالة، ${r.followUps} متابعة`); },
    onError: (e) => toast.error(errText(e)),
  });
  const x = st.data?.stats;
  const f = x?.funnel;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <div className="space-y-5">
      <div className={cn(cardCls, "flex flex-wrap items-center gap-4")}>
        <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={s.active} onCheckedChange={(v) => save.mutate({ active: v })} />البرنامج يعمل</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.dryRun} onCheckedChange={(v) => { if (!v && !confirm(`سيبدأ الإرسال الحقيقي من الرقم المختار: حتى ${s.dailyNew} محلاً جديداً يومياً مع متابعاتهم. متأكد؟`)) return; save.mutate({ dryRun: v }); }} />وضع التجربة (يكتب ولا يرسل)</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.replies} onCheckedChange={(v) => save.mutate({ replies: v })} />يرد على المحلات</label>
        <div className="flex-1" />
        <Btn onClick={() => tick.mutate()} disabled={tick.isPending}>{tick.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}شغّل دورة الآن</Btn>
      </div>
      {!d.account.warm && !s.dryRun && <p className="text-sm text-amber-300">الرقم عمره أقل من يومين على المنصة — الإرسال الحقيقي يبدأ بعد الإحماء.</p>}
      {!x ? <Empty title="اختر رقم واتساب الموظف من «الخطة والروابط»" /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="محلات جديدة اليوم" value={`${n(x.today.openers)} / ${n(x.today.quota)}`} hint="الحد اليومي للمحادثات الجديدة" tone="gold" />
            <Stat label="متابعات اليوم" value={n(x.today.followups)} />
            <Stat label="ردود المحلات اليوم" value={n(x.today.inbound)} hint={`ردّ الموظف ${n(x.today.replies)}`} />
            <Stat label="حد الرقم المتبقي اليوم" value={n(d.account.dailyRemaining)} hint={`من ${n(d.account.dailyLimit)} — مشترك مع الحملات`} />
          </div>
          <div className={cardCls}>
            <h3 className="font-semibold mb-3">القمع</h3>
            <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center text-sm">
              {[["في القائمة", x.total], ["تواصلنا", f.contacted], ["ردّوا", f.replied + f.interested + f.trial + f.won + f.lost], ["مهتمون", f.interested], ["فتحوا رابطاً", f.clicks], ["في التجربة", f.trial], ["اشتركوا", f.won]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-secondary/50 py-3"><div className="text-xl font-bold tabular-nums">{n(v as number)}</div><div className="text-xs text-muted-foreground mt-1">{l}</div></div>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground flex flex-wrap gap-4">
              <span>رد على أول رسالة: {pct(f.openerReplies, f.openersSent)}</span>
              {f.perStep.map((p: any) => <span key={p.step}>متابعة {p.step + 1}: {pct(p.replies, p.sent)} ({n(p.sent)})</span>)}
              <span>«توقف»: {n(f.optOuts)}</span>
              <span>استبدال الحارس: {pct(f.aiFallbacks, f.aiTotal)}</span>
            </div>
          </div>
          <div className={cardCls}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-primary" />اقتراحات لتحسين الأداء</h3>
            <ul className="space-y-2 text-sm">{x.advice.map((a: string, i: number) => <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{a}</span></li>)}</ul>
          </div>
          {st.data?.openers?.length > 0 && (
            <p className="text-xs text-muted-foreground">آخر الرسائل الأولى: {st.data.openers.map((o: any) => clock(o.at)).join(" · ")} — المسافة بينها موزّعة على ساعات العمل.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Shops ─────────────────────────────────────────────────────────

function Shops() {
  const qc = useQueryClient();
  const [stage, setStage] = useState("");
  const [qs, setQs] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useQuery<{ rows: Prospect[]; counts: Record<string, number> }>({ queryKey: ["/api/sales/prospects", stage, qs], queryFn: () => get(`/api/sales/prospects?stage=${stage}&q=${encodeURIComponent(qs)}`), refetchInterval: 30_000 });
  const total = Object.values(list.data?.counts ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STAGES.map(([k, l]) => (
          <button key={k} onClick={() => setStage(k)} className={cn("rounded-full px-3 py-1.5 text-xs border", stage === k ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
            {l} <span className="tabular-nums">{n(k ? list.data?.counts[k] ?? 0 : total)}</span>
          </button>
        ))}
        <div className="flex-1" />
        <label className="relative"><Search className="w-4 h-4 absolute top-2.5 start-2.5 text-muted-foreground" /><input className={cn(inputCls, "ps-8 w-52")} placeholder="رقم، اسم، مدينة" value={qs} onChange={(e) => setQs(e.target.value)} /></label>
        <Btn tone="gold" onClick={() => setImporting(true)}><Upload className="w-4 h-4" />أضف محلات</Btn>
      </div>
      {list.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : !list.data?.rows.length ? (
        <Empty icon={<Users className="w-8 h-8" />} title="لا محلات بعد">الصق قائمة أرقام المحلات أو استوردها من قوائمك — حتى 5000 في المرة.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground text-xs"><tr>
              {["المحل", "الرقم", "المرحلة", "رسائلنا", "ردوده", "روابط", "التالي", "الخلاصة"].map((h) => <th key={h} className="text-start font-medium px-3 py-2">{h}</th>)}
            </tr></thead>
            <tbody>
              {list.data.rows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-secondary/30 cursor-pointer" onClick={() => setOpen(p.id)}>
                  <td className="px-3 py-2"><div className="font-medium">{p.business || p.name || "—"}</div><div className="text-xs text-muted-foreground">{[VERTICALS.find((v) => v[0] === p.vertical)?.[1], p.city].filter(Boolean).join(" · ")}</div></td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{p.phone}</td>
                  <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs", STAGE_TONE[p.stage] ?? "bg-secondary")}>{STAGES.find((s) => s[0] === p.stage)?.[1] ?? p.stage}</span></td>
                  <td className="px-3 py-2 tabular-nums">{p.firstSentAt ? 1 + p.step : 0}</td>
                  <td className="px-3 py-2 tabular-nums">{p.replies}</td>
                  <td className="px-3 py-2 tabular-nums">{p.clicks ? `${p.clicks} فتح` : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.nextAt ? shortDate(p.nextAt) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px] truncate">{p.summary ?? p.facts.at(-1)?.fact ?? p.stopReason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importing && <ImportDialog onClose={() => { setImporting(false); qc.invalidateQueries({ queryKey: ["/api/sales/prospects"] }); }} />}
      {open && <ProspectDialog id={open} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["/api/sales/prospects"] }); }} />}
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [vertical, setVertical] = useState("");
  const [groupId, setGroupId] = useState("");
  const groups = useQuery<Array<{ id: number; name: string; count: number }>>({ queryKey: ["/api/contacts"], queryFn: () => get("/api/contacts") });
  const imp = useMutation({
    mutationFn: () => post<any>("/api/sales/prospects/import", groupId ? { groupId: Number(groupId), vertical: vertical || undefined, source: "list" } : { text, vertical: vertical || undefined, source: "paste" }),
    onSuccess: (r) => { toast.success(`أُضيف ${r.added} محلاً${r.duplicates ? ` · ${r.duplicates} مكرر` : ""}${r.unsubscribed ? ` · ${r.unsubscribed} طلبوا الإيقاف سابقاً` : ""}${r.bad ? ` · ${r.bad} سطر بلا رقم صالح` : ""}`); onClose(); },
    onError: (e) => toast.error(errText(e)),
  });
  return (
    <Modal open onClose={onClose} wide title="أضف محلات للقائمة" sub="سطر لكل محل: الرقم ثم الاسم والنشاط والمدينة بأي ترتيب، مفصولة بفاصلة أو Tab. يُستنتج نوع المحل من الاسم إن لم تحدده."
      footer={<><Btn tone="ghost" onClick={onClose}>إلغاء</Btn><Btn tone="gold" disabled={imp.isPending || (!text.trim() && !groupId)} onClick={() => imp.mutate()}>{imp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}أضف</Btn></>}>
      <div className="space-y-4">
        <label className="inline-flex items-center gap-2 text-sm text-primary cursor-pointer">
          <Upload className="w-4 h-4" />اختر ملف CSV أو نص
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        </label>
        <textarea className={cn(inputCls, "h-48 font-mono text-xs")} dir="auto" value={text} disabled={!!groupId} onChange={(e) => setText(e.target.value)}
          placeholder={"0501234567, مطعم الساحل, دبي\n971559876543\tكافيه الزاوية\tالعين"} />
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className={labelCls}>أو من قائمة موجودة</span>
            <select className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— بدون —</option>
              {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.count})</option>)}
            </select>
          </label>
          <label><span className={labelCls}>نوع المحلات (اختياري)</span>
            <select className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value)}>
              <option value="">يُستنتج من الاسم</option>
              {VERTICALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

function ProspectDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery<{ prospect: Prospect; touches: Touch[]; thread: Array<{ text: string; fromMe: boolean; at: string }> }>({ queryKey: ["/api/sales/prospects", id], queryFn: () => get(`/api/sales/prospects/${id}`), refetchInterval: 20_000 });
  const [lesson, setLesson] = useState("");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/sales/prospects", id] });
  const upd = useMutation({ mutationFn: (b: any) => patch(`/api/sales/prospects/${id}`, b), onSuccess: () => { refresh(); toast.success("تم"); }, onError: (e) => toast.error(errText(e)) });
  const pv = useMutation({ mutationFn: () => post<any>(`/api/sales/prospects/${id}/preview`), onSuccess: setPreview, onError: (e) => toast.error(errText(e)) });
  const now = useMutation({ mutationFn: () => post<any>(`/api/sales/prospects/${id}/send-now`), onSuccess: (r) => { refresh(); toast.success(r.dryRun ? "كُتبت (وضع التجربة — لم تُرسل)" : r.result === "sent" ? "أُرسلت" : `النتيجة: ${r.result}`); }, onError: (e) => toast.error(errText(e)) });
  const teach = useMutation({ mutationFn: () => post("/api/sales/teach", { text: lesson, prospectId: id }), onSuccess: () => { setLesson(""); refresh(); toast.success("حفظها الموظف — يطبقها من الآن"); }, onError: (e) => toast.error(errText(e)) });
  const send = useMutation({ mutationFn: () => post(`/api/sales/prospects/${id}/message`, { text: msg }), onSuccess: () => { setMsg(""); refresh(); toast.success("أُرسلت منك"); }, onError: (e) => toast.error(errText(e)) });
  const remove = useMutation({ mutationFn: () => del(`/api/sales/prospects/${id}`), onSuccess: onClose });
  const p = q.data?.prospect;
  return (
    <Modal open onClose={onClose} wide title={p ? (p.business || p.name || p.phone) : "…"} sub={p ? <span dir="ltr">{p.phone}</span> : undefined}>
      {!p ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <label><span className={labelCls}>المرحلة</span>
                <select className={inputCls} value={p.stage} onChange={(e) => upd.mutate({ stage: e.target.value })}>
                  {STAGES.slice(1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label><span className={labelCls}>النوع</span>
                <select className={inputCls} value={p.vertical ?? ""} onChange={(e) => upd.mutate({ vertical: e.target.value })}>
                  <option value="">—</option>{VERTICALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>رسائلنا: {p.firstSentAt ? 1 + p.step : 0} · ردوده: {p.replies} · فتح روابطنا: {p.clicks}{p.interest != null ? ` · الاهتمام ${p.interest}/3` : ""}</div>
              {p.nextAt && <div>المتابعة التالية: {shortDate(p.nextAt)} {clock(p.nextAt)}</div>}
              {p.stopReason && <div>السبب: {p.stopReason}</div>}
            </div>
            <div className={cn(cardCls, "space-y-2")}>
              <div className="text-sm font-semibold">ذاكرة هذا المحل</div>
              {p.summary && <p className="text-sm">{p.summary}</p>}
              {p.facts.length ? <ul className="text-xs space-y-1">{p.facts.map((f, i) => <li key={i}>• {f.fact}</li>)}</ul> : <p className="text-xs text-muted-foreground">لا شيء بعد — تمتلئ من ردوده.</p>}
              {p.linksSent.length > 0 && <p className="text-xs text-muted-foreground">أُرسل له: {[...new Set(p.linksSent.map((l) => LINKS.find((x) => x[0] === l.key)?.[1] ?? l.key))].join("، ")}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => pv.mutate()} disabled={pv.isPending}><Eye className="w-4 h-4" />الرسالة التالية</Btn>
              <Btn onClick={() => now.mutate()} disabled={now.isPending || ["trial", "won", "lost", "stopped"].includes(p.stage)}><Send className="w-4 h-4" />أرسلها الآن</Btn>
              <Btn tone={p.stage === "paused" ? "ok" : "plain"} onClick={() => upd.mutate({ stage: p.stage === "paused" ? "contacted" : "paused" })}>{p.stage === "paused" ? "استأنف" : "أوقفه مؤقتاً"}</Btn>
              <Btn tone="danger" onClick={() => confirm("حذف المحل وسجله؟") && remove.mutate()}><Trash2 className="w-4 h-4" /></Btn>
            </div>
            {preview && (
              <div className={cn(cardCls, "space-y-2")}>
                <div className="text-xs text-muted-foreground flex justify-between"><span>{preview.mode === "opener" ? "أول رسالة" : `متابعة ${preview.step + 1}`} · {preview.by === "ai" ? "كتبها الموظف" : "من القالب"}</span><button onClick={() => setPreview(null)}><X className="w-3.5 h-3.5" /></button></div>
                <p className="text-sm whitespace-pre-wrap">{preview.text}</p>
                {preview.issues?.length > 0 && <p className="text-[11px] text-amber-300">الحارس: {preview.issues.join(" · ")}</p>}
              </div>
            )}
            <div className="space-y-2">
              <span className={labelCls}><GraduationCap className="w-3.5 h-3.5 inline" /> علّمه من هذه المحادثة</span>
              <textarea className={cn(inputCls, "h-20")} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="مثل: إذا قال «عندنا طلبات» لا تقارن بالسعر، اسأله عن الزبائن الدائمين." />
              <Btn tone="gold" disabled={lesson.trim().length < 4 || teach.isPending} onClick={() => teach.mutate()}>احفظ التعليمة</Btn>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-sm font-semibold">السجل</div>
            <div className="max-h-[440px] overflow-y-auto space-y-2 pe-1">
              {q.data!.touches.map((t) => (
                <div key={t.id} className={cn("rounded-xl px-3 py-2 text-sm", t.kind === "inbound" ? "bg-secondary/60 me-8" : ["opener", "followup", "reply"].includes(t.kind) ? "bg-primary/10 ms-8" : "bg-transparent border border-dashed border-border text-xs text-muted-foreground")}>
                  <div className="text-[11px] text-muted-foreground mb-0.5 flex flex-wrap gap-x-2">
                    <span>{TOUCH[t.kind] ?? t.kind}{t.step != null && t.kind === "followup" ? ` ${t.step + 1}` : ""}</span>
                    <span>{shortDate(t.at)} {clock(t.at)}</span>
                    {t.by === "template" && <span>قالب</span>}{t.by === "human" && <span>منك</span>}
                    {t.status !== "sent" && <span className={t.status === "failed" ? "text-red-300" : "text-amber-300"}>{t.status === "dry" ? "تجربة — لم تُرسل" : t.status}</span>}
                  </div>
                  {t.text && <p className="whitespace-pre-wrap break-words">{t.text}</p>}
                  {t.meta?.issues?.length > 0 && <p className="text-[11px] text-amber-300 mt-1">الحارس: {t.meta.issues.join(" · ")}</p>}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className={inputCls} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="اكتب له بنفسك (يُرسل من رقم الموظف)" />
              <Btn disabled={!msg.trim() || send.isPending} onClick={() => send.mutate()}><Send className="w-4 h-4" /></Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── The employee and its training ─────────────────────────────────

function Employee({ d }: { d: SettingsRes }) {
  const s = d.settings;
  const save = useSave();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: s.name, title: s.title, persona: s.persona, offer: s.offer });
  const [rule, setRule] = useState("");
  const [lesson, setLesson] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => setForm({ name: s.name, title: s.title, persona: s.persona, offer: s.offer }), [s.name, s.title, s.persona, s.offer]);
  const mem = useQuery<Record<string, Array<{ id: number; content: string; times: number }>>>({ queryKey: ["/api/sales/memory"], queryFn: () => get("/api/sales/memory") });
  const forget = useMutation({ mutationFn: (id: number) => del(`/api/sales/memory/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sales/memory"] }) });
  const teach = useMutation({ mutationFn: () => post("/api/sales/teach", { text: lesson }), onSuccess: () => { setLesson(""); qc.invalidateQueries({ queryKey: ["/api/sales/memory"] }); qc.invalidateQueries({ queryKey: KEY }); toast.success("تعلّمها"); }, onError: (e) => toast.error(errText(e)) });
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="space-y-4">
        <div className={cn(cardCls, "space-y-3")}>
          <h3 className="font-semibold">من هو</h3>
          <div className="grid grid-cols-2 gap-2">
            <label><span className={labelCls}>الاسم</span><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label><span className={labelCls}>المسمى</span><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          </div>
          <label className="block"><span className={labelCls}>الشخصية والأسلوب</span><textarea className={cn(inputCls, "h-24")} value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} /></label>
          <label className="block"><span className={labelCls}>العرض الحالي — يقوله حرفياً، ولا يخترع غيره</span><input className={inputCls} value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} placeholder="مثل: شهر إضافي مجاني لمن يسجل هذا الأسبوع" /></label>
          <Btn tone="gold" disabled={save.isPending} onClick={() => save.mutate(form)}>احفظ</Btn>
        </div>
        <div className={cn(cardCls, "space-y-3")}>
          <h3 className="font-semibold">تعليمات المدرّب</h3>
          <ul className="space-y-1.5 text-sm">
            {s.instructions.map((x, i) => (
              <li key={i} className="flex gap-2 items-start"><span className="flex-1">• {x}</span>
                <button className="text-muted-foreground hover:text-destructive" onClick={() => save.mutate({ instructions: s.instructions.filter((_, j) => j !== i) })}><X className="w-3.5 h-3.5" /></button></li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className={inputCls} value={rule} onChange={(e) => setRule(e.target.value)} placeholder="قاعدة جديدة: «لا تذكر السعر قبل أن يسأل»" />
            <Btn onClick={() => { if (rule.trim()) { save.mutate({ instructions: [...s.instructions, rule.trim()] }); setRule(""); } }}><Plus className="w-4 h-4" /></Btn>
          </div>
          <p className="text-[11px] text-muted-foreground">القواعد هنا ثابتة في كل رسالة. «علّمه» من محادثة محل يحفظها في ذاكرته (أدناه) مع المكاسب والخسائر.</p>
        </div>
        <div className={cn(cardCls, "space-y-2")}>
          <h3 className="font-semibold">ذاكرة الموظف</h3>
          <div className="flex gap-2">
            <input className={inputCls} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="علّمه شيئاً يتذكره" />
            <Btn tone="gold" disabled={lesson.trim().length < 4 || teach.isPending} onClick={() => teach.mutate()}>علّمه</Btn>
          </div>
          {([["instruction", "تعلّمه"], ["win", "رسائل نجحت"], ["loss", "رسائل لم تنجح"]] as const).map(([k, l]) => (
            <div key={k}>
              <div className="text-xs text-muted-foreground mt-2 mb-1">{l} ({mem.data?.[k]?.length ?? 0})</div>
              <ul className="space-y-1 text-xs">{mem.data?.[k]?.slice(0, 12).map((m) => (
                <li key={m.id} className="flex gap-2"><span className="flex-1">{m.content}{m.times > 1 ? ` ×${m.times}` : ""}</span><button onClick={() => forget.mutate(m.id)} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button></li>
              ))}</ul>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className={cardCls}>
          <h3 className="font-semibold mb-2">حقائق المنتج — تُكتب تلقائياً من مصفوفة الخطط</h3>
          <pre className="text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">{d.productFacts}</pre>
          <p className="text-[11px] text-muted-foreground mt-2">غيّر الأسعار أو المزايا من «الخطط والفترة التجريبية» ويقولها الموظف خلال دقيقة. أي سعر أو نسبة غيرها يرفضها الحارس.</p>
        </div>
        <div className={cardCls}>
          <button className="font-semibold text-sm text-primary" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? "أخفِ" : "اعرض"} التعليمات الكاملة التي يقرأها الموظف</button>
          {showPrompt && <pre className="text-[11px] whitespace-pre-wrap leading-relaxed mt-3 max-h-[520px] overflow-y-auto">{d.prompt}</pre>}
        </div>
      </div>
    </div>
  );
}

// ── The plan: account, day, follow-ups, links ─────────────────────

function Plan({ d }: { d: SettingsRes }) {
  const save = useSave();
  const [s, setS] = useState<Settings>(d.settings);
  useEffect(() => setS(d.settings), [d.settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setStep = (i: number, p: Partial<Step>) => set("steps", s.steps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(d.settings), [s, d.settings]);
  return (
    <div className="space-y-5">
      <div className={cn(cardCls, "grid md:grid-cols-3 gap-4")}>
        <label><span className={labelCls}>رقم واتساب الموظف</span>
          <select className={inputCls} value={s.waUserId ?? ""} onChange={(e) => set("waUserId", e.target.value ? Number(e.target.value) : null)}>
            <option value="">— اختر —</option>
            {d.accounts.map((a) => <option key={a.id} value={a.id}>{a.name || "حساب"} · {a.phone}</option>)}
          </select>
          <span className="text-[11px] text-muted-foreground">يُفضّل رقم مخصص للمبيعات، غير رقم الدعم.</span>
        </label>
        <label><span className={labelCls}>محلات جديدة يومياً</span><input type="number" min={0} max={300} className={inputCls} value={s.dailyNew} onChange={(e) => set("dailyNew", Number(e.target.value))} />
          <span className="text-[11px] text-muted-foreground">تتوزع على ساعات العمل: واحدة كل ~{Math.round(((s.hourTo - s.hourFrom) * 60) / Math.max(1, s.dailyNew))} دقيقة.</span></label>
        <div className="grid grid-cols-2 gap-2">
          <label><span className={labelCls}>من الساعة</span><input type="number" min={0} max={23} className={inputCls} value={s.hourFrom} onChange={(e) => set("hourFrom", Number(e.target.value))} /></label>
          <label><span className={labelCls}>إلى الساعة</span><input type="number" min={1} max={24} className={inputCls} value={s.hourTo} onChange={(e) => set("hourTo", Number(e.target.value))} /></label>
        </div>
        <div className="md:col-span-3">
          <span className={labelCls}>أيام العمل</span>
          <div className="flex flex-wrap gap-1.5">{WEEK.map((w, i) => (
            <button key={w} onClick={() => set("days", s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort())} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", s.days.includes(i) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>{w}</button>
          ))}</div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.openerMode === "ai"} onCheckedChange={(v) => set("openerMode", v ? "ai" : "template")} />أول رسالة يكتبها الموظف (وإلا من القالب)</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={s.trackLinks} onCheckedChange={(v) => set("trackLinks", v)} />تتبع فتح الروابط لكل محل</label>
        <label className="flex items-center gap-2 text-sm">بعد رده، يتابع إن سكت بعد <input type="number" min={1} max={30} className={cn(inputCls, "w-16")} value={s.warmGapDays} onChange={(e) => set("warmGapDays", Number(e.target.value))} /> يوم</label>
      </div>

      <div className={cn(cardCls, "space-y-3")}>
        <h3 className="font-semibold">المتابعة — إن لم يرد</h3>
        <p className="text-xs text-muted-foreground">كل متابعة يكتبها الموظف لهدفها، ويراجعها الحارس، وتتوقف كلها حين يرد أو يكتب «توقف». الأيام من أول رسالة.</p>
        {s.steps.map((st, i) => (
          <div key={i} className="grid md:grid-cols-[90px_1fr_150px_32px] gap-2 items-start">
            <label><span className="text-[11px] text-muted-foreground">اليوم</span><input type="number" min={1} max={120} className={inputCls} value={st.day} onChange={(e) => setStep(i, { day: Number(e.target.value) })} /></label>
            <label><span className="text-[11px] text-muted-foreground">هدف المتابعة {i + 1}</span><textarea className={cn(inputCls, "h-16")} value={st.goal} onChange={(e) => setStep(i, { goal: e.target.value })} /></label>
            <label><span className="text-[11px] text-muted-foreground">الرابط</span>
              <select className={inputCls} value={st.link} onChange={(e) => setStep(i, { link: e.target.value as Step["link"] })}>
                <option value="none">بلا رابط</option><option value="demo">تجربة نوع محله</option><option value="signup">التسجيل</option>
              </select>
            </label>
            <button className="mt-6 text-muted-foreground hover:text-destructive" onClick={() => set("steps", s.steps.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {s.steps.length < 8 && <Btn tone="ghost" onClick={() => set("steps", [...s.steps, { day: (s.steps.at(-1)?.day ?? 0) + 10, goal: "", link: "none" }])}><Plus className="w-4 h-4" />متابعة</Btn>}
      </div>

      <div className={cn(cardCls, "space-y-3")}>
        <h3 className="font-semibold flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" />الروابط التي يرسلها</h3>
        <p className="text-xs text-muted-foreground">اتركها فاضية لتستخدم المحلات التجريبية وصفحة التسجيل. يرسل لكل محل تجربة نوعه.</p>
        <div className="grid md:grid-cols-2 gap-3">{LINKS.map(([k, l]) => (
          <label key={k}><span className={labelCls}>{l}</span>
            <input className={inputCls} dir="ltr" value={s.links[k]} placeholder={d.targets[k] || "—"} onChange={(e) => set("links", { ...s.links, [k]: e.target.value })} /></label>
        ))}</div>
      </div>
      <div className="sticky bottom-3 flex justify-end">
        <Btn tone="gold" disabled={!dirty || save.isPending} onClick={() => save.mutate(s)}>{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}احفظ الخطة</Btn>
      </div>
    </div>
  );
}

// ── The arena ─────────────────────────────────────────────────────

function Arena({ d }: { d: SettingsRes }) {
  const [vertical, setVertical] = useState("restaurant");
  const [business, setBusiness] = useState("مطعم الساحل");
  const [turns, setTurns] = useState<Array<{ role: "user" | "assistant"; content: string; meta?: string }>>([]);
  const [text, setText] = useState("");
  const run = useMutation({
    mutationFn: (t: typeof turns) => post<any>("/api/sales/arena", { turns: t, vertical, business }),
    onSuccess: (r, t) => setTurns([...t, { role: "assistant", content: r.text || "(لم يجد رداً آمناً — يُحوَّل لبشري)", meta: `${r.mode === "opener" ? "أول رسالة" : r.mode === "reply" ? "رد" : "متابعة"} · ${r.by === "ai" ? "الموظف" : "القالب"}${r.issues?.length ? ` · الحارس: ${r.issues.join("، ")}` : ""}` }]),
    onError: (e) => toast.error(errText(e)),
  });
  const say = () => { if (!text.trim()) return; const t = [...turns, { role: "user" as const, content: text.trim() }]; setTurns(t); setText(""); run.mutate(t); };
  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-5 items-start">
      <div className={cn(cardCls, "space-y-3")}>
        <p className="text-sm">كلّم {d.settings.name} كأنك صاحب محل. لا يُرسل شيء، ويمر كل رد على الحارس كما في الحقيقة.</p>
        <label><span className={labelCls}>نوع المحل</span><select className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value)}>{VERTICALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span className={labelCls}>اسم المحل</span><input className={inputCls} value={business} onChange={(e) => setBusiness(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => { setTurns([]); run.mutate([]); }} disabled={run.isPending}>اكتب أول رسالة</Btn>
          <Btn tone="ghost" onClick={() => setTurns([])}>من جديد</Btn>
        </div>
        <div className="text-[11px] text-muted-foreground space-y-1">
          <div>جرّب: «عندنا طلبات ومكفينا» · «كم السعر؟» · «انت بوت؟» · «أرسل التفاصيل» · «مو الحين»</div>
        </div>
      </div>
      <div className={cn(cardCls, "flex flex-col h-[560px]")}>
        <div className="flex-1 overflow-y-auto space-y-2 pe-1">
          {turns.length === 0 && <p className="text-sm text-muted-foreground text-center mt-20">ابدأ بـ«اكتب أول رسالة» أو اكتب كصاحب محل.</p>}
          {turns.map((t, i) => (
            <div key={i} className={cn("rounded-xl px-3 py-2 text-sm max-w-[85%]", t.role === "user" ? "bg-secondary/70 me-auto" : "bg-primary/15 ms-auto")}>
              <p className="whitespace-pre-wrap">{t.content}</p>
              {t.meta && <p className="text-[10px] text-muted-foreground mt-1">{t.meta}</p>}
            </div>
          ))}
          {run.isPending && <Loader2 className="w-4 h-4 animate-spin ms-auto" />}
        </div>
        <div className="flex gap-2 mt-3">
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && say()} placeholder="اكتب كصاحب المحل…" />
          <Btn tone="gold" onClick={say} disabled={run.isPending || !text.trim()}><Send className="w-4 h-4" /></Btn>
        </div>
      </div>
    </div>
  );
}
