// ── Knowledge for the email section ───────────────────────────────
// One place for everything نورة should know before she writes: the company
// card (shared with the whole team), the documents the owner uploads — PDF,
// Word, Excel, text — each read in the background into facts, and a box to
// ask her a question and see what she answers and from where.

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, BookOpen, Building2, CheckCircle2, FileText, FileSpreadsheet, FileType, Loader2, MessageCircleQuestion,
  Pencil, Plus, RefreshCw, Save, Search, Trash2, Upload, X, ClipboardPaste, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "@/components/AgentPanel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";
const primary = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-primary text-primary-foreground disabled:opacity-40";
const n = (v?: number | null) => (v ?? 0).toLocaleString("ar-SA");
const size = (chars: number) => chars > 1000 ? `${n(Math.round(chars / 1000))} ألف حرف` : `${n(chars)} حرف`;

const CAT_HINT: Record<string, string> = {
  company: "من نحن، الترخيص، الفريق، الفروع، لماذا نحن",
  services: "الخدمات، الباقات، الأسعار، المدد، ما يشمله كل عرض",
  sector: "ما يقلق العقارات أو الذهب أو غيرها، ومن هو صاحب القرار",
  compliance: "قوانين AML، المهل، الغرامات، متطلبات goAML",
  faq: "الأسئلة المتكررة والاعتراضات وردودنا عليها",
  style: "رسائل نجحت، العبارات التي نستخدمها والتي لا نستخدمها",
  other: "أي شيء آخر",
};
const fileIcon = (name?: string | null) => !name ? ClipboardPaste : /\.(xlsx|xls|csv)$/i.test(name) ? FileSpreadsheet : /\.pdf$/i.test(name) ? FileType : FileText;

export function KnowledgeTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["email-knowledge"], queryFn: () => api("/api/email/knowledge"),
    refetchInterval: (q) => ((q.state.data as any)?.stats?.processing ? 4000 : false),
  });
  const { data: sectorList } = useQuery<any>({ queryKey: ["email-sectors"], queryFn: () => api("/api/email/sectors") });
  const sectors: string[] = sectorList?.sectors ?? [];
  const cats: Record<string, string> = data?.categories ?? {};
  const inv = () => { qc.invalidateQueries({ queryKey: ["email-knowledge"] }); qc.invalidateQueries({ queryKey: ["email-agent"] }); };

  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const docs: any[] = data?.docs ?? [];
  const shown = useMemo(() => docs.filter((d) => (cat === "all" || d.category === cat) && (!q.trim() || `${d.title} ${d.preview}`.toLowerCase().includes(q.toLowerCase()))), [docs, cat, q]);

  const del = useMutation({ mutationFn: (id: number) => api(`/api/email/knowledge/${id}`, { method: "DELETE" }), onSuccess: () => { inv(); toast.success("حُذف المستند وما تعلّمته منه"); } });
  const relearn = useMutation({ mutationFn: (id: number) => api(`/api/email/knowledge/${id}/learn`, { method: "POST" }), onSuccess: () => { inv(); toast.success("تقرأه نورة من جديد"); } });

  const s = data?.stats ?? {};
  return (
    <div className="space-y-4">
      {openId && <DocDrawer id={openId} cats={cats} sectors={sectors} onClose={() => setOpenId(null)} onChanged={inv} />}
      <div className={cn(card, "p-4 flex items-start gap-3")}>
        <BookOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-sm">مكتبة المعرفة — كل ما يجب أن تعرفه نورة قبل أن تكتب</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">ارفع ملفات الشركة والمجال: بروفايل الشركة، الخدمات والأسعار، قوانين AML، ما يقلق كل قطاع، رسائل نجحت. نورة تقرأ كل مستند وتستخرج منه الحقائق، وحين تكتب حملة أو ترد على عميل تأخذ الحقائق والمقاطع التي تخص الموضوع وقطاع العميل — ولا تذكر رقماً أو سعراً ليس هنا.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[["مستندات", n(s.docs)], ["حقائق تعرفها نورة", n(s.facts), "text-primary"], ["حجم المكتبة", size(s.chars ?? 0)], ["قطاعات مغطاة", n((data?.bySector ?? []).filter((x: any) => x.key !== "عام").length)]].map(([l, v, tone]) => (
          <div key={l} className={cn(card, "p-3")}><p className="text-[10px] text-muted-foreground">{l}</p><p className={cn("text-xl font-bold leading-none mt-1.5", tone)}>{v}</p></div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_22rem] gap-4 items-start">
        <div className="space-y-4">
          <Uploader cats={cats} sectors={sectors} onDone={inv} />

          <div className={card}>
            <div className="p-3 border-b border-card-border flex gap-2 flex-wrap items-center">
              <div className="relative flex-1 min-w-[10rem]">
                <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input className={cn(input, "pr-8")} placeholder="ابحث في المستندات" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="flex gap-1 flex-wrap">
                {[["all", "الكل"], ...Object.entries(cats)].map(([k, label]) => {
                  const c = k === "all" ? docs.length : docs.filter((d) => d.category === k).length;
                  if (k !== "all" && !c) return null;
                  return <button key={k} onClick={() => setCat(k)} className={cn("px-2.5 py-1 rounded-full border text-[11px]", cat === k ? "border-primary bg-primary/15 text-primary" : "border-card-border text-muted-foreground")}>{label} ({c})</button>;
                })}
              </div>
            </div>
            {isLoading ? <div className="p-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-muted-foreground" /></div>
            : !docs.length ? (
              <div className="p-10 text-center">
                <BookOpen className="w-9 h-9 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">المكتبة فارغة</p>
                <p className="text-xs text-muted-foreground mt-1">ابدأ ببروفايل الشركة وقائمة الخدمات والأسعار — هذان أكثر ما تحتاجه نورة.</p>
              </div>
            ) : (
              <div className="divide-y divide-card-border">
                {shown.map((d) => {
                  const Icon = fileIcon(d.fileName);
                  return (
                    <div key={d.id} className="p-3 flex items-start gap-3 hover:bg-muted/20">
                      <Icon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setOpenId(d.id)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm truncate hover:text-primary">{d.title}</p>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{cats[d.category] ?? d.category}</span>
                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full border", d.sector ? "border-primary/30 text-primary" : "border-card-border text-muted-foreground")}>{d.sector ?? "كل القطاعات"}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{d.preview}</p>
                        <p className="text-[10px] mt-1 flex items-center gap-1.5">
                          {d.status === "processing" ? <><Loader2 className="w-3 h-3 animate-spin text-primary" /><span className="text-primary">نورة تقرأه…</span></>
                            : d.status === "failed" ? <><AlertTriangle className="w-3 h-3 text-yellow-400" /><span className="text-yellow-400">{d.error ?? "تعذّرت القراءة"}</span></>
                            : <><CheckCircle2 className="w-3 h-3 text-primary" /><span className="text-muted-foreground">{n(d.facts)} حقيقة</span></>}
                          <span className="text-muted-foreground">· {size(d.chars)} · {new Date(d.createdAt).toLocaleDateString("ar-AE")}</span>
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {d.status !== "processing" && <button title="أعد القراءة" onClick={() => relearn.mutate(d.id)} className="p-1.5 text-muted-foreground hover:text-primary"><RefreshCw className="w-3.5 h-3.5" /></button>}
                        <button title="حذف" onClick={() => confirm(`حذف «${d.title}» وكل ما تعلّمته نورة منه؟`) && del.mutate(d.id)} className="p-1.5 text-muted-foreground hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  );
                })}
                {!shown.length && <p className="p-6 text-center text-xs text-muted-foreground">لا مستند يطابق.</p>}
              </div>
            )}
          </div>

          <LooseFacts facts={data?.loose ?? []} sectors={sectors} onChanged={inv} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-4">
          <CompanyCard />
          <AskNora sectors={sectors} />
          {(data?.bySector ?? []).length > 0 && (
            <div className={cn(card, "p-3")}>
              <p className="text-xs font-semibold mb-2">ما تعرفه لكل قطاع</p>
              <div className="space-y-1.5">
                {data.bySector.map((x: any) => (
                  <div key={x.key} className="text-[11px]">
                    <div className="flex justify-between"><span>{x.key}</span><span className="text-muted-foreground">{n(x.n)} حقيقة</span></div>
                    <div className="h-1 rounded-full bg-muted mt-0.5 overflow-hidden" dir="ltr"><div className="h-full bg-primary/70" style={{ width: `${(x.n / Math.max(1, s.facts)) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Uploading ────────────────────────────────────────────────────
function Uploader({ cats, sectors, onDone }: { cats: Record<string, string>; sectors: string[]; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState("company");
  const [sector, setSector] = useState("");
  const [paste, setPaste] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const add = (list: FileList | null) => { if (list) setFiles((f) => [...f, ...Array.from(list)].slice(0, 20)); };

  const send = async () => {
    if (!files.length && !text.trim()) { toast.error("اختر ملفات أو الصق نصاً"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      fd.append("category", category);
      if (sector) fd.append("sector", sector);
      if (paste && text.trim()) { fd.append("text", text); fd.append("title", title); }
      const r = await fetch(`${BASE}/api/email/knowledge`, { method: "POST", body: fd, credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "تعذّر الرفع");
      toast.success(`أُضيف ${n(d.added.length)} مستند — نورة تقرأها الآن`);
      for (const f of d.failed ?? []) toast.error(`${f.file}: ${f.error}`);
      setFiles([]); setText(""); setTitle(""); setPaste(false);
      onDone();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className={cn(card, "p-4 space-y-3")}>
      <p className="font-semibold text-sm flex items-center gap-2"><Upload className="w-4 h-4 text-primary" /> أضف معرفة</p>
      {!paste ? (
        <div onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          className={cn("rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors", over ? "border-primary bg-primary/5" : "border-card-border hover:border-primary/50")}>
          <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.html,.htm" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <Upload className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium mt-2">اسحب الملفات هنا أو اضغط للاختيار</p>
          <p className="text-[11px] text-muted-foreground mt-1">PDF · Word (.docx) · Excel · CSV · نص — حتى ٢٠ ملفاً معاً</p>
        </div>
      ) : (
        <div className="space-y-2">
          <input className={input} placeholder="عنوان — مثلاً: باقات خدمات AML 2026" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={cn(input, "min-h-[10rem] text-xs leading-relaxed")} placeholder="الصق النص هنا: معلومات الشركة، الأسعار، القوانين، رسالة نجحت…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => {
            const Icon = fileIcon(f.name);
            return <span key={i} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-muted"><Icon className="w-3 h-3" />{f.name}<button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="w-3 h-3 text-muted-foreground" /></button></span>;
          })}
        </div>
      )}
      <div>
        <p className="text-[11px] text-muted-foreground mb-1.5">نوع المحتوى</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(cats).map(([k, label]) => (
            <button key={k} onClick={() => setCategory(k)} title={CAT_HINT[k]} className={cn("px-2.5 py-1 rounded-full border text-[11px]", category === k ? "border-primary bg-primary/15 text-primary" : "border-card-border text-muted-foreground hover:text-foreground")}>{label}</button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{CAT_HINT[category]}</p>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <select className={cn(input, "w-52 text-xs")} value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">يخص كل القطاعات</option>{sectors.map((x) => <option key={x} value={x}>يخص قطاع: {x}</option>)}
        </select>
        <button onClick={() => setPaste(!paste)} className={ghost}>{paste ? <><Upload className="w-3.5 h-3.5" /> رفع ملفات بدلاً من ذلك</> : <><ClipboardPaste className="w-3.5 h-3.5" /> الصق نصاً</>}</button>
        <button onClick={send} disabled={busy || (!files.length && !text.trim())} className={cn(primary, "mr-auto")}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} أضف وعلّم نورة{files.length ? ` (${n(files.length)})` : ""}
        </button>
      </div>
    </div>
  );
}

// ── One document ─────────────────────────────────────────────────
function DocDrawer({ id, cats, sectors, onClose, onChanged }: { id: number; cats: Record<string, string>; sectors: string[]; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ["email-knowledge-doc", id], queryFn: () => api(`/api/email/knowledge/${id}`) });
  const [tab, setTab] = useState<"facts" | "text">("facts");
  const inv = () => { qc.invalidateQueries({ queryKey: ["email-knowledge-doc", id] }); onChanged(); };
  const patch = useMutation({ mutationFn: (b: any) => api(`/api/email/knowledge/${id}`, { method: "PATCH", body: JSON.stringify(b) }), onSuccess: inv });
  const editFact = useMutation({ mutationFn: ({ fid, content }: { fid: number; content: string }) => api(`/api/email/agent/memory/${fid}`, { method: "PATCH", body: JSON.stringify({ content }) }), onSuccess: inv });
  const delFact = useMutation({ mutationFn: (fid: number) => api(`/api/email/agent/memory/${fid}`, { method: "DELETE" }), onSuccess: inv });
  const doc = data?.doc;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-start" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-card border-l border-card-border overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {!doc ? <div className="p-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2"><p className="font-bold">{doc.title}</p>
                  <button onClick={() => { const v = prompt("عنوان المستند", doc.title); if (v?.trim()) patch.mutate({ title: v.trim() }); }} className="text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button></div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{doc.fileName ?? "نص ملصق"} · {size(doc.chars)}</p>
              </div>
              <button onClick={onClose}><X className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-2">
              <select className={cn(input, "text-xs")} value={doc.category} onChange={(e) => patch.mutate({ category: e.target.value })}>{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select className={cn(input, "text-xs")} value={doc.sector ?? ""} onChange={(e) => patch.mutate({ sector: e.target.value || null })}><option value="">كل القطاعات</option>{sectors.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </div>
            <div className="flex gap-1 border-b border-card-border">
              {([["facts", `ما تعلّمته (${n(data.facts.length)})`], ["text", "النص"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cn("px-3 py-2 text-xs border-b-2 -mb-px", tab === k ? "border-primary" : "border-transparent text-muted-foreground")}>{l}</button>
              ))}
            </div>
            {tab === "facts" ? (
              !data.facts.length ? <p className="text-xs text-muted-foreground">{doc.status === "processing" ? "نورة تقرأه الآن…" : "لم تُستخرج حقائق بعد — اضغط «أعد القراءة» من القائمة."}</p> : (
                <div className="space-y-1.5">{data.facts.map((f: any) => (
                  <div key={f.id} className="group rounded-lg border border-card-border p-2.5 text-xs leading-relaxed flex gap-2">
                    <p className="flex-1">{f.topic && <span className="text-[10px] text-primary ml-1">[{f.topic}]</span>}{f.content}</p>
                    <span className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0">
                      <button onClick={() => { const v = prompt("عدّل الحقيقة", f.content); if (v?.trim()) editFact.mutate({ fid: f.id, content: v.trim() }); }}><Pencil className="w-3 h-3 text-muted-foreground" /></button>
                      <button onClick={() => delFact.mutate(f.id)}><Trash2 className="w-3 h-3 text-red-400" /></button>
                    </span>
                  </div>
                ))}</div>
              )
            ) : (
              <pre className="whitespace-pre-wrap text-xs leading-relaxed font-sans bg-muted/30 rounded-lg p-3 max-h-[70vh] overflow-y-auto">{doc.content}{doc.truncated ? "\n\n… (يُعرض أول ٦٠ ألف حرف فقط — المستند محفوظ كاملاً)" : ""}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Facts typed in by hand (and those taught before the library) ─
function LooseFacts({ facts, sectors, onChanged }: { facts: any[]; sectors: string[]; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const add = useMutation({ mutationFn: () => api("/api/email/agent/memory", { method: "POST", body: JSON.stringify({ content: text, topic: topic || null }) }), onSuccess: () => { setText(""); onChanged(); toast.success("حفظتها نورة"); } });
  const del = useMutation({ mutationFn: (id: number) => api(`/api/email/agent/memory/${id}`, { method: "DELETE" }), onSuccess: onChanged });
  return (
    <div className={cn(card, "p-4 space-y-3")}>
      <p className="font-semibold text-sm flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> معلومة سريعة</p>
      <div className="flex gap-2 flex-wrap">
        <input className={cn(input, "flex-1 min-w-[14rem]")} placeholder="مثلاً: نقدّم فحص امتثال مجاني أول مرة لشركات الوساطة" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) add.mutate(); }} />
        <select className={cn(input, "w-40 text-xs")} value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">عامة</option>{sectors.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <button onClick={() => add.mutate()} disabled={!text.trim() || add.isPending} className={primary}><Save className="w-3.5 h-3.5" /> احفظ</button>
      </div>
      {facts.length > 0 && (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {facts.map((f) => (
            <div key={f.id} className="group flex gap-2 text-xs py-1.5 border-t border-card-border">
              <p className="flex-1">{f.topic && <span className="text-[10px] text-primary ml-1">[{f.topic}]</span>}{f.content}</p>
              <button onClick={() => del.mutate(f.id)} className="opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── The company card (business profile, shared with the whole team) ─
function CompanyCard() {
  const qc = useQueryClient();
  const { data: profile } = useQuery<any>({ queryKey: ["business-profile"], queryFn: () => api("/api/knowledge/profile") });
  const [edit, setEdit] = useState<any | null>(null);
  // The whole profile goes back, so fields this card does not show (the
  // WhatsApp auto-reply switch) keep their value.
  const save = useMutation({
    mutationFn: () => api("/api/knowledge/profile", { method: "PUT", body: JSON.stringify({ ...(profile ?? {}), ...edit }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["business-profile"] }); setEdit(null); toast.success("حُفظت بطاقة الشركة — يستخدمها كل الفريق"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const p = edit ?? profile ?? {};
  return (
    <div className={cn(card, "p-4 space-y-2.5")}>
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-primary" /><p className="font-semibold text-sm">بطاقة الشركة</p>
        {!edit && <button onClick={() => setEdit({ name: profile?.name ?? "", industry: profile?.industry ?? "", description: profile?.description ?? "", guardrails: profile?.guardrails ?? "" })} className="mr-auto text-[11px] text-primary flex items-center gap-1"><Pencil className="w-3 h-3" /> تعديل</button>}
      </div>
      {edit ? (
        <div className="space-y-2">
          <input className={input} placeholder="اسم الشركة — بروكاونت للمحاسبة" value={p.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <input className={input} placeholder="المجال — محاسبة وامتثال AML" value={p.industry} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} />
          <textarea className={cn(input, "min-h-[6rem] text-xs")} placeholder="من نحن وماذا نقدّم ولمن — في فقرة" value={p.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <textarea className={cn(input, "min-h-[4rem] text-xs")} placeholder="ما لا يُقال أبداً — مثلاً: لا نعد بنتيجة تفتيش، لا نذكر أسعاراً قبل معرفة الحجم" value={p.guardrails} onChange={(e) => setEdit({ ...edit, guardrails: e.target.value })} />
          <div className="flex gap-2"><button onClick={() => save.mutate()} disabled={save.isPending} className={primary}><Save className="w-3.5 h-3.5" /> احفظ</button><button onClick={() => setEdit(null)} className={ghost}>إلغاء</button></div>
        </div>
      ) : profile?.name || profile?.description ? (
        <div className="text-xs space-y-1.5">
          <p className="font-medium">{profile.name}{profile.industry ? <span className="text-muted-foreground"> — {profile.industry}</span> : null}</p>
          {profile.description && <p className="text-muted-foreground leading-relaxed line-clamp-5">{profile.description}</p>}
          {profile.guardrails && <p className="text-[11px] text-yellow-400/90 leading-relaxed">⛔ {profile.guardrails}</p>}
        </div>
      ) : <p className="text-xs text-muted-foreground">اكتب اسم الشركة ومن أنتم وما لا يُقال — نورة وكل الفريق يبدؤون منها.</p>}
    </div>
  );
}

// ── Asking her ───────────────────────────────────────────────────
function AskNora({ sectors }: { sectors: string[] }) {
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const ask = useMutation({ mutationFn: () => api("/api/email/knowledge/ask", { method: "POST", body: JSON.stringify({ question: q, sector: sector || null }) }), onError: (e: Error) => toast.error(e.message) });
  const r: any = ask.data;
  return (
    <div className={cn(card, "p-4 space-y-2.5")}>
      <p className="font-semibold text-sm flex items-center gap-2"><MessageCircleQuestion className="w-4 h-4 text-primary" /> اختبر نورة</p>
      <p className="text-[11px] text-muted-foreground">اسألها ما سيسأله العميل — تجيب مما في المكتبة فقط، وتقول إن لم تعرف.</p>
      <textarea className={cn(input, "min-h-[4rem] text-xs")} placeholder="كم سعر باقة الامتثال لشركة وساطة صغيرة؟" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-2">
        <select className={cn(input, "text-xs")} value={sector} onChange={(e) => setSector(e.target.value)}><option value="">بلا قطاع</option>{sectors.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <button onClick={() => ask.mutate()} disabled={!q.trim() || ask.isPending} className={primary}>{ask.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} اسألها</button>
      </div>
      {r && (
        <div className="rounded-lg bg-muted/40 p-3 space-y-2">
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{r.answer}</p>
          {r.sources?.length > 0 && (
            <div className="border-t border-card-border pt-2 space-y-1">
              {r.sources.map((s: any) => <p key={s.n} className="text-[10px] text-muted-foreground"><b>[{s.n}]</b> {s.title}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
