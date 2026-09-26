import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, Globe, Search, X, MousePointerClick, Type, RefreshCw, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "./AgentPanel";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";

/**
 * What an employee is looking at, and the controls to take over.
 *
 * The screen refreshes on a timer rather than streaming: a JPEG every two
 * seconds is enough to follow along, and a real screencast would mean a
 * websocket and a decoder for something nobody watches for more than a minute.
 */
export function BrowserPane({ team }: { team: any[] }) {
  const qc = useQueryClient();
  const staff = team.filter((t) => t.kind !== "internal" || t.role === "collector");
  const [role, setRole] = useState(staff[0]?.role ?? "sales");
  const [url, setUrl] = useState("");
  const [tick, setTick] = useState(0);
  const [brief, setBrief] = useState<string | null>(null);
  const [selector, setSelector] = useState("");
  const [value, setValue] = useState("");
  const timer = useRef<number | null>(null);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ["browser-sessions"], queryFn: () => api("/api/browser/sessions"), refetchInterval: 15_000,
  });
  const mine = sessions.find((s) => s.role === role);

  // Only poll the screen while there is something to show.
  useEffect(() => {
    if (!mine) { if (timer.current) window.clearInterval(timer.current); return; }
    timer.current = window.setInterval(() => setTick((t) => t + 1), 2_000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [mine?.role, mine?.url]);

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
    mutationFn: ({ kind }: { kind: "fill" | "click" }) =>
      api(`/api/browser/${role}/${kind}`, {
        method: "POST",
        body: JSON.stringify(kind === "fill" ? { selector, value } : { selector }),
      }),
    onSuccess: () => { setTick((t) => t + 1); toast.success("تم"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const close = useMutation({
    mutationFn: () => api(`/api/browser/${role}`, { method: "DELETE" }),
    onSuccess: () => { setBrief(null); qc.invalidateQueries({ queryKey: ["browser-sessions"] }); },
  });

  return (
    <div className={card}>
      <div className="p-4 border-b border-card-border">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold text-sm flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-primary" /> المتصفّح الداخلي
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              كل موظف له جلسة تصفّح خاصة تحتفظ بتسجيل دخولها. القراءة يفعلها بنفسه؛ أي شيء يغيّر الصفحة تأذن به أنت.
            </p>
          </div>
          {mine && (
            <button onClick={() => close.mutate()} className={ghost}>
              <X className="w-3.5 h-3.5" /> أغلق الجلسة
            </button>
          )}
        </div>

        <div className="flex gap-2 mt-3 flex-wrap">
          <select value={role} onChange={(e) => { setRole(e.target.value); setBrief(null); }} className={cn(input, "w-36")}>
            {staff.map((t) => <option key={t.role} value={t.role}>{t.avatar} {t.name}</option>)}
          </select>
          <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr"
                 onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) read.mutate(); }}
                 placeholder="procount.ae" className={cn(input, "flex-1 min-w-[180px] font-mono text-xs")} />
          <button onClick={() => read.mutate()} disabled={!url.trim() || read.isPending} className={ghost}>
            {read.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />} افتح
          </button>
          <button onClick={() => research.mutate()} disabled={!url.trim() || research.isPending}
                  className={cn(ghost, "border-primary/40 text-primary")}>
            {research.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} ابحث وحلّل
          </button>
        </div>
      </div>

      {brief && (
        <div className="p-4 border-b border-card-border bg-primary/5">
          <p className="text-xs font-semibold mb-1.5">ما استخلصه قبل المحادثة:</p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{brief}</p>
        </div>
      )}

      {mine ? (
        <>
          <div className="px-4 py-2 border-b border-card-border flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
            <span className="truncate font-mono" dir="ltr">{mine.url}</span>
            <button onClick={() => setTick((t) => t + 1)} className="mr-auto shrink-0 hover:text-foreground">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>

          <div className="bg-black/40 flex justify-center">
            <img
              src={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/browser/${role}/screen?t=${tick}`}
              alt="ما يراه الموظف"
              className="max-w-full"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
            />
          </div>

          <div className="p-4 flex gap-2 flex-wrap items-center">
            <input value={selector} onChange={(e) => setSelector(e.target.value)} dir="ltr"
                   placeholder="#email أو button[type=submit]" className={cn(input, "flex-1 min-w-[160px] font-mono text-xs")} />
            <input value={value} onChange={(e) => setValue(e.target.value)}
                   placeholder="القيمة" className={cn(input, "w-36 text-xs")} />
            <button onClick={() => act.mutate({ kind: "fill" })} disabled={!selector || act.isPending} className={ghost}>
              <Type className="w-3.5 h-3.5" /> املأ
            </button>
            <button onClick={() => act.mutate({ kind: "click" })} disabled={!selector || act.isPending} className={ghost}>
              <MousePointerClick className="w-3.5 h-3.5" /> اضغط
            </button>
            <p className="text-[11px] text-muted-foreground basis-full">
              هذه أنت تتصرّف، لا الموظف. لا يملأ نموذجاً ولا يضغط زراً من نفسه.
            </p>
          </div>
        </>
      ) : (
        <p className="p-8 text-sm text-muted-foreground text-center">
          لا جلسة مفتوحة لهذا الموظف. اكتب عنواناً واضغط «افتح».
        </p>
      )}
    </div>
  );
}
