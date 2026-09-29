// ── Email marketing ───────────────────────────────────────────────
// One section, eight tabs. The owner's path is: settings once, then drop a
// spreadsheet on the import tab and let the ladder do the rest; everything
// after that is watching — the overview polls every ten seconds so what is
// on screen is what is happening.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Mail, Upload, Users, Megaphone, ListOrdered, FileText, Inbox, Settings2, Loader2, Play, Pause,
  CheckCircle2, AlertTriangle, Eye, MousePointerClick, Reply, ShieldAlert, RefreshCw, Trash2, Plus, Send, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "@/components/AgentPanel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";
const primary = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-primary text-primary-foreground disabled:opacity-40";
const ta = cn(input, "min-h-[10rem] font-mono text-xs leading-relaxed");
const ago = (d?: string | Date | null) => {
  if (!d) return "—";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 1) return "الآن"; if (m < 60) return `${m}د`; const h = Math.round(m / 60); return h < 24 ? `${h}س` : `${Math.round(h / 24)}ي`;
};
const pct = (n?: number | null) => (n === null || n === undefined ? "—" : `${n}%`);

const TABS = [
  { key: "overview",  label: "النظرة العامة", icon: Mail },
  { key: "import",    label: "رفع Excel",      icon: Upload },
  { key: "contacts",  label: "جهات الاتصال",   icon: Users },
  { key: "campaigns", label: "الحملات",         icon: Megaphone },
  { key: "sequences", label: "المتابعة",        icon: ListOrdered },
  { key: "templates", label: "القوالب",         icon: FileText },
  { key: "inbox",     label: "الوارد",          icon: Inbox },
  { key: "settings",  label: "الإعدادات",       icon: Settings2 },
] as const;
type Tab = typeof TABS[number]["key"];

const EVENT_AR: Record<string, { label: string; cls: string }> = {
  sent: { label: "أُرسلت", cls: "text-muted-foreground" }, open: { label: "فُتحت", cls: "text-blue-400" }, click: { label: "نقر رابطاً", cls: "text-primary" },
  reply: { label: "ردّ", cls: "text-green-400" }, bounce: { label: "ارتدّت", cls: "text-red-400" }, complaint: { label: "بلاغ إزعاج", cls: "text-red-500" },
  unsubscribe: { label: "ألغى الاشتراك", cls: "text-yellow-400" }, failed: { label: "فشلت", cls: "text-red-400" },
};

export default function EmailMarketing() {
  const [, params] = useRoute("/email/:tab?");
  const [, navigate] = useLocation();
  const tab = (TABS.find((t) => t.key === params?.tab)?.key ?? "overview") as Tab;
  const { data: ov } = useQuery<any>({ queryKey: ["email-overview"], queryFn: () => api("/api/email/overview"), refetchInterval: 10_000 });

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Mail className="w-6 h-6 text-primary" /> التسويق بالبريد</h1>
          <p className="text-sm text-muted-foreground mt-1">ارفع ملف Excel، والقسم ينظّفه ويقسّمه ويرسل ويتابع ويقرأ الردود — وأنت تراقب لحظة بلحظة.</p>
        </div>
        {ov && !ov.configured && (
          <Link href="/email/settings" className={cn(ghost, "border-yellow-500/40 text-yellow-400")}><AlertTriangle className="w-3.5 h-3.5" /> اضبط المُرسِل أولاً</Link>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-card-border -mx-6 px-6">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => navigate(`/email/${t.key}`)}
            className={cn("flex items-center gap-1.5 px-3 py-2.5 text-xs whitespace-nowrap border-b-2 -mb-px transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
            {t.key === "inbox" && ov?.events?.some((e: any) => e.type === "reply") && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
          </button>
        ))}
      </div>

      {tab === "overview"  && <Overview ov={ov} />}
      {tab === "import"    && <Import />}
      {tab === "contacts"  && <Contacts />}
      {tab === "campaigns" && <Campaigns />}
      {tab === "sequences" && <Sequences />}
      {tab === "templates" && <Templates />}
      {tab === "inbox"     && <InboxTab />}
      {tab === "settings"  && <SettingsTab />}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────
function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className={cn(card, "p-3.5")}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold leading-none mt-1.5", tone)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1.5">{sub}</p>}
    </div>
  );
}

function Overview({ ov }: { ov: any }) {
  if (!ov) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  const h = ov.health ?? {};
  const w = ov.week ?? {}, t = ov.today ?? {}, c = ov.contacts ?? {}, q = ov.queue ?? {};
  return (
    <div className="space-y-4">
      {!ov.trackingBase && (
        <div className={cn(card, "p-3 border-yellow-500/30 text-xs text-muted-foreground")}>
          <AlertTriangle className="w-3.5 h-3.5 inline text-yellow-400 ml-1" />
          لم يُضبط <code>SITE_URL</code> في الإعدادات — بدونه لا يمكن قياس الفتح والنقر ولا يعمل رابط إلغاء الاشتراك (تُرسل الرسائل بإلغاء اشتراك عبر البريد فقط).
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="أُرسل اليوم" value={t.sent ?? 0} sub={`${w.sent ?? 0} هذا الأسبوع`} />
        <Stat label="نسبة الفتح (أسبوع)" value={pct(w.openRate)} sub={`${w.opened ?? 0} فتحوا`} tone="text-blue-400" />
        <Stat label="نقر الروابط" value={pct(w.clickRate)} sub={`${w.clicked ?? 0} نقروا`} />
        <Stat label="الردود" value={pct(w.replyRate)} sub={`${w.replied ?? 0} ردّوا`} tone="text-green-400" />
        <Stat label="الارتداد" value={pct(w.bounceRate)} sub={`${w.bounced ?? 0} ارتدّت`} tone={(w.bounceRate ?? 0) >= 3 ? "text-red-400" : undefined} />
        <Stat label="في الطابور" value={q.queued ?? 0} sub={`${q.pendingRungs ?? 0} متابعة · حصة اليوم ${ov.sender?.dailyCapToday ?? "—"}${ov.sender?.warmup && ov.sender?.dailyCapToday < ov.sender?.dailyCap ? " (إحماء)" : ""}`} />
      </div>

      <div className={cn(card, "p-4", h.level === "critical" && "border-red-500/40", h.level === "warning" && "border-yellow-500/30")}>
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldAlert className={cn("w-4 h-4", h.level === "ok" ? "text-primary" : h.level === "warning" ? "text-yellow-400" : "text-red-400")} />
          <p className="font-semibold text-sm">سلامة الإرسال</p>
          <span className="text-[11px] text-muted-foreground">
            {h.level === "ok" ? "طبيعي" : h.level === "warning" ? "تحذير" : "حرج"} · {h.throttle > 1 ? `إبطاء ${h.throttle}×` : "السرعة المحسوبة"}
            {q.heldUntil ? ` · موقوف حتى ${new Date(q.heldUntil).toLocaleTimeString("ar-AE", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
          <span className="text-[11px] text-muted-foreground mr-auto">{c.active ?? 0} نشط · {c.unsubscribed ?? 0} ألغوا · {c.bounced ?? 0} ارتدّوا · {c.lists ?? 0} قوائم</span>
        </div>
        {h.reasons?.length ? <ul className="mt-2 space-y-1">{h.reasons.map((r: string, i: number) => <li key={i} className="text-[11px] text-muted-foreground">• {r}</li>)}</ul>
          : <p className="mt-2 text-[11px] text-muted-foreground">لا إشارة تستدعي القلق. الارتداد تحت ٣٪ والبلاغات تحت ٠.١٪ هما الخطّان اللذان نراقبهما.</p>}
      </div>

      <div className={cn(card)}>
        <div className="p-3.5 border-b border-card-border flex items-center gap-2">
          <p className="font-semibold text-sm">ما يحدث الآن</p>
          <span className="text-[10px] text-muted-foreground">يتحدّث كل ١٠ ثوانٍ</span>
        </div>
        <div className="max-h-[28rem] overflow-y-auto divide-y divide-card-border">
          {(ov.events ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground text-center">لم يحدث شيء بعد — ارفع ملفاً وابدأ.</p>
            : ov.events.map((e: any) => {
              const k = EVENT_AR[e.type] ?? { label: e.type, cls: "" };
              return (
                <div key={e.id} className="px-3.5 py-2 flex items-center gap-3 text-xs">
                  <span className={cn("w-20 shrink-0 font-medium", k.cls)}>{k.label}</span>
                  <span className="font-mono text-[11px]" dir="ltr">{e.to ?? "—"}</span>
                  <span className="text-muted-foreground truncate flex-1">{e.subject ?? ""}{e.url ? ` → ${e.url}` : ""}{e.meta?.proxied ? " (عبر وكيل البريد)" : ""}</span>
                  <span className="text-[10px] text-muted-foreground/60">{ago(e.at)}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── Import ────────────────────────────────────────────────────────
function Import() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [opts, setOpts] = useState({ listName: "", splitBy: "", mx: true, sequenceId: "" });
  const [result, setResult] = useState<any>(null);
  const { data: seqs = [] } = useQuery<any[]>({ queryKey: ["email-seqs"], queryFn: () => api("/api/email/sequences") });
  useEffect(() => { const d = seqs.find((s) => s.isDefault); if (d && !opts.sequenceId) setOpts((o) => ({ ...o, sequenceId: String(d.id) })); }, [seqs]);

  const post = async (path: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const r = await fetch(`${BASE}${path}`, { method: "POST", body: fd, credentials: "include" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? "فشل");
    return d;
  };
  const doPreview = async (f: File) => {
    setFile(f); setResult(null); setBusy("preview");
    try { setPreview(await (async () => { const fd = new FormData(); fd.append("file", f); const r = await fetch(`${BASE}/api/email/contacts/preview`, { method: "POST", body: fd, credentials: "include" }); const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })()); setOpts((o) => ({ ...o, listName: f.name.replace(/\.[a-z]+$/i, "") })); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const doImport = async () => {
    setBusy("import");
    try {
      const d = await post("/api/email/contacts/import", { listName: opts.listName, splitBy: opts.splitBy, mx: String(opts.mx), sequenceId: opts.sequenceId });
      setResult(d); setPreview(null); setFile(null);
      qc.invalidateQueries({ queryKey: ["email-overview"] }); qc.invalidateQueries({ queryKey: ["email-lists"] });
      toast.success(`استُورد ${d.inserted} جديداً${d.enrolled ? ` وسُجّل ${d.enrolled.enrolled} في المتابعة` : ""}`);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className={cn(card, "p-5 border-dashed border-2 text-center cursor-pointer hover:border-primary/50")}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void doPreview(f); }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doPreview(f); }} />
        {busy === "preview" ? <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /> : <Upload className="w-6 h-6 mx-auto text-muted-foreground" />}
        <p className="text-sm font-semibold mt-2">{file ? file.name : "اسحب ملف Excel هنا أو اضغط للاختيار"}</p>
        <p className="text-[11px] text-muted-foreground mt-1">كما هو — الأعمدة تُكتشف تلقائياً: البريد، الشركة، الاسم، الجوال، النشاط، الإمارة. تُستبعد الأسطر بلا بريد صالح والمكرّرة، ويُفحص نطاق كل بريد (MX).</p>
      </div>

      {preview && (
        <div className={cn(card, "p-4 space-y-4")}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="أسطر في الملف" value={preview.total} />
            <Stat label="صالحة وفريدة" value={preview.kept} tone="text-primary" />
            <Stat label="بلا بريد صالح" value={preview.invalid} tone={preview.invalid ? "text-yellow-400" : undefined} />
            <Stat label="مكرّرة" value={preview.duplicates} />
            <Stat label="عناوين عامة (info@…)" value={preview.roleAddresses} sub="تُبقى وتُعلَّم" />
          </div>
          <div className="text-xs">
            <p className="font-semibold mb-1.5">الأعمدة كما فهمتها:</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preview.columns as Record<string, string | null>).map(([k, v]) => (
                <span key={k} className={cn("px-2 py-0.5 rounded border text-[11px]", v ? "border-primary/40 text-primary" : "border-card-border text-muted-foreground")}>
                  {({ email: "البريد", name: "الاسم", company: "الشركة", phone: "الجوال", industry: "النشاط", city: "المدينة" } as any)[k]}: {v ?? "—"}
                </span>
              ))}
            </div>
          </div>
          {preview.sample?.length > 0 && (
            <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="text-muted-foreground"><th className="text-right p-1">البريد</th><th className="text-right p-1">الشركة</th><th className="text-right p-1">الاسم</th><th className="text-right p-1">النشاط</th><th className="text-right p-1">المدينة</th></tr></thead>
              <tbody>{preview.sample.map((r: any) => <tr key={r.email} className="border-t border-card-border"><td className="p-1 font-mono" dir="ltr">{r.email}</td><td className="p-1">{r.company ?? ""}</td><td className="p-1">{r.name ?? ""}</td><td className="p-1">{r.industry ?? ""}</td><td className="p-1">{r.city ?? ""}</td></tr>)}</tbody></table></div>
          )}
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div><label className="text-xs font-semibold block mb-1.5">اسم القائمة</label><input className={input} value={opts.listName} onChange={(e) => setOpts({ ...opts, listName: e.target.value })} /></div>
            <div><label className="text-xs font-semibold block mb-1.5">تقسيم إلى قوائم فرعية</label>
              <select className={input} value={opts.splitBy} onChange={(e) => setOpts({ ...opts, splitBy: e.target.value })}>
                <option value="">بلا تقسيم</option>
                {preview.columns.industry && <option value="industry">حسب النشاط ({preview.byIndustry?.length ?? 0})</option>}
                {preview.columns.city && <option value="city">حسب المدينة ({preview.byCity?.length ?? 0})</option>}
              </select></div>
            <div><label className="text-xs font-semibold block mb-1.5">تسجيل الجميع في المتابعة</label>
              <select className={input} value={opts.sequenceId} onChange={(e) => setOpts({ ...opts, sequenceId: e.target.value })}>
                <option value="">لا — الاستيراد فقط</option>
                {seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <label className="flex items-center gap-2 text-xs pb-2"><input type="checkbox" checked={opts.mx} onChange={(e) => setOpts({ ...opts, mx: e.target.checked })} /> فحص MX لكل نطاق</label>
          </div>
          {(preview.byIndustry?.length > 1 || preview.byCity?.length > 1) && (
            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-1.5">
              {(opts.splitBy === "city" ? preview.byCity : preview.byIndustry)?.slice(0, 12).map((g: any) => <span key={g.key} className="px-2 py-0.5 rounded bg-muted">{g.key}: {g.n}</span>)}
            </div>
          )}
          <button onClick={doImport} disabled={busy === "import" || !preview.kept} className={primary}>
            {busy === "import" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            استورد {preview.kept} جهة اتصال{opts.sequenceId ? " وابدأ المتابعة" : ""}
          </button>
        </div>
      )}

      {result && (
        <div className={cn(card, "p-4 border-primary/30")}>
          <p className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary" /> تم</p>
          <ul className="text-xs text-muted-foreground mt-2 space-y-1">
            <li>{result.inserted} جهة اتصال جديدة، {result.alreadyKnown} كانت موجودة، {result.invalid} بلا بريد صالح، {result.duplicates} مكرّرة{result.mxBad ? `، ${result.mxBad} نطاقها لا يستقبل بريداً (لن تُراسَل)` : ""}.</li>
            <li>القائمة: <b className="text-foreground">{result.list?.name}</b>{result.subLists?.length ? ` + ${result.subLists.length} قائمة فرعية` : ""}.</li>
            {result.enrolled && <li>سُجّل {result.enrolled.enrolled} في تسلسل المتابعة ({result.enrolled.skipped} تُخطّوا). الرسالة الأولى تبدأ خلال ساعة وتتوزع بحسب حصة الإرسال.</li>}
          </ul>
          <div className="flex gap-2 mt-3"><Link href="/email/overview" className={ghost}>راقب الإرسال</Link><Link href="/email/contacts" className={ghost}>جهات الاتصال</Link></div>
        </div>
      )}
    </div>
  );
}

// ── Contacts ──────────────────────────────────────────────────────
function Contacts() {
  const qc = useQueryClient();
  const [q, setQ] = useState(""); const [listId, setListId] = useState<number | null>(null); const [status, setStatus] = useState("");
  const { data: lists = [] } = useQuery<any[]>({ queryKey: ["email-lists"], queryFn: () => api("/api/email/lists") });
  const { data, isLoading } = useQuery<any>({ queryKey: ["email-contacts", q, listId, status], queryFn: () => api(`/api/email/contacts?q=${encodeURIComponent(q)}&listId=${listId ?? ""}&status=${status}&limit=200`) });
  const setStat = useMutation({ mutationFn: ({ id, s }: { id: number; s: string }) => api(`/api/email/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ status: s }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["email-contacts"] }) });
  const delList = useMutation({ mutationFn: (id: number) => api(`/api/email/lists/${id}`, { method: "DELETE" }), onSuccess: () => { setListId(null); qc.invalidateQueries({ queryKey: ["email-lists"] }); } });
  const S: Record<string, string> = { active: "نشط", unsubscribed: "ألغى", bounced: "ارتدّ", complained: "بلّغ" };
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <div className="grid lg:grid-cols-[16rem_1fr] gap-4">
      {openId && <ContactDrawer id={openId} onClose={() => setOpenId(null)} />}
      <div className={cn(card, "p-3 space-y-1 h-fit")}>
        <button onClick={() => setListId(null)} className={cn("w-full text-right px-2 py-1.5 rounded text-xs", listId === null ? "bg-muted" : "hover:bg-muted/50")}>كل جهات الاتصال</button>
        {lists.map((l) => (
          <div key={l.id} className="group flex items-center gap-1">
            <button onClick={() => setListId(l.id)} className={cn("flex-1 text-right px-2 py-1.5 rounded text-xs truncate", listId === l.id ? "bg-muted" : "hover:bg-muted/50")}>{l.name} <span className="text-muted-foreground">({l.count})</span></button>
            <button onClick={() => confirm("حذف القائمة؟ (جهات الاتصال تبقى)") && delList.mutate(l.id)} className="p-1 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400" /></button>
          </div>
        ))}
      </div>
      <div className={cn(card)}>
        <div className="p-3 border-b border-card-border flex gap-2 flex-wrap">
          <input className={cn(input, "flex-1 min-w-[10rem]")} placeholder="بحث بالبريد أو الشركة" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={cn(input, "w-36")} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">كل الحالات</option>{Object.entries(S).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <span className="text-xs text-muted-foreground self-center">{data?.total ?? 0}</span>
        </div>
        <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
          {isLoading ? <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div> :
          <table className="w-full text-[11px]"><thead className="sticky top-0 bg-card"><tr className="text-muted-foreground"><th className="text-right p-2">البريد</th><th className="text-right p-2">الشركة</th><th className="text-right p-2">النشاط / المدينة</th><th className="text-right p-2">الحالة</th><th className="text-right p-2">آخر إرسال</th><th className="text-right p-2">فتح</th><th className="text-right p-2">ردّ</th><th></th></tr></thead>
            <tbody>{(data?.rows ?? []).map((c: any) => (
              <tr key={c.id} className="border-t border-card-border">
                <td className="p-2 font-mono cursor-pointer hover:text-primary" dir="ltr" onClick={() => setOpenId(c.id)}>{c.email}{c.mxOk === false && <span title="النطاق لا يستقبل بريداً" className="text-red-400"> ✗</span>}</td>
                <td className="p-2">{c.company ?? c.name ?? ""}</td><td className="p-2 text-muted-foreground">{[c.industry, c.city].filter(Boolean).join(" · ")}</td>
                <td className="p-2"><span className={cn("px-1.5 py-0.5 rounded", c.status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{S[c.status] ?? c.status}</span></td>
                <td className="p-2 text-muted-foreground">{ago(c.lastSentAt)}</td><td className="p-2 text-muted-foreground">{ago(c.lastOpenedAt)}</td><td className="p-2 text-muted-foreground">{ago(c.lastRepliedAt)}</td>
                <td className="p-2">{c.status === "active" ? <button onClick={() => setStat.mutate({ id: c.id, s: "unsubscribed" })} className="text-[10px] text-muted-foreground hover:text-red-400">أوقف</button> : <button onClick={() => setStat.mutate({ id: c.id, s: "active" })} className="text-[10px] text-muted-foreground hover:text-primary">فعّل</button>}</td>
              </tr>))}</tbody></table>}
        </div>
      </div>
    </div>
  );
}

// ── Campaigns ─────────────────────────────────────────────────────
function Campaigns() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState<{ name: string; listId: string; subject: string; html: string; subjectB?: string; abPct?: number; abWaitHours?: number } | null>(null);
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["email-campaigns"], queryFn: () => api("/api/email/campaigns"), refetchInterval: 10_000 });
  const { data: lists = [] } = useQuery<any[]>({ queryKey: ["email-lists"], queryFn: () => api("/api/email/lists") });
  const { data: templates = [] } = useQuery<any[]>({ queryKey: ["email-templates"], queryFn: () => api("/api/email/templates") });
  const inv = () => qc.invalidateQueries({ queryKey: ["email-campaigns"] });
  const create = useMutation({ mutationFn: (b: any) => api("/api/email/campaigns", { method: "POST", body: JSON.stringify(b) }), onSuccess: () => { setForm(null); inv(); toast.success("أُنشئت كمسودة"); }, onError: (e: Error) => toast.error(e.message) });
  const start = useMutation({ mutationFn: (id: number) => api(`/api/email/campaigns/${id}/start`, { method: "POST" }), onSuccess: (d: any) => { inv(); toast.success(`في الطابور ${d.queued} رسالة`); }, onError: (e: Error) => toast.error(e.message) });
  const pause = useMutation({ mutationFn: (id: number) => api(`/api/email/campaigns/${id}/pause`, { method: "POST" }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/email/campaigns/${id}`, { method: "DELETE" }), onSuccess: inv });
  const ST: Record<string, string> = { draft: "مسودة", scheduled: "مجدولة", sending: "تُرسل", paused: "متوقفة", completed: "اكتملت" };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><p className="text-sm text-muted-foreground">رسالة واحدة لقائمة كاملة، بحصة الساعة واليوم وساعات العمل. للمتابعة المتدرّجة استخدم «المتابعة».</p>
        <button onClick={() => setForm({ name: "", listId: String(lists[0]?.id ?? ""), subject: "", html: "" })} className={primary}><Plus className="w-3.5 h-3.5" /> حملة جديدة</button></div>
      {form && (
        <div className={cn(card, "p-4 space-y-3")}>
          <div className="grid md:grid-cols-3 gap-3">
            <div><label className="text-xs font-semibold block mb-1.5">الاسم</label><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="text-xs font-semibold block mb-1.5">القائمة</label><select className={input} value={form.listId} onChange={(e) => setForm({ ...form, listId: e.target.value })}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}</select></div>
            <div><label className="text-xs font-semibold block mb-1.5">من قالب</label><select className={input} defaultValue="" onChange={(e) => { const t = templates.find((x) => String(x.id) === e.target.value); if (t) setForm({ ...form, subject: t.subject, html: t.html, name: form.name || t.name }); }}><option value="">—</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          </div>
          <div><label className="text-xs font-semibold block mb-1.5">العنوان</label><input className={input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="{{company}} و…" /></div>
          <div className="grid md:grid-cols-[1fr_8rem_8rem] gap-3">
            <div><label className="text-xs font-semibold block mb-1.5">عنوان بديل للاختبار (اختياري)</label><input className={input} value={form.subjectB ?? ""} onChange={(e) => setForm({ ...form, subjectB: e.target.value })} placeholder="يُرسل لنصف شريحة الاختبار" /></div>
            <div><label className="text-xs font-semibold block mb-1.5">شريحة الاختبار %</label><input type="number" className={input} value={form.abPct ?? 20} onChange={(e) => setForm({ ...form, abPct: Number(e.target.value) })} /></div>
            <div><label className="text-xs font-semibold block mb-1.5">انتظار (ساعات)</label><input type="number" className={input} value={form.abWaitHours ?? 4} onChange={(e) => setForm({ ...form, abWaitHours: Number(e.target.value) })} /></div>
          </div>
          {form.subjectB && <p className="text-[11px] text-muted-foreground">نصف الشريحة يأخذ العنوان الأول والنصف الآخر البديل؛ بعد الانتظار يُرسل الباقي بالعنوان الذي فُتح أكثر. لا اختبار لقائمة أقل من ٤٠.</p>}
          <div><label className="text-xs font-semibold block mb-1.5">المحتوى (HTML — تُقبل {"{{name}} {{first_name}} {{company}} {{city}} {{sender}}"})</label><textarea className={ta} value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} /></div>
          <div className="flex gap-2"><button onClick={() => create.mutate({ ...form, listId: Number(form.listId) })} disabled={create.isPending} className={primary}>احفظ كمسودة</button><button onClick={() => setForm(null)} className={ghost}>إلغاء</button><PreviewButton subject={form.subject} html={form.html} /></div>
        </div>
      )}
      <div className={cn(card, "divide-y divide-card-border")}>
        {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">لا حملات بعد.</p>}
        {rows.map((c) => (
          <div key={c.id} className="p-3.5">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="font-semibold text-sm hover:text-primary">{c.name}</button>
              <span className={cn("text-[10px] px-2 py-0.5 rounded border", c.status === "sending" ? "border-primary/40 text-primary" : "border-card-border text-muted-foreground")}>{ST[c.status] ?? c.status}</span>
              <span className="text-[11px] text-muted-foreground">{c.listName ?? "بلا قائمة"} · أُرسل {c.sentCount} · فُتح {c.openCount} · نقر {c.clickCount} · ردّ {c.replyCount} · ارتدّ {c.bounceCount}</span>
              <div className="mr-auto flex gap-1.5">
                {["draft", "paused", "scheduled"].includes(c.status) && <button onClick={() => start.mutate(c.id)} className={ghost}><Play className="w-3 h-3" /> ابدأ</button>}
                {c.status === "sending" && <button onClick={() => pause.mutate(c.id)} className={ghost}><Pause className="w-3 h-3" /> أوقف</button>}
                <button onClick={() => confirm("حذف الحملة؟") && del.mutate(c.id)} className={ghost}><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            {c.pauseReason && <p className="text-[11px] text-yellow-400 mt-1">{c.pauseReason}</p>}
            {open === c.id && <CampaignDetail id={c.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignDetail({ id }: { id: number }) {
  const { data } = useQuery<any>({ queryKey: ["email-campaign", id], queryFn: () => api(`/api/email/campaigns/${id}`), refetchInterval: 10_000 });
  if (!data) return <Loader2 className="w-4 h-4 animate-spin mt-2 text-muted-foreground" />;
  const f = data.funnel ?? {};
  const total = (f.sent ?? 0) + (f.queued ?? 0) + (f.failed ?? 0);
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
        {[["في الطابور", f.queued], ["أُرسل", f.sent], ["فُتح", f.opened], ["نقر", f.clicked], ["ردّ", f.replied], ["ارتدّ", f.bounced], ["فشل", f.failed]].map(([l, v]) => (
          <div key={String(l)} className="rounded-lg border border-card-border p-2"><p className="text-[10px] text-muted-foreground">{l}</p><p className="text-lg font-bold leading-none mt-1">{v ?? 0}</p></div>
        ))}
      </div>
      {total > 0 && <div className="h-2 rounded-full bg-muted overflow-hidden" dir="ltr"><div className="h-full bg-primary" style={{ width: `${Math.round(((f.sent ?? 0) / total) * 100)}%` }} /></div>}
      {data.ab && (
        <div className="rounded-lg border border-card-border p-3 text-xs space-y-1">
          <p className="font-semibold">اختبار العنوان {data.ab.winner ? `— الفائز ${data.ab.winner}` : f.held ? `— ${f.held} ينتظرون الحسم` : ""}</p>
          {(data.ab.variants ?? []).map((v: any) => (
            <p key={v.variant} className={cn(data.ab.winner === v.variant && "text-primary")}>
              {v.variant}: «{v.variant === "B" ? data.campaign.subjectB : data.campaign.subject}» — أُرسل {v.sent} · فتح {v.sent ? Math.round((v.opened / v.sent) * 100) : 0}% · رد {v.replied}
            </p>
          ))}
        </div>
      )}
      <div className="max-h-72 overflow-y-auto"><table className="w-full text-[11px]"><thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="text-right p-1.5">إلى</th><th className="text-right p-1.5">الشركة</th><th className="text-right p-1.5">الحالة</th><th className="text-right p-1.5">أُرسل</th><th className="text-right p-1.5"><Eye className="w-3 h-3 inline" /></th><th className="text-right p-1.5"><MousePointerClick className="w-3 h-3 inline" /></th><th className="text-right p-1.5"><Reply className="w-3 h-3 inline" /></th></tr></thead>
        <tbody>{(data.recipients ?? []).map((r: any) => <tr key={r.id} className="border-t border-card-border"><td className="p-1.5 font-mono" dir="ltr">{r.toEmail}</td><td className="p-1.5">{r.company ?? r.name ?? ""}</td><td className={cn("p-1.5", r.status === "bounced" || r.status === "failed" ? "text-red-400" : "")}>{r.status}{r.error ? ` — ${String(r.error).slice(0, 60)}` : ""}</td><td className="p-1.5 text-muted-foreground">{ago(r.sentAt)}</td><td className="p-1.5">{r.openCount || ""}</td><td className="p-1.5">{r.clickCount || ""}</td><td className="p-1.5">{r.repliedAt ? "✓" : ""}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function PreviewButton({ subject, html }: { subject: string; html: string }) {
  const [p, setP] = useState<any>(null);
  return (
    <>
      <button onClick={async () => { try { setP(await api("/api/email/preview", { method: "POST", body: JSON.stringify({ subject, html }) })); } catch (e: any) { toast.error(e.message); } }} className={ghost}><Eye className="w-3 h-3" /> معاينة</button>
      {p && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setP(null)}>
        <div className="bg-white text-black rounded-xl max-w-2xl w-full max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
          <div className="p-3 border-b text-sm font-semibold" dir="rtl">{p.subject}</div>
          <iframe title="preview" srcDoc={p.html} className="w-full h-[70vh]" />
        </div></div>}
    </>
  );
}

// ── Sequences ─────────────────────────────────────────────────────
function Sequences() {
  const qc = useQueryClient();
  const { data: seqs = [] } = useQuery<any[]>({ queryKey: ["email-seqs"], queryFn: () => api("/api/email/sequences"), refetchInterval: 15_000 });
  const { data: lists = [] } = useQuery<any[]>({ queryKey: ["email-lists"], queryFn: () => api("/api/email/lists") });
  const [edit, setEdit] = useState<any | null>(null);
  const [enrolList, setEnrolList] = useState<Record<number, string>>({});
  const inv = () => qc.invalidateQueries({ queryKey: ["email-seqs"] });
  const save = useMutation({ mutationFn: (s: any) => s.id ? api(`/api/email/sequences/${s.id}`, { method: "PATCH", body: JSON.stringify(s) }) : api("/api/email/sequences", { method: "POST", body: JSON.stringify(s) }), onSuccess: () => { setEdit(null); inv(); toast.success("حُفظ"); }, onError: (e: Error) => toast.error(e.message) });
  const toggle = useMutation({ mutationFn: (s: any) => api(`/api/email/sequences/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !s.isActive }) }), onSuccess: inv });
  const enrol = useMutation({ mutationFn: ({ id, listId }: { id: number; listId: number }) => api(`/api/email/sequences/${id}/enrol`, { method: "POST", body: JSON.stringify({ listId }) }), onSuccess: (d: any) => { inv(); toast.success(`سُجّل ${d.enrolled} (${d.skipped} تُخطّوا)`); }, onError: (e: Error) => toast.error(e.message) });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/email/sequences/${id}`, { method: "DELETE" }), onSuccess: inv });
  const seed = useMutation({ mutationFn: () => api("/api/email/templates/seed", { method: "POST" }), onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ["email-templates"] }); toast.success("ثُبّتت القوالب الجاهزة"); } });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">سلّم رسائل بمواعيد: تتوقف فور أن يردّ، ولا تُرسل لمن ارتدّ بريده أو ألغى.</p>
        <div className="flex gap-2"><button onClick={() => seed.mutate()} className={ghost}><Sparkles className="w-3.5 h-3.5" /> القوالب الجاهزة (AML)</button>
          <button onClick={() => setEdit({ name: "", steps: [{ afterHours: 0, subject: "", html: "" }], stopOnReply: true, stopOnOpen: false })} className={primary}><Plus className="w-3.5 h-3.5" /> تسلسل جديد</button></div>
      </div>
      {edit && (
        <div className={cn(card, "p-4 space-y-3")}>
          <input className={input} placeholder="اسم التسلسل" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          {edit.steps.map((s: any, i: number) => (
            <div key={i} className="rounded-lg border border-card-border p-3 space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs font-semibold">الخطوة {i + 1}</span><span className="text-[11px] text-muted-foreground">بعد</span><input type="number" className={cn(input, "w-24")} value={s.afterHours} onChange={(e) => { const st = [...edit.steps]; st[i] = { ...s, afterHours: Number(e.target.value) }; setEdit({ ...edit, steps: st }); }} /><span className="text-[11px] text-muted-foreground">ساعة من التسجيل</span>
                <button onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_: any, j: number) => j !== i) })} className="mr-auto text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></div>
              <input className={input} placeholder="العنوان" value={s.subject} onChange={(e) => { const st = [...edit.steps]; st[i] = { ...s, subject: e.target.value }; setEdit({ ...edit, steps: st }); }} />
              <textarea className={ta} placeholder="HTML" value={s.html} onChange={(e) => { const st = [...edit.steps]; st[i] = { ...s, html: e.target.value }; setEdit({ ...edit, steps: st }); }} />
              <PreviewButton subject={s.subject} html={s.html} />
            </div>
          ))}
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setEdit({ ...edit, steps: [...edit.steps, { afterHours: (edit.steps.at(-1)?.afterHours ?? 0) + 72, subject: "", html: "" }] })} className={ghost}><Plus className="w-3 h-3" /> خطوة</button>
            <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={edit.stopOnReply} onChange={(e) => setEdit({ ...edit, stopOnReply: e.target.checked })} /> توقف عند الرد</label>
            <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={edit.stopOnOpen} onChange={(e) => setEdit({ ...edit, stopOnOpen: e.target.checked })} /> توقف عند الفتح</label>
            <button onClick={() => save.mutate(edit)} disabled={save.isPending} className={cn(primary, "mr-auto")}>احفظ</button><button onClick={() => setEdit(null)} className={ghost}>إلغاء</button>
          </div>
        </div>
      )}
      <div className={cn(card, "divide-y divide-card-border")}>
        {seqs.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">لا تسلسلات بعد — اضغط «القوالب الجاهزة» لتثبيت تسلسل AML.</p>}
        {seqs.map((s) => (
          <div key={s.id} className="p-3.5 flex items-center gap-3 flex-wrap">
            <button onClick={() => setEdit({ ...s })} className="font-semibold text-sm hover:text-primary">{s.name}</button>
            <span className={cn("text-[10px] px-2 py-0.5 rounded border", s.isActive ? "border-primary/40 text-primary" : "border-card-border text-muted-foreground")}>{s.isActive ? "يعمل" : "موقوف"}</span>
            <span className="text-[11px] text-muted-foreground">{(s.steps ?? []).length} خطوات · {s.pending} مجدولة · {s.sent} أُرسلت</span>
            <div className="mr-auto flex gap-1.5 items-center">
              <select className={cn(input, "w-44 text-xs")} value={enrolList[s.id] ?? ""} onChange={(e) => setEnrolList({ ...enrolList, [s.id]: e.target.value })}><option value="">اختر قائمة…</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}</select>
              <button disabled={!enrolList[s.id]} onClick={() => enrol.mutate({ id: s.id, listId: Number(enrolList[s.id]) })} className={ghost}><Play className="w-3 h-3" /> سجّل القائمة</button>
              <button onClick={() => toggle.mutate(s)} className={ghost}>{s.isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}</button>
              <button onClick={() => confirm("حذف التسلسل؟") && del.mutate(s.id)} className={ghost}><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────
function Templates() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["email-templates"], queryFn: () => api("/api/email/templates") });
  const [edit, setEdit] = useState<any | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ["email-templates"] });
  const save = useMutation({ mutationFn: (t: any) => t.id ? api(`/api/email/templates/${t.id}`, { method: "PATCH", body: JSON.stringify(t) }) : api("/api/email/templates", { method: "POST", body: JSON.stringify(t) }), onSuccess: () => { setEdit(null); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/email/templates/${id}`, { method: "DELETE" }), onSuccess: inv });
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setEdit({ name: "", subject: "", html: "", category: "" })} className={primary}><Plus className="w-3.5 h-3.5" /> قالب</button></div>
      {edit && <div className={cn(card, "p-4 space-y-2")}>
        <div className="grid md:grid-cols-2 gap-2"><input className={input} placeholder="الاسم" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /><input className={input} placeholder="التصنيف" value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
        <input className={input} placeholder="العنوان" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
        <textarea className={ta} value={edit.html} onChange={(e) => setEdit({ ...edit, html: e.target.value })} />
        <div className="flex gap-2"><button onClick={() => save.mutate(edit)} className={primary}>احفظ</button><button onClick={() => setEdit(null)} className={ghost}>إلغاء</button><PreviewButton subject={edit.subject} html={edit.html} /></div>
      </div>}
      <div className={cn(card, "divide-y divide-card-border")}>
        {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">لا قوالب — «القوالب الجاهزة» في تبويب المتابعة تثبّت قوالب AML.</p>}
        {rows.map((t) => <div key={t.id} className="p-3.5 flex items-center gap-3"><button onClick={() => setEdit({ ...t })} className="font-semibold text-sm hover:text-primary">{t.name}</button><span className="text-[11px] text-muted-foreground truncate flex-1">{t.subject}</span>{t.category && <span className="text-[10px] px-2 py-0.5 rounded bg-muted">{t.category}</span>}<button onClick={() => del.mutate(t.id)} className={ghost}><Trash2 className="w-3 h-3" /></button></div>)}
      </div>
    </div>
  );
}

// ── Inbox ─────────────────────────────────────────────────────────
function InboxTab() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<any[]>({ queryKey: ["email-inbound"], queryFn: () => api("/api/email/inbound"), refetchInterval: 15_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  const inv = () => qc.invalidateQueries({ queryKey: ["email-inbound"] });
  const redraft = useMutation({ mutationFn: (id: number) => api(`/api/email/inbound/${id}/draft`, { method: "POST" }), onSuccess: (d: any) => { setDraft({ subject: d.subject, body: d.body }); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const send = useMutation({ mutationFn: (id: number) => api(`/api/email/inbound/${id}/send`, { method: "POST", body: JSON.stringify(draft) }), onSuccess: () => { inv(); toast.success("أُرسل الرد"); setOpen(null); }, onError: (e: Error) => toast.error(e.message) });
  const ignore = useMutation({ mutationFn: (id: number) => api(`/api/email/inbound/${id}/ignore`, { method: "POST" }), onSuccess: inv });
  const hold = useMutation({ mutationFn: (id: number) => api(`/api/email/inbound/${id}/hold`, { method: "POST" }), onSuccess: () => { inv(); toast.success("لن يُرسل تلقائياً — ينتظرك"); } });
  const poll = useMutation({ mutationFn: () => api("/api/email/settings/poll", { method: "POST" }), onSuccess: (d: any) => { inv(); toast.success(d.lastError ? `خطأ: ${d.lastError}` : `قُرئت ${d.handled} رسالة`); }, onError: (e: Error) => toast.error(e.message) });
  const INTENT: Record<string, string> = { interested: "مهتم", question: "سؤال", not_interested: "غير مهتم", complaint: "شكوى", opt_out: "إيقاف", greeting: "تحية", unclear: "غير واضح" };
  const cur = rows.find((r) => r.id === open);
  useEffect(() => { if (cur) setDraft({ subject: cur.draftSubject ?? `Re: ${cur.subject ?? ""}`, body: cur.draftReply ?? "" }); }, [open]);

  return (
    <div className="grid lg:grid-cols-[22rem_1fr] gap-4">
      <div className={cn(card, "max-h-[40rem] overflow-y-auto")}>
        <div className="p-3 border-b border-card-border flex items-center justify-between"><p className="text-sm font-semibold">الردود الواردة</p><button onClick={() => poll.mutate()} disabled={poll.isPending} className={ghost}>{poll.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} اقرأ الآن</button></div>
        {rows.length === 0 && <p className="p-6 text-xs text-muted-foreground text-center">لا ردود بعد. تُقرأ من صندوق IMAP كل دقيقتين، أو تصل عبر webhook المزوّد.</p>}
        {rows.map((r) => (
          <button key={r.id} onClick={() => setOpen(r.id)} className={cn("w-full text-right p-3 border-b border-card-border hover:bg-muted/40", open === r.id && "bg-muted/60", r.state === "ignored" && "opacity-50")}>
            <div className="flex items-center gap-2"><span className="text-xs font-semibold truncate">{r.company ?? r.fromName ?? r.fromEmail}</span><span className={cn("text-[10px] px-1.5 rounded", r.intent === "interested" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{INTENT[r.intent] ?? r.intent ?? ""}</span><span className="text-[10px] text-muted-foreground mr-auto">{ago(r.receivedAt)}</span></div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{r.summary ?? r.subject ?? ""}</p>
            <p className="text-[10px] mt-0.5">{r.state === "sent" ? <span className="text-green-400">رُدّ عليه</span> : r.state === "drafted" ? <span className="text-blue-400">مسودة جاهزة</span> : r.state === "ignored" ? "متجاهَل" : <span className="text-yellow-400">جديد</span>}</p>
          </button>
        ))}
      </div>
      <div className={cn(card, "p-4 space-y-3")}>
        {!cur ? <p className="text-sm text-muted-foreground text-center py-10">اختر رداً.</p> : <>
          <div><p className="text-sm font-semibold">{cur.fromName ?? ""} <span className="font-mono text-xs text-muted-foreground" dir="ltr">&lt;{cur.fromEmail}&gt;</span>{cur.company ? ` — ${cur.company}` : ""}</p>
            <p className="text-[11px] text-muted-foreground">{cur.subject}{cur.ourSubject ? ` · ردّاً على «${cur.ourSubject}»` : ""}</p></div>
          {cur.summary && <p className="text-xs rounded-lg bg-muted/50 p-2.5"><span className="text-muted-foreground">ماذا يريد: </span>{cur.summary}</p>}
          <pre className="text-xs whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto rounded-lg border border-card-border p-3" dir="auto">{cur.text}</pre>
          <div className="flex items-center gap-2"><p className="text-xs font-semibold">ردّ هال</p><button onClick={() => redraft.mutate(cur.id)} disabled={redraft.isPending} className={ghost}>{redraft.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {cur.draftReply ? "أعد الصياغة" : "اكتب مسودة"}</button></div>
          <input className={input} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <textarea className={cn(input, "min-h-[12rem] leading-relaxed")} dir="auto" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="المسودة تظهر هنا — عدّلها ثم أرسل" />
          {cur.autoSendAt && cur.state === "drafted" && (
            <p className="text-[11px] text-blue-400">سيُرسل تلقائياً {new Date(cur.autoSendAt).toLocaleTimeString("ar-AE", { hour: "2-digit", minute: "2-digit" })} — عدّله وأرسله بنفسك، أو <button onClick={() => hold.mutate(cur.id)} className="underline">أوقف الإرسال التلقائي</button>.</p>
          )}
          <div className="flex gap-2"><button onClick={() => send.mutate(cur.id)} disabled={send.isPending || !draft.body.trim() || cur.state === "sent"} className={primary}><Send className="w-3.5 h-3.5" /> أرسل الرد</button><button onClick={() => ignore.mutate(cur.id)} className={ghost}>تجاهل</button></div>
        </>}
      </div>
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────
function SettingsTab() {
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ["email-settings"], queryFn: () => api("/api/email/settings") });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data && !f) setF({ provider: "smtp", smtpPort: 587, imapPort: 993, hourlyCap: 40, dailyCap: 300, tracking: true, ...(data.settings ?? {}) }); }, [data]);
  const save = useMutation({ mutationFn: (b: any) => api("/api/email/settings", { method: "PUT", body: JSON.stringify(b) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["email-settings"] }); qc.invalidateQueries({ queryKey: ["email-overview"] }); toast.success("حُفظت"); }, onError: (e: Error) => toast.error(e.message) });
  const test = useMutation({ mutationFn: () => api("/api/email/settings/test", { method: "POST" }), onSuccess: (d: any) => toast[d.ok ? "success" : "error"](d.detail) });
  const testSend = useMutation({ mutationFn: () => api("/api/email/settings/test-send", { method: "POST", body: JSON.stringify({}) }), onSuccess: () => toast.success("أُرسلت رسالة اختبار إلى عنوانك"), onError: (e: Error) => toast.error(e.message) });
  const [dns, setDns] = useState<any>(null);
  const checkDns = useMutation({ mutationFn: () => api("/api/email/settings/dns"), onSuccess: setDns, onError: (e: Error) => toast.error(e.message) });
  if (!f) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  const L = ({ l, k, type = "text", ph = "" }: { l: string; k: string; type?: string; ph?: string }) => (
    <div><label className="text-xs font-semibold block mb-1.5">{l}</label><input type={type} className={input} value={f[k] ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, [k]: type === "number" ? Number(e.target.value) : e.target.value })} dir={/pass|host|user|email|key/i.test(k) ? "ltr" : undefined} /></div>
  );
  return (
    <div className="space-y-4">
      <div className={cn(card, "p-4 space-y-3")}>
        <p className="text-sm font-semibold">المُرسِل</p>
        <div className="grid md:grid-cols-3 gap-3">
          <div><label className="text-xs font-semibold block mb-1.5">الطريقة</label><select className={input} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}><option value="smtp">SMTP (Google Workspace / Microsoft 365 / Hostinger / Zoho)</option><option value="resend">Resend API</option><option value="brevo">Brevo API</option></select></div>
          <L l="اسم المُرسِل" k="fromName" ph="بروكاونت للمحاسبة" /><L l="بريد المُرسِل" k="fromEmail" ph="hello@procount.ae" />
        </div>
        {f.provider === "smtp" ? <div className="grid md:grid-cols-4 gap-3"><L l="SMTP host" k="smtpHost" ph="smtp.gmail.com" /><L l="المنفذ" k="smtpPort" type="number" /><L l="المستخدم" k="smtpUser" /><L l="كلمة المرور / App password" k="smtpPass" type="password" /></div>
          : <L l="API key" k="apiKey" type="password" />}
        <div className="grid md:grid-cols-4 gap-3"><L l="Reply-To (اختياري)" k="replyTo" /><L l="حصة الساعة" k="hourlyCap" type="number" /><L l="حصة اليوم" k="dailyCap" type="number" />
          <label className="text-xs flex items-center gap-2 pt-6"><input type="checkbox" checked={!!f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.checked })} /> تتبّع الفتح والنقر</label></div>
        <div><label className="text-xs font-semibold block mb-1.5">التوقيع (HTML)</label><textarea className={cn(input, "min-h-[5rem] text-xs")} value={f.signature ?? ""} onChange={(e) => setF({ ...f, signature: e.target.value })} placeholder="{{sender}}<br>بروكاونت للمحاسبة<br>+971 …" /></div>
        <p className="text-[11px] text-muted-foreground">ابدأ بحصة صغيرة (٤٠ في الساعة، ٣٠٠ في اليوم) لعنوان جديد وارفعها بعد أسبوعين من ارتداد منخفض. الإرسال داخل ساعات العمل فقط.</p>
      </div>
      <div className={cn(card, "p-4 space-y-3")}>
        <p className="text-sm font-semibold">العمل الذاتي</p>
        <label className="text-xs flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={f.warmup !== false} onChange={(e) => setF({ ...f, warmup: e.target.checked })} />
          <span><b>إحماء المُرسِل</b> — عنوان جديد يبدأ بـ٥٠ رسالة يومياً ويزيد ٣٠٪ يومياً حتى حصة اليوم التي كتبتها. مزوّدو البريد يحكمون على المُرسِل من أسابيعه الأولى.</span></label>
        <label className="text-xs flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={!!f.autoReply} onChange={(e) => setF({ ...f, autoReply: e.target.checked })} />
          <span><b>الرد التلقائي</b> — يُرسل هال مسودته وحده بعد تأخير، على الأسئلة والاهتمام والتحية فقط. الشكوى والرفض ينتظرانك دائماً، وتستطيع إيقاف أي رد قبل إرساله.</span></label>
        {f.autoReply && <div className="w-48"><label className="text-xs font-semibold block mb-1.5">التأخير (دقائق، ± عشوائي)</label><input type="number" className={input} value={f.autoReplyDelayMin ?? 12} onChange={(e) => setF({ ...f, autoReplyDelayMin: Number(e.target.value) })} /></div>}
      </div>
      <div className={cn(card, "p-4 space-y-3")}>
        <p className="text-sm font-semibold">قراءة الردود (IMAP)</p>
        <div className="grid md:grid-cols-4 gap-3"><L l="IMAP host" k="imapHost" ph="imap.gmail.com" /><L l="المنفذ" k="imapPort" type="number" /><L l="المستخدم" k="imapUser" /><L l="كلمة المرور" k="imapPass" type="password" /></div>
        <p className="text-[11px] text-muted-foreground">يُقرأ صندوق الوارد كل دقيقتين؛ كل رد يُصنَّف ويُلخَّص ويكتب هال مسودة الرد. {data?.settings?.imapLastError && <span className="text-red-400">آخر خطأ: {data.settings.imapLastError}</span>}
          {data?.settings?.inboundToken && <> · أو وجّه webhook المزوّد إلى <code dir="ltr">{data.trackingBase ?? ""}/api/email/inbound/{data.settings.inboundToken}</code> (والارتدادات إلى <code dir="ltr">/api/email/events/{data.settings.inboundToken}</code>).</>}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => save.mutate(f)} disabled={save.isPending} className={primary}>{save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} احفظ</button>
        <button onClick={() => test.mutate()} disabled={test.isPending} className={ghost}>اختبر الاتصال</button>
        <button onClick={() => testSend.mutate()} disabled={testSend.isPending} className={ghost}><Send className="w-3 h-3" /> أرسل رسالة اختبار لنفسي</button>
        <button onClick={() => checkDns.mutate()} disabled={checkDns.isPending} className={ghost}>افحص SPF / DKIM / DMARC</button>
      </div>
      {dns && (
        <div className={cn(card, "p-4 space-y-2 text-xs")}>
          <p className="font-semibold">{dns.domain}</p>
          {[["SPF", dns.spf.ok, dns.spf.note], ["DKIM", dns.dkim.found, dns.dkim.note], ["DMARC", dns.dmarc.ok, dns.dmarc.note], ["MX", dns.mx.found, dns.mx.found ? dns.mx.hosts.join(", ") : "لا سجلات MX — النطاق لا يستقبل بريداً"]].map(([n, ok, note]) => (
            <p key={String(n)} className="flex gap-2"><span className={ok ? "text-primary" : "text-red-400"}>{ok ? "✓" : "✗"}</span><b className="w-14">{n}</b><span className="text-muted-foreground" dir="auto">{note}</span></p>
          ))}
          <p className="text-[11px] text-muted-foreground">بدون الثلاثة تصل رسائلك إلى «غير المرغوب» أو لا تصل. تُضاف من لوحة DNS لنطاقك.</p>
        </div>
      )}
    </div>
  );
}

// ── One company, everything that happened with it ────────────────
function ContactDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useQuery<any>({ queryKey: ["email-contact", id], queryFn: () => api(`/api/email/contacts/${id}`), refetchInterval: 15_000 });
  const c = data?.contact;
  type Item = { at: string; kind: string; text: string; cls?: string };
  const items: Item[] = [];
  for (const m of data?.messages ?? []) {
    if (m.sentAt) items.push({ at: m.sentAt, kind: "أُرسلت", text: m.subject });
    if (m.openedAt) items.push({ at: m.openedAt, kind: "فتح", text: `${m.subject}${m.openCount > 1 ? ` (${m.openCount} مرات)` : ""}`, cls: "text-blue-400" });
    if (m.clickedAt) items.push({ at: m.clickedAt, kind: "نقر", text: m.subject, cls: "text-primary" });
    if (m.bouncedAt) items.push({ at: m.bouncedAt, kind: "ارتدّت", text: m.error ?? m.subject, cls: "text-red-400" });
    if (m.status === "failed") items.push({ at: m.createdAt, kind: "فشلت", text: m.error ?? "", cls: "text-red-400" });
  }
  for (const i of data?.inbound ?? []) items.push({ at: i.receivedAt, kind: "ردّ", text: i.summary ?? i.text?.slice(0, 160) ?? "", cls: "text-green-400" });
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const pending = (data?.jobs ?? []).filter((j: any) => j.status === "pending");
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-start" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-background border-l border-card-border overflow-y-auto p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        {!c ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <>
          <div>
            <p className="font-bold">{c.company ?? c.name ?? c.email}</p>
            <p className="text-xs font-mono text-muted-foreground" dir="ltr">{c.email}{c.phone ? ` · +${c.phone}` : ""}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{[c.name, c.industry, c.city, c.source].filter(Boolean).join(" · ")}</p>
          </div>
          {pending.length > 0 && <div className="rounded-lg border border-card-border p-3 text-xs"><p className="font-semibold mb-1">المتابعات المجدولة</p>{pending.map((j: any) => <p key={j.id} className="text-muted-foreground">الخطوة {j.stepIndex + 1} — {new Date(j.dueAt).toLocaleString("ar-AE", { dateStyle: "short", timeStyle: "short" })}</p>)}</div>}
          <div className="space-y-2">
            {items.length === 0 ? <p className="text-xs text-muted-foreground">لم يحدث شيء بعد.</p> : items.map((it, i) => (
              <div key={i} className="text-xs border-r-2 border-card-border pr-2"><span className={cn("font-semibold", it.cls)}>{it.kind}</span> <span className="text-muted-foreground">{ago(it.at)}</span><p className="text-muted-foreground">{it.text}</p></div>
            ))}
          </div>
        </>}
      </div>
    </div>
  );
}
