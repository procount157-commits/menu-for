import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, Save, Plus, Trash2, Brain, ListChecks, Sparkles, User,
  TrendingUp, TrendingDown, HelpCircle, Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "فشل الطلب");
  return d;
};

export const SPECIALTIES: Array<{ key: string; label: string }> = [
  { key: "interested",     label: "مهتم بالشراء" },
  { key: "question",       label: "سؤال" },
  { key: "greeting",       label: "ترحيب" },
  { key: "unclear",        label: "غير واضح" },
  { key: "complaint",      label: "شكوى" },
  { key: "not_interested", label: "غير مهتم" },
];
export const specialtyLabel = (k: string) => SPECIALTIES.find((s) => s.key === k)?.label ?? k;

export const input = "w-full bg-input border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors";

export function Chips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SPECIALTIES.map((s) => {
        const on = value.includes(s.key);
        return (
          <button key={s.key} type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== s.key) : [...value, s.key])}
            className={cn("px-2.5 py-1 rounded-lg text-xs border transition-colors",
              on ? "bg-primary/15 text-primary border-primary/30" : "border-card-border text-muted-foreground hover:border-primary/40")}
          >{s.label}</button>
        );
      })}
    </div>
  );
}

// ── Personality ──────────────────────────────────────────────────
function PersonaTab({ e, onSave, saving }: { e: any; onSave: (v: any) => void; saving: boolean }) {
  const [persona, setPersona] = useState(e.persona ?? "");
  const [specialties, setSpecialties] = useState<string[]>(e.specialties ?? []);
  const [priority, setPriority] = useState(String(e.priority ?? 100));
  const isManager = e.kind === "manager";

  const dirty = persona !== (e.persona ?? "")
    || priority !== String(e.priority ?? 100)
    || JSON.stringify([...specialties].sort()) !== JSON.stringify([...(e.specialties ?? [])].sort());

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold block mb-1.5">شخصيته — تُسلَّم للبوت كما كتبتها</label>
        <textarea value={persona} onChange={(ev) => setPersona(ev.target.value)} rows={3}
          placeholder="كيف يتكلم وما الذي يميّزه — مثال: هادئ ومتعاطف، يستمع للشكوى كاملةً قبل أن يرد، ولا يبرّر."
          className={cn(input, "resize-y leading-relaxed")} />
      </div>

      {isManager ? (
        <div className="rounded-lg border border-card-border bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            المدير لا يُخصَّص بنوع رسائل. يستلم ما لم يُعيَّن له أحد، ويسلّمه فوراً لمن تُعيّنه لاحقاً لهذا النوع.
          </p>
        </div>
      ) : (
        <div>
          <label className="text-xs font-semibold block mb-1.5">الرسائل التي تصله</label>
          <Chips value={specialties} onChange={setSpecialties} />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {specialties.length === 0
              ? "لا شيء محدَّد — سيستلم ما لم يطالب به غيره فقط."
              : "المحادثة تنتقل إليه عند ورود هذه الأنواع، حتى لو كان زميله يحاور العميل."}
          </p>
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="w-32">
          <label className="text-xs font-semibold block mb-1.5">الأولوية</label>
          <input type="number" min={1} max={999} value={priority}
                 onChange={(ev) => setPriority(ev.target.value)} className={input} />
          <p className="text-[11px] text-muted-foreground mt-1">الأصغر يفوز عند التنازع</p>
        </div>
        <button onClick={() => onSave({ persona, specialties, priority: Number(priority) })}
          disabled={!dirty || saving}
          className={cn("flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors",
            dirty ? "border-primary/40 text-primary hover:bg-primary/10" : "border-card-border text-muted-foreground/50 cursor-not-allowed")}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} حفظ
        </button>
      </div>
    </div>
  );
}

// ── Duties ───────────────────────────────────────────────────────
function TasksTab({ role }: { role: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const key = ["agent-tasks", role];
  const { data: tasks = [], isLoading } = useQuery<any[]>({ queryKey: key, queryFn: () => api(`/api/agents/${role}/tasks`) });

  const add = useMutation({
    mutationFn: () => api(`/api/agents/${role}/tasks`, { method: "POST", body: JSON.stringify({ task: draft }) }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: any) => api(`/api/agents/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/agents/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        ما يجب أن ينجزه في كل محادثة، بالترتيب. تصل إليه مع كل رسالة.
      </p>
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
        <div className="space-y-1.5">
          {tasks.length === 0 && <p className="text-xs text-muted-foreground/60">لا مهام بعد.</p>}
          {tasks.map((t, i) => (
            <div key={t.id} className="flex items-start gap-2 group">
              <span className="text-[11px] text-muted-foreground/60 mt-1 w-4 shrink-0">{i + 1}.</span>
              <input type="checkbox" checked={t.isActive} onChange={() => toggle.mutate({ id: t.id, isActive: !t.isActive })}
                     className="mt-1 accent-primary shrink-0" />
              <p className={cn("text-sm flex-1 leading-relaxed", !t.isActive && "line-through text-muted-foreground/50")}>{t.task}</p>
              <button onClick={() => del.mutate(t.id)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 shrink-0 mt-0.5">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) add.mutate(); }}
               placeholder="اجمع اسم الشركة ونشاطها قبل أي عرض" className={input} />
        <button onClick={() => add.mutate()} disabled={!draft.trim() || add.isPending} className={cn(ghost, "shrink-0 disabled:opacity-40")}>
          {add.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} أضف
        </button>
      </div>
    </div>
  );
}

// ── Memory ───────────────────────────────────────────────────────
const KINDS: Record<string, { label: string; icon: any; cls: string; hint: string }> = {
  instruction: { label: "تعليماتك له", icon: Pin,          cls: "text-primary",      hint: "يلتزم بها حرفياً في كل محادثة" },
  win:         { label: "نجح",         icon: TrendingUp,   cls: "text-green-400",    hint: "ردود أدّت لاهتمام العميل" },
  loss:        { label: "فشل",         icon: TrendingDown, cls: "text-red-400",      hint: "ردود أدّت لانصراف العميل" },
  gap:         { label: "لا يعرف",     icon: HelpCircle,   cls: "text-yellow-400",   hint: "سيقول إنه سيتأكد بدل أن يخترع" },
};

function MemoryTab({ role }: { role: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const key = ["agent-memory", role];
  const { data: rows = [], isLoading } = useQuery<any[]>({ queryKey: key, queryFn: () => api(`/api/agents/${role}/memory`) });

  const add = useMutation({
    mutationFn: () => api(`/api/agents/${role}/memory`, { method: "POST", body: JSON.stringify({ content: draft }) }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/agents/memory/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        ذاكرته الخاصة — لا يشاركها زملاءه. ما نجح وما فشل يكتبه هو من نتائج ردوده؛ التعليمات تكتبها أنت.
      </p>

      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) add.mutate(); }}
               placeholder="لا تذكر السعر قبل أن يخبرك بحجم شركته" className={input} />
        <button onClick={() => add.mutate()} disabled={!draft.trim() || add.isPending} className={cn(ghost, "shrink-0 disabled:opacity-40")}>
          {add.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} تعليم
        </button>
      </div>

      {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
        <div className="space-y-3">
          {rows.length === 0 && <p className="text-xs text-muted-foreground/60">لم يتعلّم شيئاً بعد.</p>}
          {Object.entries(KINDS).map(([kind, meta]) => {
            const mine = rows.filter((r) => r.kind === kind);
            if (mine.length === 0) return null;
            return (
              <div key={kind}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <meta.icon className={cn("w-3.5 h-3.5", meta.cls)} />
                  <p className="text-xs font-semibold">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground/70">— {meta.hint}</p>
                </div>
                <div className="space-y-1">
                  {mine.map((r) => (
                    <div key={r.id} className="flex items-start gap-2 group text-xs">
                      <p className="flex-1 leading-relaxed text-muted-foreground">{r.content}</p>
                      {r.times > 1 && <span className="text-[10px] text-muted-foreground/60 shrink-0">{r.times}×</span>}
                      <button onClick={() => del.mutate(r.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Skills ───────────────────────────────────────────────────────
function SkillsTab({ role, team }: { role: string; team: any[] }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", instruction: "", intents: [] as string[] });
  const { data: skills = [], isLoading } = useQuery<any[]>({ queryKey: ["agent-skills"], queryFn: () => api("/api/agents/skills") });

  const create = useMutation({
    mutationFn: async () => {
      const s = await api("/api/agents/skills", { method: "POST", body: JSON.stringify(f) });
      // A skill nobody holds does nothing, so the author holds it by default.
      await api(`/api/agents/skills/${s.id}`, { method: "PATCH", body: JSON.stringify({ heldBy: [role] }) });
    },
    onSuccess: () => { setF({ name: "", instruction: "", intents: [] }); setAdding(false); qc.invalidateQueries({ queryKey: ["agent-skills"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: any) => api(`/api/agents/skills/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-skills"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/agents/skills/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-skills"] }),
  });

  const staff = team.filter((t) => t.kind !== "internal");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        تعليمات تُكتب مرة ويحملها من تشاء. المهارة التي لا يحملها أحد لا تفعل شيئاً.
      </p>

      {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
        <div className="space-y-2">
          {skills.length === 0 && <p className="text-xs text-muted-foreground/60">لا مهارات بعد.</p>}
          {skills.map((s) => (
            <div key={s.id} className={cn("rounded-lg border p-3 space-y-2",
              s.heldBy.includes(role) ? "border-primary/30 bg-primary/5" : "border-card-border")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.instruction}</p>
                </div>
                <button onClick={() => { if (confirm(`حذف «${s.name}»؟`)) del.mutate(s.id); }}
                        className="text-muted-foreground hover:text-red-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-muted-foreground">يحملها:</span>
                {staff.map((t) => {
                  const on = s.heldBy.includes(t.role);
                  return (
                    <button key={t.role}
                      onClick={() => patch.mutate({ id: s.id, heldBy: on ? s.heldBy.filter((r: string) => r !== t.role) : [...s.heldBy, t.role] })}
                      className={cn("px-2 py-0.5 rounded text-[11px] border transition-colors",
                        on ? "bg-primary/15 text-primary border-primary/30" : "border-card-border text-muted-foreground hover:border-primary/40")}
                    >{t.avatar} {t.name}</button>
                  );
                })}
                {s.intents?.length > 0 && (
                  <span className="text-[11px] text-muted-foreground/70 mr-auto">
                    عند: {s.intents.map(specialtyLabel).join("، ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="rounded-lg border border-primary/30 p-3 space-y-3">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                 placeholder="اسم المهارة — مثال: التعامل مع اعتراض السعر" className={input} />
          <textarea value={f.instruction} onChange={(e) => setF({ ...f, instruction: e.target.value })} rows={3}
                    placeholder="التعليمات التي يتبعها عند استخدامها" className={cn(input, "resize-y leading-relaxed")} />
          <div>
            <p className="text-xs font-semibold mb-1.5">تُستخدم عند (اتركها فارغة لتكون دائمة)</p>
            <Chips value={f.intents} onChange={(intents) => setF({ ...f, intents })} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => create.mutate()} disabled={!f.name.trim() || !f.instruction.trim() || create.isPending}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs disabled:opacity-50">
              {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} أضف
            </button>
            <button onClick={() => setAdding(false)} className={ghost}>إلغاء</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={ghost}>
          <Plus className="w-3.5 h-3.5" /> مهارة جديدة
        </button>
      )}
    </div>
  );
}

// ── The panel ────────────────────────────────────────────────────
const TABS = [
  { key: "persona", label: "الشخصية", icon: User },
  { key: "tasks",   label: "المهام",   icon: ListChecks },
  { key: "memory",  label: "الذاكرة",  icon: Brain },
  { key: "skills",  label: "المهارات", icon: Sparkles },
] as const;

export function AgentPanel({ e, team, onSave, saving }: { e: any; team: any[]; onSave: (v: any) => void; saving: boolean }) {
  const [tab, setTab] = useState<typeof TABS[number]["key"]>("persona");
  return (
    <div className="border-b border-card-border bg-muted/20">
      <div className="flex gap-1 px-4 pt-3">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs border-b-2 transition-colors",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === "persona" && <PersonaTab e={e} onSave={onSave} saving={saving} />}
        {tab === "tasks"   && <TasksTab role={e.role} />}
        {tab === "memory"  && <MemoryTab role={e.role} />}
        {tab === "skills"  && <SkillsTab role={e.role} team={team} />}
      </div>
    </div>
  );
}
