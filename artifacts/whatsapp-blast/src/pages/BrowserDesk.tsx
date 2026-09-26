import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Loader2, Globe, Search, X, MousePointerClick, Type, RefreshCw, ExternalLink,
  LogIn, Monitor, LayoutGrid, KeyRound, ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "@/components/AgentPanel";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";

const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return m < 1 ? "الآن" : m < 60 ? `${m}د` : `${Math.round(m / 60)}س`;
};

export default function BrowserDesk() {
  const qc = useQueryClient();
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [tick, setTick] = useState(0);
  const [brief, setBrief] = useState<string | null>(null);
  const [selector, setSelector] = useState("");
  const [value, setValue] = useState("");

  const { data: board } = useQuery<any>({ queryKey: ["board"], queryFn: () => api("/api/board") });
  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ["browser-sessions"], queryFn: () => api("/api/browser/sessions"), refetchInterval: 10_000,
  });
  const { data: fields = [] } = useQuery<any[]>({
    queryKey: ["browser-form", role, tick],
    queryFn: () => api(`/api/browser/${role}/form`),
    enabled: !!role && sessions.some((s) => s.role === role),
  });

  const team: any[] = board?.columns ?? [];
  useEffect(() => { if (!role && team.length) setRole(team[0].role); }, [team.length]);
  const mine = sessions.find((s) => s.role === role);
  const who = team.find((t) => t.role === role);

  // Only poll the screen while a headless session is showing something. A
  // visible window is on the owner's own display, and screenshotting it while
  // they type would be both pointless and intrusive.
  useEffect(() => {
    if (!mine || mine.visible) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 2_000);
    return () => window.clearInterval(t);
  }, [mine?.role, mine?.visible]);

  const open = useMutation({
    mutationFn: (visible: boolean) =>
      api(`/api/browser/${role}/open`, { method: "POST", body: JSON.stringify({ visible, url: url || undefined }) }),
    onSuccess: (_d, visible) => {
      toast[visible ? "info" : "success"](visible ? "فُتحت نافذة — سجّل دخولك فيها بنفسك" : "جاهز");
      setTick((t) => t + 1);
      qc.invalidateQueries({ queryKey: ["browser-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const read = useMutation({
    mutationFn: () => api(`/api/browser/${role}/read`, { method: "POST", body: JSON.stringify({ url }) }),
    onSuccess: (d: any) => { setBrief(null); setTick((t) => t + 1); toast.success(d.title || d.url); qc.invalidateQueries({ queryKey: ["browser-sessions"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const research = useMutation({
    mutationFn: () => api(`/api/browser/${role}/research`, { method: "POST", body: JSON.stringify({ url }) }),
    onSuccess: (d: any) => { setBrief(d.brief); setTick((t) => t + 1); qc.invalidateQueries({ queryKey: ["browser-sessions"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const act = useMutation({
    mutationFn: ({ kind, sel, val }: { kind: "fill" | "click"; sel?: string; val?: string }) =>
      api(`/api/browser/${role}/${kind}`, {
        method: "POST",
        body: JSON.stringify(kind === "fill"
          ? { selector: sel ?? selector, value: val ?? value }
          : { selector: sel ?? selector }),
      }),
    onSuccess: () => { setTick((t) => t + 1); toast.success("تم"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const close = useMutation({
    mutationFn: () => api(`/api/browser/${role}`, { method: "DELETE" }),
    onSuccess: () => { setBrief(null); qc.invalidateQueries({ queryKey: ["browser-sessions"] }); },
  });

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">مكتب التصفّح</h1>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            لكل موظف متصفّح خاص يحتفظ بتسجيل دخوله. سجّل دخولك مرة، ويبقى بعد إعادة التشغيل.
          </p>
        </div>
        <Link href="/board" className={ghost}><LayoutGrid className="w-3.5 h-3.5" /> لوحة الفريق</Link>
      </div>

      {/* Who has a browser open */}
      <div className={cn(card, "p-4")}>
        <p className="text-xs font-semibold mb-3">متصفّحات الفريق</p>
        <div className="flex flex-wrap gap-2">
          {team.map((t) => {
            const s = sessions.find((x) => x.role === t.role);
            return (
              <button key={t.role} onClick={() => { setRole(t.role); setBrief(null); }}
                className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors",
                  role === t.role ? "border-primary/50 bg-primary/10" : "border-card-border hover:border-primary/30")}>
                <span>{t.avatar}</span>
                <span>{t.name}</span>
                {s ? (
                  <span className={cn("flex items-center gap-1 text-[10px]", s.visible ? "text-yellow-400" : "text-primary")}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    {s.visible ? "نافذة مفتوحة" : ago(s.lastUsedAt)}
                  </span>
                ) : <span className="text-[10px] text-muted-foreground/50">مغلق</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* The address bar */}
      <div className={card}>
        <div className="p-4 flex gap-2 flex-wrap items-center border-b border-card-border">
          <span className="text-sm">{who?.avatar} <b>{who?.name}</b></span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr"
                 onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) read.mutate(); }}
                 placeholder="procount.ae" className={cn(input, "flex-1 min-w-[180px] font-mono text-xs")} />
          <button onClick={() => read.mutate()} disabled={!url.trim() || read.isPending || !role} className={ghost}>
            {read.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />} افتح
          </button>
          <button onClick={() => research.mutate()} disabled={!url.trim() || research.isPending || !role}
                  className={cn(ghost, "border-primary/40 text-primary")}>
            {research.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} ابحث وحلّل
          </button>
          {mine && <button onClick={() => close.mutate()} className={ghost}><X className="w-3.5 h-3.5" /> أغلق</button>}
        </div>

        {/* Signing in */}
        <div className="p-4 border-b border-card-border bg-muted/20 flex items-start gap-3 flex-wrap">
          <KeyRound className="w-4 h-4 text-yellow-400 shrink-0 mt-1" />
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs font-semibold">تسجيل الدخول لموقع</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              تُفتح نافذة كروم حقيقية أمامك، تسجّل دخولك فيها بيدك، ثم تغلقها. يحتفظ الموظف بالجلسة.
              كلمة مرورك لا تمرّ بهذا النظام إطلاقاً ولا يراها.
            </p>
          </div>
          <button onClick={() => open.mutate(true)} disabled={open.isPending || !role}
                  className={cn(ghost, "border-yellow-500/40 text-yellow-400 shrink-0")}>
            {open.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
            افتح نافذة لتسجيل الدخول
          </button>
        </div>

        {brief && (
          <div className="p-4 border-b border-card-border bg-primary/5">
            <p className="text-xs font-semibold mb-1.5">ما استخلصه قبل المحادثة:</p>
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{brief}</p>
          </div>
        )}

        {/* The screen */}
        {mine ? (
          mine.visible ? (
            <div className="p-8 text-center">
              <Monitor className="w-8 h-8 mx-auto text-yellow-400 mb-3" />
              <p className="text-sm">النافذة مفتوحة على شاشتك الآن</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-md mx-auto">
                سجّل دخولك فيها ثم أغلقها من هنا. بعدها يعمل {who?.name} بالجلسة نفسها في الخلفية.
              </p>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-card-border flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                <span className="truncate font-mono" dir="ltr">{mine.url}</span>
                <button onClick={() => setTick((t) => t + 1)} className="mr-auto shrink-0 hover:text-foreground">
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              <div className="bg-black/40 flex justify-center">
                <img src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/browser/${role}/screen?t=${tick}`}
                     alt="ما يراه الموظف" className="max-w-full"
                     onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.2"; }} />
              </div>
            </>
          )
        ) : (
          <p className="p-8 text-sm text-muted-foreground text-center">
            لا جلسة مفتوحة. اكتب عنواناً واضغط «افتح».
          </p>
        )}
      </div>

      {/* Form fields on the page */}
      {mine && !mine.visible && fields.length > 0 && (
        <div className={card}>
          <div className="p-4 border-b border-card-border">
            <p className="font-semibold text-sm flex items-center gap-1.5">
              <ListChecks className="w-4 h-4" /> حقول هذه الصفحة
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              املأها بنفسك. الموظف لا يملأ ولا يضغط من تلقائه — هذا قرارك أنت.
            </p>
          </div>
          <div className="p-4 space-y-2">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs w-40 shrink-0 truncate">{f.label || f.name || f.type}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0" dir="ltr">{f.type}</span>
                <input defaultValue={f.value} dir="auto"
                       onBlur={(e) => { if (e.target.value !== f.value && f.name) act.mutate({ kind: "fill", sel: `[name="${f.name}"]`, val: e.target.value }); }}
                       className={cn(input, "flex-1 min-w-[140px] text-xs")}
                       placeholder={f.required ? "مطلوب" : ""} />
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-card-border flex gap-2 flex-wrap items-center">
            <input value={selector} onChange={(e) => setSelector(e.target.value)} dir="ltr"
                   placeholder="button[type=submit]" className={cn(input, "flex-1 min-w-[160px] font-mono text-xs")} />
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="القيمة"
                   className={cn(input, "w-32 text-xs")} />
            <button onClick={() => act.mutate({ kind: "fill" })} disabled={!selector || act.isPending} className={ghost}>
              <Type className="w-3.5 h-3.5" /> املأ
            </button>
            <button onClick={() => act.mutate({ kind: "click" })} disabled={!selector || act.isPending} className={ghost}>
              <MousePointerClick className="w-3.5 h-3.5" /> اضغط
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
