import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Download, RefreshCw, CheckSquare, Square, Search,
  Users, MessageSquare, Phone, Calendar, Import,
  Wifi, WifiOff, CheckCheck, Send, ChevronDown,
  FileSpreadsheet, Layers, MessageCircle, Hash,
  MessagesSquare, Save, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────
interface ContactEntry {
  phone: string;
  name?: string;
  lastMessageAt: number;
  source: "phonebook" | "chat";
}
interface ExtractorData {
  connected: boolean;
  total: number;
  contacts: ContactEntry[];
}
interface ConvEntry {
  phone: string;
  name: string | null;
  lastText: string;
  lastAt: number;
  msgCount: number;
  source?: string;
}
interface ConvData {
  total: number;
  conversations: ConvEntry[];
}
interface MsgEntry {
  phone: string;
  name: string | null;
  lastText: string;
  count: number;
  lastAt: number;
}
interface MsgData {
  total: number;
  messages: MsgEntry[];
}
interface StatsData {
  db: { contacts: number; conversations: number; incoming: number };
  connected: boolean;
  status: string;
}

// ── API helpers ───────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiFetch = (path: string) =>
  fetch(`${BASE}${path}`, { credentials: "include" }).then(r => { if (!r.ok) throw new Error(); return r.json(); });

// ── Date presets ──────────────────────────────────────────────────
const now = () => Math.floor(Date.now() / 1000);
const DATE_PRESETS = [
  { label: "الكل",        since: 0 as number | (() => number) },
  { label: "اليوم",       since: () => { const d = new Date(); d.setHours(0,0,0,0); return Math.floor(d.getTime()/1000); } },
  { label: "أمس",         since: () => { const d = new Date(); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return Math.floor(d.getTime()/1000); } },
  { label: "آخر 3 أيام",  since: () => now() - 3 * 86400 },
  { label: "آخر أسبوع",   since: () => now() - 7 * 86400 },
  { label: "آخر شهر",     since: () => now() - 30 * 86400 },
];
function getSince(p: typeof DATE_PRESETS[0]) {
  return typeof p.since === "function" ? p.since() : p.since;
}
function fmtDate(ts: number) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const today = new Date(); today.setHours(0,0,0,0);
  const yest  = new Date(today); yest.setDate(yest.getDate()-1);
  const t = d.toLocaleTimeString("ar-SA", {hour:"2-digit",minute:"2-digit"});
  if (d >= today)  return `اليوم ${t}`;
  if (d >= yest)   return `أمس ${t}`;
  return d.toLocaleDateString("ar-SA", {year:"numeric",month:"short",day:"numeric"});
}

// ── Excel helper ──────────────────────────────────────────────────
function exportXlsx(rows: { phone: string; name?: string | null; lastText?: string; lastAt?: number }[], fileName: string) {
  const data = rows.map(r => ({
    "رقم الهاتف": `+${r.phone}`,
    "الاسم":      r.name ?? "",
    "آخر رسالة":  r.lastText ?? "",
    "التاريخ":    r.lastAt ? new Date(r.lastAt * 1000).toLocaleDateString("ar-SA") : "",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{wch:18},{wch:24},{wch:36},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الأرقام");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

const SPLIT = 1000;

async function importPhones(listName: string, phones: string[]) {
  const r = await fetch(`${BASE}/api/whatsapp/extractor/import`, {
    method: "POST", credentials: "include",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ listName, phones }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function splitImport(baseListName: string, phones: string[], onProgress?: (n:number,total:number) => void) {
  if (phones.length <= SPLIT) {
    const res = await importPhones(baseListName, phones);
    return { groups: 1, count: res.count, listName: res.listName };
  }
  const chunks = Math.ceil(phones.length / SPLIT);
  for (let i = 0; i < phones.length; i += SPLIT) {
    const batch = phones.slice(i, i + SPLIT);
    const g = Math.floor(i/SPLIT)+1;
    await importPhones(`${baseListName} - ${g}`, batch);
    onProgress?.(g, chunks);
  }
  return { groups: chunks, count: phones.length };
}

// ── Generic selectable list ───────────────────────────────────────
function useSelection<T extends {phone:string}>(items: T[]) {
  const [sel, setSel] = useState(new Set<string>());
  const allSel = items.length > 0 && items.every(i => sel.has(i.phone));
  const toggle   = (p: string) => setSel(s => { const n=new Set(s); n.has(p)?n.delete(p):n.add(p); return n; });
  const toggleAll = () => allSel
    ? setSel(s => { const n=new Set(s); items.forEach(i=>n.delete(i.phone)); return n; })
    : setSel(s => { const n=new Set(s); items.forEach(i=>n.add(i.phone)); return n; });
  const clear = () => setSel(new Set());
  return { sel, allSel, toggle, toggleAll, clear };
}

// ── Main component ────────────────────────────────────────────────
export default function WaExtractor() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // active tab: contacts | conversations | messages
  const [mainTab, setMainTab] = useState<"contacts"|"conversations"|"messages">("contacts");

  // contacts sub-tab
  const [subTab, setSubTab] = useState<"all"|"phonebook"|"chat">("all");
  const [preset, setPreset] = useState(DATE_PRESETS[0]);
  const [contactSearch, setContactSearch] = useState("");
  const [convSearch,    setConvSearch]    = useState("");
  const [msgSearch,     setMsgSearch]     = useState("");

  // import state
  const [showImport, setShowImport] = useState(false);
  const [listName,   setListName]   = useState("مستخرج من واتساب");
  const [convName,   setConvName]   = useState("محادثات واتساب");
  const [msgName,    setMsgName]    = useState("رسائل واردة");
  const [importing,  setImporting]  = useState(false);
  const [resyncing,  setResyncing]  = useState(false);
  const [savingAll,  setSavingAll]  = useState(false);
  const [saveAllName, setSaveAllName] = useState("");

  // data queries
  const { data, isLoading, isFetching, refetch } = useQuery<ExtractorData>({
    queryKey: ["wa-extractor"],
    queryFn: () => apiFetch("/api/whatsapp/extractor"),
    refetchInterval: 8_000,
  });
  const { data: convData, isLoading: convLoading, refetch: refetchConv } = useQuery<ConvData>({
    queryKey: ["wa-extractor-conv"],
    queryFn: () => apiFetch("/api/whatsapp/extractor/conversations"),
    refetchInterval: 15_000,
  });
  const { data: msgData, isLoading: msgLoading, refetch: refetchMsg } = useQuery<MsgData>({
    queryKey: ["wa-extractor-messages"],
    queryFn: () => apiFetch("/api/whatsapp/extractor/messages"),
    refetchInterval: 15_000,
  });
  const { data: statsData } = useQuery<StatsData>({
    queryKey: ["wa-extractor-stats"],
    queryFn: () => apiFetch("/api/whatsapp/extractor/stats"),
    refetchInterval: 4_000,
  });

  // filtered
  const since = getSince(preset);
  const filteredContacts = useMemo(() => {
    const list = data?.contacts ?? [];
    return list.filter(c => {
      if (subTab==="phonebook" && c.source!=="phonebook") return false;
      if (subTab==="chat"      && c.source!=="chat")      return false;
      if (since && c.lastMessageAt < since)                return false;
      if (contactSearch) {
        const q = contactSearch.toLowerCase();
        return c.phone.includes(q)||(c.name??"").toLowerCase().includes(q);
      }
      return true;
    });
  }, [data?.contacts, subTab, since, contactSearch]);

  const filteredConv = useMemo(() => {
    const list = convData?.conversations ?? [];
    if (!convSearch) return list;
    const q = convSearch.toLowerCase();
    return list.filter(c => c.phone.includes(q)||(c.name??"").toLowerCase().includes(q)||c.lastText.toLowerCase().includes(q));
  }, [convData?.conversations, convSearch]);

  const filteredMsg = useMemo(() => {
    const list = msgData?.messages ?? [];
    if (!msgSearch) return list;
    const q = msgSearch.toLowerCase();
    return list.filter(m => m.phone.includes(q)||(m.name??"").toLowerCase().includes(q)||m.lastText.toLowerCase().includes(q));
  }, [msgData?.messages, msgSearch]);

  // selections
  const cSel  = useSelection(filteredContacts);
  const cvSel = useSelection(filteredConv);
  const mSel  = useSelection(filteredMsg);

  // counts
  const totalPhonebook = (data?.contacts??[]).filter(c=>!since||c.lastMessageAt>=since).filter(c=>c.source==="phonebook").length;
  const totalChat      = (data?.contacts??[]).filter(c=>!since||c.lastMessageAt>=since).filter(c=>c.source==="chat").length;
  const totalAll       = (data?.contacts??[]).filter(c=>!since||c.lastMessageAt>=since).length;

  // save-all: حفظ كل الأرقام من DB في قائمة جديدة
  async function handleSaveAll() {
    setSavingAll(true);
    try {
      const name = saveAllName.trim() || `كل المحادثات ${new Date().toLocaleDateString("ar-SA")}`;
      const r = await fetch(`${BASE}/api/whatsapp/extractor/save-all`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listName: name }),
      });
      const data = await r.json();
      if (!r.ok) { toast.error(data.error ?? "فشل الحفظ"); return; }
      toast.success(`✅ تم حفظ ${data.count} رقم في قائمة "${data.listName}"`);
      setSaveAllName("");
      qc.invalidateQueries({ queryKey: ["contactGroups"] });
    } catch { toast.error("حدث خطأ أثناء الحفظ"); }
    finally { setSavingAll(false); }
  }

  // resync
  async function handleResync() {
    setResyncing(true);
    try {
      await fetch(`${BASE}/api/whatsapp/extractor/resync`, {method:"POST",credentials:"include",headers:{"Content-Type":"application/json"}});
      toast.success("جاري المزامنة — ستظهر البيانات خلال 30 ثانية");
      setTimeout(()=>{ refetch(); refetchConv(); refetchMsg(); setResyncing(false); }, 20_000);
    } catch { setResyncing(false); toast.error("فشلت المزامنة"); }
  }

  // generic import with auto-split
  async function doImport(phones: string[], baseName: string, onDone: ()=>void) {
    if (phones.length === 0) { toast.error("اختر أرقاماً أولاً"); return; }
    setImporting(true);
    try {
      const result = await splitImport(baseName, phones, (n,total) => {
        toast.info(`تم إنشاء المجموعة ${n} من ${total}`);
      });
      if (result.groups===1) {
        toast.success(`✅ تم استيراد ${result.count} رقم إلى قائمة "${(result as any).listName}"`);
      } else {
        toast.success(`✅ تم تقسيم ${result.count} رقم إلى ${result.groups} قوائم (1000 رقم/قائمة)`);
      }
      onDone();
      qc.invalidateQueries({ queryKey: ["contactGroups"] });
    } catch(e:any) { toast.error(e.message??"فشل الاستيراد"); }
    finally { setImporting(false); }
  }

  const contactPhones  = filteredContacts.filter(c=>cSel.sel.has(c.phone)).map(c=>c.phone);
  const convPhones     = filteredConv.filter(c=>cvSel.sel.has(c.phone)).map(c=>c.phone);
  const msgPhones      = filteredMsg.filter(m=>mSel.sel.has(m.phone)).map(m=>m.phone);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">مستخرج الأرقام</h1>
          <p className="text-sm text-muted-foreground mt-1">استخرج جهات الاتصال والمحادثات من واتساب المربوط واستوردها فوراً</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.connected && (
            <button onClick={handleResync} disabled={resyncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm hover:bg-primary/20 transition-colors disabled:opacity-50">
              <RefreshCw className={cn("w-4 h-4", resyncing&&"animate-spin")} />
              {resyncing ? "جاري المزامنة..." : "مزامنة كاملة"}
            </button>
          )}
          <button onClick={()=>{refetch();refetchConv();refetchMsg();}} disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors disabled:opacity-50">
            <RefreshCw className={cn("w-4 h-4", isFetching&&"animate-spin")} />
            تحديث
          </button>
        </div>
      </div>

      {/* Connection status */}
      {!isLoading && (
        <div className={cn("flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium w-fit",
          data?.connected ? "bg-green-500/10 text-green-400 border border-green-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20")}>
          {data?.connected ? <Wifi className="w-4 h-4"/> : <WifiOff className="w-4 h-4"/>}
          {data?.connected ? `واتساب متصل — تم اكتشاف ${data.total} رقم` : "واتساب غير متصل — قم بربط الواتساب أولاً"}
        </div>
      )}

      {/* DB live stats + save-all */}
      {statsData && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
          {/* counts row */}
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <span className="text-emerald-400 font-semibold text-xs">📊 في قاعدة البيانات الآن:</span>
            <span className="text-foreground">جهات الاتصال: <strong className="text-blue-300">{statsData.db.contacts.toLocaleString("ar")}</strong></span>
            <span className="text-foreground">المحادثات: <strong className="text-emerald-300">{statsData.db.conversations.toLocaleString("ar")}</strong></span>
            <span className="text-foreground">الرسائل الواردة: <strong className="text-amber-300">{statsData.db.incoming.toLocaleString("ar")}</strong></span>
          </div>

          {/* save-all button */}
          {(statsData.db.contacts > 0 || statsData.db.conversations > 0) ? (
            <div className="flex items-center gap-3 flex-wrap">
              <input
                value={saveAllName}
                onChange={e => setSaveAllName(e.target.value)}
                placeholder={`كل المحادثات ${new Date().toLocaleDateString("ar-SA")}`}
                className="flex-1 min-w-48 max-w-xs bg-input border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                dir="rtl"
              />
              <button
                onClick={handleSaveAll}
                disabled={savingAll}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 shadow-md"
              >
                {savingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savingAll ? "جاري الحفظ..." : `💾 حفظ كل الأرقام في قائمة (${(statsData.db.contacts + statsData.db.conversations).toLocaleString("ar")} رقم)`}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-orange-400 text-xs font-medium">
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
              قاعدة البيانات فارغة — اذهب لـ «ربط الواتساب» → اضغط «مزامنة كاملة (QR جديد)» → امسح QR مرة واحدة → ستظهر كل الأرقام هنا تلقائياً
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"إجمالي الأرقام",    v: data?.total??0,           icon:Phone,          color:"text-primary" },
          { label:"كل المحادثات",      v: convData?.total??0,        icon:MessagesSquare, color:"text-emerald-400" },
          { label:"جهات الاتصال",      v: totalPhonebook,            icon:Users,          color:"text-blue-400" },
          { label:"الرسائل الواردة",   v: msgData?.total??0,         icon:MessageCircle,  color:"text-amber-400" },
        ].map(({label,v,icon:Icon,color})=>(
          <div key={label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className={cn("p-2.5 rounded-lg bg-muted",color)}><Icon className="w-4 h-4"/></div>
            <div>
              <p className="text-2xl font-bold text-foreground">{v.toLocaleString("ar")}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-xl border border-border w-fit flex-wrap">
        {([
          { key:"contacts",      icon:Users,          label:"جهات الاتصال",  count:data?.total??0,        color:"bg-primary/15 text-primary" },
          { key:"conversations", icon:MessagesSquare, label:"كل المحادثات",  count:convData?.total??0,     color:"bg-emerald-500/15 text-emerald-400" },
          { key:"messages",      icon:MessageCircle,  label:"الرسائل الواردة",count:msgData?.total??0,     color:"bg-amber-500/15 text-amber-400" },
        ] as const).map(({key,icon:Icon,label,count,color})=>(
          <button key={key} onClick={()=>setMainTab(key)}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
              mainTab===key ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="w-4 h-4"/>
            {label}
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-mono",
              mainTab===key ? color : "bg-muted text-muted-foreground")}>
              {count.toLocaleString("ar")}
            </span>
          </button>
        ))}
      </div>

      {/* ═══════════════ CONTACTS TAB ═══════════════ */}
      {mainTab==="contacts" && (
        <>
          {/* date filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0"/>
            {DATE_PRESETS.map(p=>(
              <button key={p.label} onClick={()=>setPreset(p)}
                className={cn("px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                  preset.label===p.label ? "bg-primary text-primary-foreground border-primary"
                                         : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>
                {p.label}
              </button>
            ))}
          </div>

          {/* sub-tabs */}
          <div className="flex gap-1 bg-muted/40 p-1 rounded-lg w-fit border border-border">
            {([
              {key:"all",       label:"الكل",          count:totalAll},
              {key:"phonebook", label:"جهات الاتصال",   count:totalPhonebook},
              {key:"chat",      label:"المحادثات",       count:totalChat},
            ] as const).map(({key,label,count})=>(
              <button key={key} onClick={()=>setSubTab(key)}
                className={cn("px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
                  subTab===key ? "bg-background text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground")}>
                {label}
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-mono",
                  subTab===key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {count.toLocaleString("ar")}
                </span>
              </button>
            ))}
          </div>

          {/* search + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
              <input value={contactSearch} onChange={e=>setContactSearch(e.target.value)}
                placeholder="ابحث برقم أو اسم..." dir="rtl"
                className="w-full bg-input border border-border rounded-lg pr-9 pl-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"/>
            </div>
            <button onClick={cSel.toggleAll}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors">
              {cSel.allSel ? <CheckSquare className="w-4 h-4 text-primary"/> : <Square className="w-4 h-4 text-muted-foreground"/>}
              {cSel.allSel ? "إلغاء الكل" : `تحديد الكل (${filteredContacts.length.toLocaleString("ar")})`}
            </button>
            <button onClick={()=>{
              const rows = (cSel.sel.size>0 ? filteredContacts.filter(c=>cSel.sel.has(c.phone)) : filteredContacts);
              exportXlsx(rows.map(c=>({phone:c.phone,name:c.name,lastAt:c.lastMessageAt})), listName||"أرقام-واتساب");
              toast.success(`تم تصدير ${rows.length} رقم`);
            }} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-500/30 text-green-400 text-sm hover:bg-green-500/10 transition-colors">
              <FileSpreadsheet className="w-4 h-4"/>
              {cSel.sel.size>0 ? `تصدير ${cSel.sel.size} رقم` : "تصدير Excel"}
            </button>
            {cSel.sel.size>0 && (
              <button onClick={()=>setShowImport(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <Import className="w-4 h-4"/>
                استيراد {cSel.sel.size.toLocaleString("ar")} رقم
                {cSel.sel.size>SPLIT && <span className="text-[10px] opacity-75">(÷1000)</span>}
              </button>
            )}
          </div>

          {showImport && (
            <ImportPanel
              count={contactPhones.length} baseName={listName} setBaseName={setListName}
              importing={importing} splitSize={SPLIT}
              onConfirm={()=>doImport(contactPhones, listName, ()=>{cSel.clear();setShowImport(false);})}
              onCancel={()=>setShowImport(false)}/>
          )}

          <ContactsList items={filteredContacts} sel={cSel.sel} toggle={cSel.toggle} loading={isLoading} connected={!!data?.connected}/>
        </>
      )}

      {/* ═══════════════ CONVERSATIONS TAB ═══════════════ */}
      {mainTab==="conversations" && (
        <>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
            <p className="font-medium mb-1">سجل المحادثات — {(convData?.total ?? 0).toLocaleString("ar")} محادثة</p>
            <p className="text-emerald-400/70 text-xs">
              كل شخص أرسلتَ له أو استقبلتَ منه رسالة. تُحدَّث تلقائياً عند كل اتصال بواتساب وتبقى محفوظة في قاعدة البيانات دون الحاجة لمسح QR مجدداً.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
              <input value={convSearch} onChange={e=>setConvSearch(e.target.value)}
                placeholder="ابحث برقم أو اسم أو نص..." dir="rtl"
                className="w-full bg-input border border-border rounded-lg pr-9 pl-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"/>
            </div>
            <button onClick={cvSel.toggleAll}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors">
              {cvSel.allSel ? <CheckSquare className="w-4 h-4 text-primary"/> : <Square className="w-4 h-4 text-muted-foreground"/>}
              {cvSel.allSel ? "إلغاء الكل" : `تحديد الكل (${filteredConv.length.toLocaleString("ar")})`}
            </button>
            <button onClick={()=>{
              const rows = (cvSel.sel.size>0 ? filteredConv.filter(c=>cvSel.sel.has(c.phone)) : filteredConv);
              exportXlsx(rows.map(c=>({phone:c.phone,name:c.name,lastText:c.lastText,lastAt:c.lastAt})), convName||"محادثات");
              toast.success(`تم تصدير ${rows.length} رقم`);
            }} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-500/30 text-green-400 text-sm hover:bg-green-500/10 transition-colors">
              <FileSpreadsheet className="w-4 h-4"/>
              {cvSel.sel.size>0 ? `تصدير ${cvSel.sel.size} رقم` : "تصدير Excel"}
            </button>
            {cvSel.sel.size>0 && (
              <button onClick={()=>{
                doImport(convPhones, convName, ()=>{cvSel.clear();});
              }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-600/90 transition-colors">
                <Import className="w-4 h-4"/>
                استيراد {cvSel.sel.size.toLocaleString("ar")} رقم
                {cvSel.sel.size>SPLIT && <span className="text-[10px] opacity-75">(÷1000)</span>}
              </button>
            )}
          </div>

          {/* name for import */}
          {cvSel.sel.size>0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground flex-shrink-0">اسم القائمة:</span>
              <input value={convName} onChange={e=>setConvName(e.target.value)}
                placeholder="اسم القائمة..."
                className="flex-1 max-w-xs bg-input border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"/>
            </div>
          )}

          {/* table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="bg-muted/30 px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {filteredConv.length.toLocaleString("ar")} محادثة
                {cvSel.sel.size>0 && <span className="text-emerald-400 mr-2">• {cvSel.sel.size.toLocaleString("ar")} محدد</span>}
              </span>
              {cvSel.sel.size>0 && <button onClick={cvSel.clear} className="text-xs text-muted-foreground hover:text-foreground">إلغاء التحديد</button>}
            </div>
            {convLoading ? (
              <Loading/>
            ) : filteredConv.length===0 ? (
              <Empty icon={MessagesSquare} text={data?.connected ? "لا توجد محادثات بعد — امسح QR لمزامنة التاريخ" : "قم بربط الواتساب أولاً"}/>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {filteredConv.map(c=>{
                  const isSel = cvSel.sel.has(c.phone);
                  const initial = c.name?.[0]?.toUpperCase() ?? "#";
                  return (
                    <div key={c.phone} onClick={()=>cvSel.toggle(c.phone)}
                      className={cn("flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                        isSel ? "bg-emerald-500/8" : "hover:bg-muted/30")}>
                      <Checkbox checked={isSel} color="emerald"/>
                      <Avatar initial={initial} color="emerald"/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {c.name && <span className="text-sm font-medium text-foreground truncate">{c.name}</span>}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 flex-shrink-0 flex items-center gap-1">
                            <Hash className="w-2.5 h-2.5"/>{c.msgCount} رسالة
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono" dir="ltr">+{c.phone}</p>
                        {c.lastText && <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{c.lastText}</p>}
                      </div>
                      <p className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(c.lastAt)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════ MESSAGES TAB ═══════════════ */}
      {mainTab==="messages" && (
        <>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
            <p className="font-medium mb-1">الرسائل الواردة فقط — لإعادة الاستهداف</p>
            <p className="text-amber-400/70 text-xs">الأرقام التي راسلتك (أرسلوا إليك). لكل المحادثات استخدم تبويب "كل المحادثات".</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
              <input value={msgSearch} onChange={e=>setMsgSearch(e.target.value)}
                placeholder="ابحث برقم أو اسم أو نص الرسالة..." dir="rtl"
                className="w-full bg-input border border-border rounded-lg pr-9 pl-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"/>
            </div>
            <button onClick={mSel.toggleAll}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors">
              {mSel.allSel ? <CheckSquare className="w-4 h-4 text-primary"/> : <Square className="w-4 h-4 text-muted-foreground"/>}
              {mSel.allSel ? "إلغاء الكل" : `تحديد الكل (${filteredMsg.length.toLocaleString("ar")})`}
            </button>
            <button onClick={()=>{
              const rows = (mSel.sel.size>0 ? filteredMsg.filter(m=>mSel.sel.has(m.phone)) : filteredMsg);
              exportXlsx(rows.map(m=>({phone:m.phone,name:m.name,lastText:m.lastText,lastAt:m.lastAt})), msgName||"رسائل-واردة");
              toast.success(`تم تصدير ${rows.length} رقم`);
            }} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-500/30 text-green-400 text-sm hover:bg-green-500/10 transition-colors">
              <FileSpreadsheet className="w-4 h-4"/>
              {mSel.sel.size>0 ? `تصدير ${mSel.sel.size} رقم` : "تصدير Excel"}
            </button>
            {mSel.sel.size>0 && (
              <button onClick={()=>doImport(msgPhones, msgName, mSel.clear)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-500/90 transition-colors">
                <Import className="w-4 h-4"/>
                استيراد {mSel.sel.size.toLocaleString("ar")} رقم
                {mSel.sel.size>SPLIT && <span className="text-[10px] opacity-75">(÷1000)</span>}
              </button>
            )}
          </div>

          {mSel.sel.size>0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground flex-shrink-0">اسم القائمة:</span>
              <input value={msgName} onChange={e=>setMsgName(e.target.value)}
                placeholder="اسم القائمة..."
                className="flex-1 max-w-xs bg-input border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"/>
            </div>
          )}

          <div className="rounded-xl border border-border overflow-hidden">
            <div className="bg-muted/30 px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {filteredMsg.length.toLocaleString("ar")} جهة اتصال راسلتك
                {mSel.sel.size>0 && <span className="text-amber-400 mr-2">• {mSel.sel.size.toLocaleString("ar")} محدد</span>}
              </span>
              {mSel.sel.size>0 && <button onClick={mSel.clear} className="text-xs text-muted-foreground hover:text-foreground">إلغاء التحديد</button>}
            </div>
            {msgLoading ? (
              <Loading/>
            ) : filteredMsg.length===0 ? (
              <Empty icon={MessageCircle} text="لا توجد رسائل واردة بعد"/>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {filteredMsg.map(m=>{
                  const isSel = mSel.sel.has(m.phone);
                  return (
                    <div key={m.phone} onClick={()=>mSel.toggle(m.phone)}
                      className={cn("flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                        isSel ? "bg-amber-500/8" : "hover:bg-muted/30")}>
                      <Checkbox checked={isSel} color="amber"/>
                      <Avatar initial={m.name?.[0]?.toUpperCase()??"#"} color="amber"/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {m.name && <span className="text-sm font-medium text-foreground truncate">{m.name}</span>}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 flex-shrink-0 flex items-center gap-1">
                            <Hash className="w-2.5 h-2.5"/>{m.count} رسالة
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono" dir="ltr">+{m.phone}</p>
                        {m.lastText && <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{m.lastText}</p>}
                      </div>
                      <p className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(m.lastAt)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────
function Checkbox({checked, color}: {checked:boolean; color: string}) {
  const colors: Record<string,string> = {
    primary: "bg-primary border-primary",
    emerald: "bg-emerald-600 border-emerald-600",
    amber:   "bg-amber-500 border-amber-500",
  };
  return (
    <div className={cn("w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 transition-colors",
      checked ? colors[color]??"bg-primary border-primary" : "border-border")}>
      {checked && <CheckCheck className="w-2.5 h-2.5 text-white"/>}
    </div>
  );
}

function Avatar({initial, color}: {initial:string; color:string}) {
  const bg: Record<string,string> = {
    primary: "bg-primary/15 text-primary",
    emerald: "bg-emerald-500/15 text-emerald-400",
    amber:   "bg-amber-500/15 text-amber-400",
    blue:    "bg-blue-500/15 text-blue-400",
    purple:  "bg-purple-500/15 text-purple-400",
  };
  return (
    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold",
      bg[color]??"bg-muted text-muted-foreground")}>
      {initial}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
      <RefreshCw className="w-5 h-5 animate-spin"/>
      <span className="text-sm">جاري التحميل...</span>
    </div>
  );
}

function Empty({icon:Icon, text}:{icon:React.ElementType; text:string}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Icon className="w-10 h-10 opacity-20"/>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function ContactsList({items, sel, toggle, loading, connected}: {
  items: ContactEntry[]; sel:Set<string>; toggle:(p:string)=>void; loading:boolean; connected:boolean;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-muted/30 px-4 py-2.5 border-b border-border">
        <span className="text-xs text-muted-foreground">
          {items.length.toLocaleString("ar")} رقم
          {sel.size>0 && <span className="text-primary mr-2">• {sel.size.toLocaleString("ar")} محدد</span>}
        </span>
      </div>
      {loading ? <Loading/> : items.length===0 ? (
        <Empty icon={Phone} text={!connected ? "قم بربط الواتساب لبدء استخراج الأرقام" : "لا توجد أرقام مطابقة"}/>
      ) : (
        <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
          {items.map(c=>{
            const isSel = sel.has(c.phone);
            const color = c.source==="phonebook" ? "blue" : "purple";
            return (
              <div key={c.phone} onClick={()=>toggle(c.phone)}
                className={cn("flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                  isSel ? "bg-primary/8" : "hover:bg-muted/30")}>
                <Checkbox checked={isSel} color="primary"/>
                <Avatar initial={c.name?.[0]?.toUpperCase()??"#"} color={color}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {c.name && <span className="text-sm font-medium text-foreground truncate">{c.name}</span>}
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0",
                      c.source==="phonebook" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400")}>
                      {c.source==="phonebook" ? "جهة اتصال" : "محادثة"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono" dir="ltr">+{c.phone}</p>
                </div>
                <p className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(c.lastMessageAt)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ImportPanel({count, baseName, setBaseName, importing, splitSize, onConfirm, onCancel}: {
  count:number; baseName:string; setBaseName:(v:string)=>void;
  importing:boolean; splitSize:number; onConfirm:()=>void; onCancel:()=>void;
}) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <p className="text-sm font-medium text-foreground flex items-center gap-2">
        <Layers className="w-4 h-4 text-primary"/>
        استيراد <span className="text-primary font-bold">{count.toLocaleString("ar")}</span> رقم
        {count>splitSize && (
          <span className="text-yellow-400 text-xs">
            (يُقسَّم تلقائياً إلى {Math.ceil(count/splitSize)} قائمة)
          </span>
        )}
      </p>
      <div className="flex items-center gap-3">
        <input value={baseName} onChange={e=>setBaseName(e.target.value)} placeholder="اسم القائمة..."
          className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"/>
        <button onClick={onConfirm} disabled={importing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
          {importing ? <RefreshCw className="w-4 h-4 animate-spin"/> : <CheckCheck className="w-4 h-4"/>}
          {importing ? "جاري الاستيراد..." : "تأكيد"}
        </button>
        <button onClick={onCancel} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">إلغاء</button>
      </div>
    </div>
  );
}
