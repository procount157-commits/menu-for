import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Play, Plus, Trash2, Clock, Power, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "./AgentPanel";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors";

const when = (r: any) =>
  r.triggerKind === "daily"
    ? `كل يوم الساعة ${String(r.atHour).padStart(2, "0")}:00 بتوقيت الخليج`
    : r.everyMinutes >= 60
      ? `كل ${Math.round(r.everyMinutes / 60)} ساعة`
      : `كل ${r.everyMinutes} دقيقة`;

/**
 * Scheduled work the team does on its own. Nothing here reaches a customer —
 * a routine reports to the owner or writes into its own memory.
 */
export function Routines({ team }: { team: any[] }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const staff = team.filter((t) => t.kind !== "internal");
  const [f, setF] = useState({
    role: staff[0]?.role ?? "", name: "", instruction: "",
    triggerKind: "daily" as "daily" | "interval", atHour: "9", everyMinutes: "720",
  });

  const { data, isLoading } = useQuery<any>({
    queryKey: ["agent-routines"], queryFn: () => api("/api/agents/routines"), refetchInterval: 120_000,
  });

  const create = useMutation({
    mutationFn: () => api("/api/agents/routines", {
      method: "POST",
      body: JSON.stringify({
        ...f,
        atHour: Number(f.atHour), everyMinutes: Number(f.everyMinutes),
      }),
    }),
    onSuccess: () => { setAdding(false); setF({ ...f, name: "", instruction: "" }); qc.invalidateQueries({ queryKey: ["agent-routines"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/api/agents/routines/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-routines"] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/agents/routines/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-routines"] }),
  });
  const run = useMutation({
    mutationFn: (id: number) => api(`/api/agents/routines/${id}/run`, { method: "POST" }),
    onSuccess: (d: any, id) => {
      if (d.error) toast.error(d.error); else toast.success("نُفِّذت");
      setOpen(id);
      qc.invalidateQueries({ queryKey: ["agent-routines"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const routines: any[] = data?.routines ?? [];

  return (
    <div className={card}>
      <div className="p-4 border-b border-card-border flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">مهام دورية</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            يؤدّيها الموظف من نفسه على جدول. لا تُرسل شيئاً لأي عميل — ترفع لك تقريراً أو تكتب قاعدة يلتزم بها.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className={cn(ghost, "shrink-0")}>
            <Plus className="w-3.5 h-3.5" /> مهمة
          </button>
        )}
      </div>

      {adding && (
        <div className="p-4 border-b border-card-border space-y-3 bg-muted/20">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1.5">من يؤدّيها</label>
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className={input}>
                {staff.map((t) => <option key={t.role} value={t.role}>{t.avatar} {t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1.5">الاسم</label>
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                     placeholder="مراجعة عملاء الأسبوع" className={input} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1.5">ما تريده أن يفعل</label>
            <textarea value={f.instruction} onChange={(e) => setF({ ...f, instruction: e.target.value })} rows={3}
                      placeholder="راجع من قال إنه مهتم ثم توقف عن الرد، واقترح لي من يستحق مكالمة مني."
                      className={cn(input, "resize-y leading-relaxed")} />
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs font-semibold block mb-1.5">متى</label>
              <select value={f.triggerKind} onChange={(e) => setF({ ...f, triggerKind: e.target.value as any })} className={input}>
                <option value="daily">كل يوم في ساعة محددة</option>
                <option value="interval">كل فترة</option>
              </select>
            </div>
            {f.triggerKind === "daily" ? (
              <div className="w-28">
                <label className="text-xs font-semibold block mb-1.5">الساعة</label>
                <input type="number" min={0} max={23} value={f.atHour}
                       onChange={(e) => setF({ ...f, atHour: e.target.value })} className={input} />
              </div>
            ) : (
              <div className="w-32">
                <label className="text-xs font-semibold block mb-1.5">كل (دقيقة)</label>
                <input type="number" min={5} value={f.everyMinutes}
                       onChange={(e) => setF({ ...f, everyMinutes: e.target.value })} className={input} />
              </div>
            )}
            <button onClick={() => create.mutate()} disabled={!f.name.trim() || !f.instruction.trim() || create.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-50">
              {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} أضف
            </button>
            <button onClick={() => setAdding(false)} className={ghost}>إلغاء</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : routines.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground text-center">لا مهام دورية بعد.</p>
      ) : (
        <div className="divide-y divide-card-border">
          {routines.map((r) => {
            const owner = team.find((t) => t.role === r.role);
            return (
              <div key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn("text-sm font-medium", !r.isActive && "text-muted-foreground/60")}>{r.name}</p>
                      {!r.isActive && <span className="text-[11px] text-muted-foreground border border-card-border rounded px-1.5">موقوفة</span>}
                      {r.lastRun?.error && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.instruction}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <Clock className="w-3 h-3" />
                      {owner ? `${owner.avatar} ${owner.name} · ` : ""}{when(r)}
                      {r.lastRunAt && ` · آخر تنفيذ ${new Date(r.lastRunAt).toLocaleString("ar-AE", { timeZone: "Asia/Dubai", dateStyle: "short", timeStyle: "short" })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => run.mutate(r.id)} disabled={run.isPending} className={ghost} title="نفّذ الآن">
                      {run.isPending && run.variables === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => patch.mutate({ id: r.id, isActive: !r.isActive })}
                      className={cn("p-2 rounded-lg border transition-colors",
                        r.isActive ? "border-card-border text-muted-foreground hover:text-red-400" : "border-primary/30 text-primary")}
                      title={r.isActive ? "أوقف" : "شغّل"}>
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm(`حذف «${r.name}»؟`)) del.mutate(r.id); }}
                            className="p-2 rounded-lg border border-card-border text-muted-foreground hover:text-red-400 hover:border-red-500/30">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {r.lastRun && (
                  <div className="mt-3">
                    <button onClick={() => setOpen(open === r.id ? null : r.id)}
                            className="text-[11px] text-primary hover:underline">
                      {open === r.id ? "إخفاء آخر تقرير" : "اقرأ آخر تقرير"}
                    </button>
                    {open === r.id && (
                      <div className={cn("mt-2 rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap",
                        r.lastRun.error ? "border-red-500/30 bg-red-500/5 text-red-300" : "border-card-border bg-muted/30")}>
                        {r.lastRun.error ?? r.lastRun.output}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
