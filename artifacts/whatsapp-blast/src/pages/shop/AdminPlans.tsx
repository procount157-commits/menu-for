// ── /admin/plans — the plan matrix ────────────────────────────────
// Every plan is a column; every feature and limit a row. A cell is a switch
// or a number («∞» for no limit). Prices, names, visibility and the trial's
// rules are here too. What is saved here is what the server enforces and
// what the home page shows — there is no second place.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Crown, Infinity as InfinityIcon, Loader2, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { GROUPS } from "@workspace/menu-shared";
import { api, get, inputCls, labelCls } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, errText, n } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

interface Row { key: string; label: string; group: string; hint?: string; unit?: string }
interface Plan {
  id: number | null; key: string; name: string; nameEn: string | null; priceMonthly: number; priceYearly: number | null; extraBranchPrice: number | null;
  contactSales: boolean; isPublic: boolean; isActive: boolean; isFeatured: boolean; badge: string | null; sort: number;
  limits: Record<string, number>; toggles: Record<string, boolean>; bullets: string[]; shops: number; autoBullets: string[];
}
interface Trial { days: number; extensionDays: number; extensionWithinDays: number; extensionMinItems: number; afterPlan: string; graceShare: number }
interface Matrix { rows: { limits: Row[]; toggles: Row[] }; plans: Plan[]; trial: Trial }

const KEY = ["/api/plans/admin/matrix"];

export default function AdminPlans() {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Empty title="هذه الصفحة لمشرف المنصة فقط" icon={<ShieldAlert />} className="py-24" />;
  return <Inner />;
}

function Inner() {
  const qc = useQueryClient();
  const q = useQuery<Matrix>({ queryKey: KEY, queryFn: () => get(KEY[0]!) });
  const [creating, setCreating] = useState(false);
  const [bulletsFor, setBulletsFor] = useState<Plan | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const save = async (key: string, body: Record<string, unknown>) => {
    try { await api(`/api/plans/admin/matrix/${key}`, { method: "PUT", json: body }); await refresh(); }
    catch (e) { toast.error(errText(e)); }
  };
  if (q.isLoading) return <div className="py-24 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (q.error || !q.data) return <Empty title="تعذّر التحميل" icon={<ShieldAlert />} className="py-24">{errText(q.error)}</Empty>;
  const d = q.data;
  const plans = d.plans;
  const groups = GROUPS.map(([g, label]) => ({ g, label, limits: d.rows.limits.filter((r) => r.group === g), toggles: d.rows.toggles.filter((r) => r.group === g) })).filter((x) => x.limits.length || x.toggles.length);

  return (
    <div className="p-4 md:p-6 max-w-[90rem] mx-auto space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[14rem]">
          <h1 className="text-xl font-bold flex items-center gap-2"><Crown className="w-5 h-5 text-primary" />الخطط والفترة التجريبية</h1>
          <p className="text-sm text-muted-foreground mt-0.5">كل خلية هنا هي ما يعمل فعلاً في النظام وما يظهر في الصفحة الرئيسية. التغيير يسري فوراً على كل المحلات في تلك الخطة.</p>
        </div>
        <Btn tone="gold" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />خطة جديدة</Btn>
      </div>

      <TrialCard trial={d.trial} plans={plans} onSaved={refresh} />

      <div className="rounded-xl border border-card-border bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[56rem]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-start p-3 w-64 align-bottom text-xs text-muted-foreground font-medium">الميزة / الحد</th>
              {plans.map((p) => <th key={p.key} className="p-3 align-top min-w-[11rem]"><PlanHead p={p} onSave={(b) => save(p.key, b)} onBullets={() => setBulletsFor(p)} onDelete={async () => { if (!confirm(`حذف خطة «${p.name}»؟`)) return; try { await api(`/api/plans/admin/matrix/${p.key}`, { method: "DELETE" }); refresh(); } catch (e) { toast.error(errText(e)); } }} /></th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.g} label={g.label} limits={g.limits} toggles={g.toggles} plans={plans} onSave={save} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">∞ = بلا حد. 0 في عدد الرسائل أو الحملات يعني أن الميزة غير متاحة فعلياً حتى لو كان مفتاحها مفتوحاً.</p>

      <CreateDialog open={creating} plans={plans} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />
      <BulletsDialog plan={bulletsFor} onClose={() => setBulletsFor(null)} onSave={async (bullets) => { if (bulletsFor) { await save(bulletsFor.key, { bullets }); setBulletsFor(null); } }} />
    </div>
  );
}

function PlanHead({ p, onSave, onBullets, onDelete }: { p: Plan; onSave: (b: Record<string, unknown>) => Promise<void>; onBullets: () => void; onDelete: () => void }) {
  const [f, setF] = useState({ name: p.name, priceMonthly: String(p.priceMonthly), priceYearly: p.priceYearly == null ? "" : String(p.priceYearly), extraBranchPrice: p.extraBranchPrice == null ? "" : String(p.extraBranchPrice), badge: p.badge ?? "" });
  useEffect(() => setF({ name: p.name, priceMonthly: String(p.priceMonthly), priceYearly: p.priceYearly == null ? "" : String(p.priceYearly), extraBranchPrice: p.extraBranchPrice == null ? "" : String(p.extraBranchPrice), badge: p.badge ?? "" }), [p]);
  const commit = (k: keyof typeof f) => { const cur = { name: p.name, priceMonthly: String(p.priceMonthly), priceYearly: p.priceYearly == null ? "" : String(p.priceYearly), extraBranchPrice: p.extraBranchPrice == null ? "" : String(p.extraBranchPrice), badge: p.badge ?? "" }; if (f[k] !== cur[k]) void onSave({ [k]: f[k] }); };
  const cell = "w-full h-8 rounded-md bg-input border border-border px-2 text-xs tabular-nums";
  const yearlySaving = f.priceYearly && Number(f.priceMonthly) > 0 ? Math.round((1 - Number(f.priceYearly) / (Number(f.priceMonthly) * 12)) * 100) : 0;
  return (
    <div className={cn("space-y-1.5 text-start rounded-lg p-2 -m-1", p.isFeatured && "bg-primary/10 ring-1 ring-primary/30")}>
      <input className={cn(cell, "font-bold text-sm h-9")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => commit("name")} />
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><span className="font-mono" dir="ltr">{p.key}</span><span>· {n(p.shops)} محل</span>{!p.isActive && <span className="text-red-300">· متوقفة</span>}{!p.isPublic && <span>· مخفية</span>}</div>
      <label className="block"><span className="text-[10px] text-muted-foreground">شهري (د.إ)</span><input className={cell} type="number" min={0} value={f.priceMonthly} onChange={(e) => setF({ ...f, priceMonthly: e.target.value })} onBlur={() => commit("priceMonthly")} /></label>
      <label className="block"><span className="text-[10px] text-muted-foreground">سنوي (د.إ){yearlySaving > 0 ? ` — توفير ${yearlySaving}%` : ""}</span><input className={cell} type="number" min={0} placeholder="—" value={f.priceYearly} onChange={(e) => setF({ ...f, priceYearly: e.target.value })} onBlur={() => commit("priceYearly")} /></label>
      <label className="block"><span className="text-[10px] text-muted-foreground">لكل فرع إضافي (د.إ/شهر)</span><input className={cell} type="number" min={0} placeholder="—" value={f.extraBranchPrice} onChange={(e) => setF({ ...f, extraBranchPrice: e.target.value })} onBlur={() => commit("extraBranchPrice")} /></label>
      <label className="block"><span className="text-[10px] text-muted-foreground">شارة</span><input className={cell} placeholder="الأكثر طلباً" value={f.badge} onChange={(e) => setF({ ...f, badge: e.target.value })} onBlur={() => commit("badge")} /></label>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] pt-1">
        {([["isActive", "فعّالة"], ["isPublic", "في الصفحة الرئيسية"], ["isFeatured", "مميّزة"], ["contactSales", "«تواصل معنا» بدل السعر"]] as const).map(([k, l]) => (
          <label key={k} className="flex items-center justify-between gap-1"><span className="text-muted-foreground">{l}</span><Switch checked={!!p[k]} onCheckedChange={(v) => onSave({ [k]: v })} dir="ltr" className="scale-75" /></label>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button className="text-[11px] text-primary underline underline-offset-2" onClick={onBullets}>نص الصفحة الرئيسية{p.bullets.length ? ` (${p.bullets.length})` : " (آلي)"}</button>
        <span className="flex-1" />
        <button className="text-muted-foreground hover:text-red-300" title="حذف" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

function GroupRows({ label, limits, toggles, plans, onSave }: { label: string; limits: Row[]; toggles: Row[]; plans: Plan[]; onSave: (key: string, b: Record<string, unknown>) => Promise<void> }) {
  return (
    <>
      <tr className="bg-secondary/40"><td colSpan={plans.length + 1} className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">{label}</td></tr>
      {limits.map((r) => (
        <tr key={r.key} className="border-t border-border/50">
          <td className="p-2.5"><div className="font-medium">{r.label}</div>{r.hint && <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.hint}</div>}</td>
          {plans.map((p) => <td key={p.key} className="p-2 text-center"><LimitCell value={p.limits[r.key] ?? 0} unit={r.unit ?? ""} onChange={(v) => onSave(p.key, { limits: { [r.key]: v } })} /></td>)}
        </tr>
      ))}
      {toggles.map((r) => (
        <tr key={r.key} className="border-t border-border/50">
          <td className="p-2.5"><div className="font-medium">{r.label}</div>{r.hint && <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.hint}</div>}</td>
          {plans.map((p) => (
            <td key={p.key} className="p-2 text-center">
              <button type="button" onClick={() => onSave(p.key, { toggles: { [r.key]: !p.toggles[r.key] } })} aria-pressed={!!p.toggles[r.key]}
                className={cn("w-9 h-9 rounded-full inline-flex items-center justify-center transition", p.toggles[r.key] ? "bg-emerald-500/20 text-emerald-300" : "bg-secondary text-muted-foreground/50 hover:text-muted-foreground")}>
                {p.toggles[r.key] ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              </button>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function LimitCell({ value, unit, onChange }: { value: number; unit: string; onChange: (v: number) => void }) {
  const [v, setV] = useState(value < 0 ? "" : String(value));
  useEffect(() => setV(value < 0 ? "" : String(value)), [value]);
  const unlimited = value < 0;
  return (
    <div className="inline-flex items-center gap-1">
      <input className={cn("w-20 h-8 rounded-md bg-input border border-border px-2 text-xs tabular-nums text-center", unlimited && "opacity-40")} type="number" min={0} placeholder={unlimited ? "∞" : "0"} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== "" && Number(v) !== value) onChange(Math.max(0, Number(v))); }} />
      <button type="button" title="بلا حد" onClick={() => onChange(unlimited ? 0 : -1)} className={cn("w-8 h-8 rounded-md inline-flex items-center justify-center", unlimited ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground")}><InfinityIcon className="w-4 h-4" /></button>
      <span className="sr-only">{unit}</span>
    </div>
  );
}

function TrialCard({ trial, plans, onSaved }: { trial: Trial; plans: Plan[]; onSaved: () => void }) {
  const [f, setF] = useState(trial);
  useEffect(() => setF(trial), [trial]);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(trial);
  const trialPlan = plans.find((p) => p.key === "trial");
  const save = async () => {
    setBusy(true);
    try { await api("/api/admin/orgs/settings/trial", { method: "PUT", json: f }); toast.success("حُفظت قواعد التجربة"); onSaved(); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  const num = (k: keyof Trial, min: number, max: number) => <input className={cn(inputCls, "w-20 h-9 tabular-nums text-center inline-block")} type="number" min={min} max={max} value={f[k] as number} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />;
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
      <h2 className="font-bold">الفترة التجريبية</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        من يسجّل بنفسه يبدأ على خطة «{trialPlan?.name ?? "تجريبي"}» (عمود في المصفوفة أعلاه: عدّل ميزاتها وسقف رسائلها هناك — الآن {trialPlan ? n(trialPlan.limits.messagesMonthly ?? 0) : "—"} رسالة) لمدة:
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {num("days", 0, 365)}<span className="text-muted-foreground">يوماً. من يربط واتساب ويضيف</span>{num("extensionMinItems", 0, 200)}<span className="text-muted-foreground">أصناف خلال أول</span>{num("extensionWithinDays", 1, 60)}<span className="text-muted-foreground">أيام يأخذ</span>{num("extensionDays", 0, 90)}<span className="text-muted-foreground">يوماً إضافياً، مرة واحدة.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">بعد انتهائها (أو انتهاء أي خطة مدفوعة) ينزل المحل إلى خطة</span>
        <select className={cn(inputCls, "w-40 h-9 inline-block")} value={f.afterPlan} onChange={(e) => setF({ ...f, afterPlan: e.target.value })}>{plans.filter((p) => p.key !== "trial").map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
        <span className="text-muted-foreground">· سماح الرسائل التشغيلية بعد النفاد</span>
        <input className={cn(inputCls, "w-20 h-9 tabular-nums text-center inline-block")} type="number" min={0} max={50} value={Math.round(f.graceShare * 100)} onChange={(e) => setF({ ...f, graceShare: Number(e.target.value) / 100 })} /><span className="text-muted-foreground">% فوق السقف (التسويق يتوقف عند 100%).</span>
      </div>
      <div className="flex gap-2"><Btn tone="gold" disabled={!dirty || busy} onClick={save}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}حفظ</Btn>{dirty && <Btn tone="ghost" onClick={() => setF(trial)}>تراجع</Btn>}</div>
    </section>
  );
}

function CreateDialog({ open, plans, onClose, onDone }: { open: boolean; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ key: "", name: "", nameEn: "", priceMonthly: "", from: "basic" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api("/api/plans/admin/matrix", { method: "POST", json: { ...f, priceMonthly: Number(f.priceMonthly) || 0 } }); toast.success("أُضيفت الخطة — عدّل خلاياها في المصفوفة"); setF({ key: "", name: "", nameEn: "", priceMonthly: "", from: "basic" }); onDone(); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="خطة جديدة" description="تبدأ نسخة من خطة موجودة، ثم تعدّل أي خلية.">
      <div className="space-y-3">
        <label className="block"><span className={labelCls}>الاسم</span><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: نمو" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={labelCls}>بالإنجليزي</span><input className={inputCls} dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></label>
          <label className="block"><span className={labelCls}>المفتاح (إنجليزي، لا يتغيّر)</span><input className={cn(inputCls, "font-mono")} dir="ltr" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} placeholder="growth" /></label>
          <label className="block"><span className={labelCls}>السعر الشهري</span><input className={cn(inputCls, "tabular-nums")} type="number" min={0} value={f.priceMonthly} onChange={(e) => setF({ ...f, priceMonthly: e.target.value })} /></label>
          <label className="block"><span className={labelCls}>نسخة من</span><select className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
        </div>
        <div className="flex gap-2"><Btn tone="gold" disabled={busy || !f.name.trim() || f.key.length < 2} onClick={save}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}أضف</Btn><Btn tone="ghost" onClick={onClose}>إلغاء</Btn></div>
      </div>
    </Modal>
  );
}

function BulletsDialog({ plan, onClose, onSave }: { plan: Plan | null; onClose: () => void; onSave: (bullets: string[]) => Promise<void> }) {
  const [text, setText] = useState("");
  useEffect(() => setText((plan?.bullets ?? []).join("\n")), [plan]);
  const auto = useMemo(() => plan?.autoBullets ?? [], [plan]);
  return (
    <Modal open={!!plan} onOpenChange={(v) => !v && onClose()} wide title={`نص «${plan?.name ?? ""}» في الصفحة الرئيسية`} description="اتركه فارغاً ليُكتب تلقائياً من المصفوفة (ويتحدّث مع كل تغيير). أو اكتب سطراً لكل ميزة.">
      <div className="grid md:grid-cols-2 gap-4">
        <div><span className={labelCls}>نصك (سطر لكل ميزة)</span><textarea className={cn(inputCls, "min-h-[16rem] leading-relaxed")} value={text} onChange={(e) => setText(e.target.value)} placeholder={auto.join("\n")} /></div>
        <div><span className={labelCls}>كما يُكتب تلقائياً الآن</span><ul className="rounded-lg border border-border p-3 text-sm space-y-1.5 min-h-[16rem]">{auto.map((b) => <li key={b} className="flex gap-2"><Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />{b}</li>)}</ul></div>
      </div>
      <div className="flex gap-2 mt-4"><Btn tone="gold" onClick={() => onSave(text.split("\n").map((x) => x.trim()).filter(Boolean))}>حفظ</Btn><Btn tone="ghost" onClick={() => setText("")}>امسح واستخدم الآلي</Btn><Btn tone="ghost" onClick={onClose}>إغلاق</Btn></div>
    </Modal>
  );
}
