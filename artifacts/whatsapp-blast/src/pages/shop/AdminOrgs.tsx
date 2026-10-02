// ── /admin/orgs — every shop on the platform ──────────────────────
// For the platform owner: who is using it this week, on which plan, with
// WhatsApp linked or not — and the levers: plan and duration, suspend,
// feature switches, and stepping into a shop as its owner to see a problem
// the way they see it.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Copy, ExternalLink, Plus, Loader2, LogIn, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, Store, MessageCircle, Crown } from "lucide-react";
import { get, patch, post, inputCls, labelCls } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, Stat, errText, n, shortDate } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

interface OrgRow {
  id: number; name: string; slug: string; vertical: string; status: string; created_at: string; onboarded_at: string | null;
  features: Record<string, boolean> | null; owner_id: number; owner_phone: string; owner_name: string | null;
  plan: string; plan_expires_at: string | null; last_login_at: string | null;
  branches: number; items: number; staff: number; tickets_7d: number; orders_7d: number; bookings_7d: number; customers: number; sent_7d: number;
  wa: { linked: number; total: number }; menuUrl: string;
}
interface PlatformStats {
  orgs: number; active_orgs: number; branches: number; tickets_24h: number; orders_24h: number; bookings_24h: number;
  sent_24h: number; failed_24h: number; customers: number; plans: Array<{ plan: string; n: number }>; planNames: Record<string, string>;
}

const PLAN_AR: Record<string, string> = { free: "تجريبي", basic: "أساسي", pro: "احترافي", business: "أعمال" };
const VERTICAL_AR: Record<string, string> = { restaurant: "مطعم", cafe: "كافيه", sweets: "حلويات", beauty: "تجميل" };
// Platform-level switches the admin turns on per shop; the owner's own
// choices (reviews, win-back) live in their settings and are shown, not set.
const FEATURES: Array<{ key: string; label: string }> = [{ key: "email", label: "التسويق بالبريد" }];
const FEATURE_AR: Record<string, string> = { email: "التسويق بالبريد", reviews: "طلب التقييم", winback: "اشتقنا لك" };

export default function AdminOrgs() {
  const { user } = useAuth();
  if (!user?.isAdmin) return <Empty title="هذه الصفحة لمشرف المنصة فقط" icon={<ShieldAlert />} className="py-24" />;
  return <Inner />;
}

function Inner() {
  const qc = useQueryClient();
  const stats = useQuery<PlatformStats>({ queryKey: ["/api/admin/orgs/platform/stats"], queryFn: () => get("/api/admin/orgs/platform/stats") });
  const orgs = useQuery<OrgRow[]>({ queryKey: ["/api/admin/orgs"], queryFn: () => get("/api/admin/orgs") });
  const [q, setQ] = useState("");
  const [planF, setPlanF] = useState<string>("all");
  const [edit, setEdit] = useState<OrgRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (orgs.data ?? []).filter((o) => (planF === "all" || o.plan === planF) &&
      (!s || o.name.toLowerCase().includes(s) || o.slug.includes(s) || o.owner_phone.includes(s) || (o.owner_name ?? "").toLowerCase().includes(s)));
  }, [orgs.data, q, planF]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["/api/admin/orgs"] }), qc.invalidateQueries({ queryKey: ["/api/admin/orgs/platform/stats"] })]);

  const update = async (o: OrgRow, body: Record<string, unknown>, ok: string) => {
    setBusy(`${o.id}`);
    try { await patch(`/api/admin/orgs/${o.id}`, body); toast.success(ok); await refresh(); return true; }
    catch (e) { toast.error(errText(e)); return false; }
    finally { setBusy(null); }
  };

  const loginAs = async (o: OrgRow) => {
    if (!confirm(`الدخول إلى «${o.name}» كصاحب المحل؟ ترى كل شيء كما يراه، وتخرج بزر «رجوع» أعلى الصفحة.`)) return;
    setBusy(`as:${o.id}`);
    try { await post(`/api/admin/orgs/${o.id}/login-as`); window.location.href = "/shop"; }
    catch (e) { toast.error(errText(e)); setBusy(null); }
  };

  const s = stats.data;
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Crown className="w-5 h-5 text-primary" />المحلات على المنصة</h1>
          <p className="text-sm text-muted-foreground mt-0.5">كل المنشآت، خططها، ونشاطها.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/admin" className="inline-flex items-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold bg-secondary hover:bg-secondary/70">الخطط والكوبونات والطلبات</a>
          <Btn tone="gold" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />محل جديد</Btn>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-2">
        <Stat label="المحلات" value={n(s?.orgs)} hint={s ? `${s.active_orgs} نشط` : undefined} tone="gold" />
        <Stat label="الفروع" value={n(s?.branches)} />
        <Stat label="تذاكر 24س" value={n(s?.tickets_24h)} />
        <Stat label="طلبات 24س" value={n(s?.orders_24h)} />
        <Stat label="حجوزات 24س" value={n(s?.bookings_24h)} />
        <Stat label="رسائل أُرسلت 24س" value={n(s?.sent_24h)} tone="ok" />
        <Stat label="رسائل فشلت 24س" value={n(s?.failed_24h)} tone={s?.failed_24h ? "warn" : undefined} />
        <Stat label="الزبائن" value={n(s?.customers)} />
      </div>
      {s?.plans?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {s.plans.map((p) => <span key={p.plan} className="text-xs rounded-full bg-secondary px-3 py-1">{PLAN_AR[p.plan] ?? s.planNames?.[p.plan] ?? p.plan} <span className="tabular-nums text-muted-foreground">{p.n}</span></span>)}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
          <input className={cn(inputCls, "ps-9 py-2.5")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المحل، الرابط، أو رقم صاحبه" type="search" />
        </div>
        <div className="flex rounded-xl bg-secondary p-1 gap-1">
          {["all", "free", "basic", "pro", "business"].map((p) => (
            <button key={p} onClick={() => setPlanF(p)} className={cn("px-3 h-9 rounded-lg text-sm", planF === p ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}>{p === "all" ? "الكل" : PLAN_AR[p]}</button>
          ))}
        </div>
      </div>

      {orgs.isLoading ? <div className="py-16 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        : orgs.error ? <Empty title="تعذّر التحميل" icon={<ShieldAlert />}>{errText(orgs.error)}</Empty>
        : rows.length === 0 ? <Empty title="لا محلات" icon={<Store />}>{q || planF !== "all" ? "لا نتائج لهذا البحث." : "أول محل يسجّل يظهر هنا."}</Empty>
        : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((o) => {
              const expired = o.plan_expires_at && new Date(o.plan_expires_at).getTime() < Date.now();
              const suspended = o.status !== "active";
              return (
                <article key={o.id} className={cn("rounded-xl border bg-card p-4 space-y-3", suspended ? "border-red-500/30" : "border-card-border")}>
                  <header className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><Building2 className="w-5 h-5" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold truncate">{o.name}</span>
                        <span className="text-[11px] rounded-full bg-secondary px-2 py-0.5">{VERTICAL_AR[o.vertical] ?? o.vertical}</span>
                        {suspended && <span className="text-[11px] rounded-full bg-red-500/15 text-red-300 px-2 py-0.5">موقوف</span>}
                        {!o.onboarded_at && <span className="text-[11px] rounded-full bg-amber-500/15 text-amber-300 px-2 py-0.5">لم يكمل الإعداد</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                        <span dir="ltr">/{o.slug}</span>
                        <span>{o.owner_name ?? "—"} · <span dir="ltr" className="tabular-nums">{o.owner_phone}</span></span>
                        <span>منذ {shortDate(o.created_at)}</span>
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className={cn("text-sm font-semibold", o.plan === "business" || o.plan === "pro" ? "text-primary" : "")}>{PLAN_AR[o.plan] ?? o.plan}</div>
                      <div className={cn("text-[11px]", expired ? "text-red-300" : "text-muted-foreground")}>
                        {o.plan_expires_at ? `${expired ? "انتهت" : "حتى"} ${shortDate(o.plan_expires_at)}` : "بلا انتهاء"}
                      </div>
                    </div>
                  </header>

                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {[
                      ["فروع", o.branches], ["أصناف", o.items], ["موظفون", o.staff], ["زبائن", o.customers],
                      ["تذاكر الأسبوع", o.tickets_7d], ["طلبات الأسبوع", o.orders_7d], ["حجوزات الأسبوع", o.bookings_7d], ["رسائل الأسبوع", o.sent_7d],
                    ].map(([l, v]) => (
                      <div key={l as string} className="rounded-lg bg-secondary/50 py-1.5">
                        <div className="font-bold tabular-nums text-sm">{v as number}</div>
                        <div className="text-[10px] text-muted-foreground">{l}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("flex items-center gap-1 rounded-full px-2 py-1", o.wa.linked ? "bg-emerald-500/15 text-emerald-300" : "bg-secondary text-muted-foreground")}>
                      <MessageCircle className="w-3.5 h-3.5" />واتساب {o.wa.linked}/{o.wa.total}
                    </span>
                    {o.last_login_at && <span className="text-muted-foreground">آخر دخول {shortDate(o.last_login_at)}</span>}
                    {Object.entries(o.features ?? {}).filter(([, v]) => v).map(([k]) => <span key={k} className="rounded-full bg-primary/10 text-primary px-2 py-1">{FEATURE_AR[k] ?? k}</span>)}
                  </div>

                  <footer className="flex flex-wrap gap-1.5">
                    <Btn tone="gold" className="min-h-10" disabled={busy === `as:${o.id}`} onClick={() => loginAs(o)}>
                      {busy === `as:${o.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}ادخل كصاحب المحل
                    </Btn>
                    <Btn className="min-h-10" onClick={() => setEdit(o)}><SlidersHorizontal className="w-4 h-4" />الخطة والميزات</Btn>
                    <a href={o.menuUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl px-3 min-h-10 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                      <ExternalLink className="w-4 h-4" />المنيو
                    </a>
                    <div className="flex-1" />
                    {suspended
                      ? <Btn tone="ok" className="min-h-10" disabled={busy === `${o.id}`} onClick={() => update(o, { status: "active" }, "فُعّل المحل")}><ShieldCheck className="w-4 h-4" />تفعيل</Btn>
                      : <Btn tone="danger" className="min-h-10" disabled={busy === `${o.id}`} onClick={() => { if (confirm(`إيقاف «${o.name}»؟ يتوقف دخول موظفيه وميزاته حتى تعيد تفعيله.`)) void update(o, { status: "suspended" }, "أُوقف المحل"); }}><ShieldAlert className="w-4 h-4" />إيقاف</Btn>}
                  </footer>
                </article>
              );
            })}
          </div>
        )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} onCreated={refresh} />
      <PlanDialog o={edit} onClose={() => setEdit(null)} onSave={async (o, body) => { if (await update(o, body, "حُفظت التغييرات")) setEdit(null); }} saving={!!edit && busy === `${edit.id}`} />
    </div>
  );
}

function PlanDialog({ o, onClose, onSave, saving }: { o: OrgRow | null; onClose: () => void; onSave: (o: OrgRow, body: Record<string, unknown>) => void; saving: boolean }) {
  const [plan, setPlan] = useState("pro");
  const [days, setDays] = useState<string>("30");
  const [touchDays, setTouchDays] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [lastId, setLastId] = useState<number | null>(null);
  if (o && o.id !== lastId) {
    setLastId(o.id); setPlan(o.plan); setDays("30"); setTouchDays(false); setFeatures({ ...(o.features ?? {}) });
  }
  if (!o) return null;
  const keys = Array.from(new Set([...FEATURES.map((f) => f.key), ...Object.keys(o.features ?? {}).filter((k) => !["reviews", "winback"].includes(k))]));

  const save = () => {
    const body: Record<string, unknown> = {};
    if (plan !== o.plan) body.plan = plan;
    if (touchDays || plan !== o.plan) body.planDays = Number(days) || 0;
    const changed = Object.fromEntries(keys.filter((k) => !!features[k] !== !!o.features?.[k]).map((k) => [k, !!features[k]]));
    if (Object.keys(changed).length) body.features = changed;
    if (!Object.keys(body).length) { onClose(); return; }
    onSave(o, body);
  };

  return (
    <Modal open={!!o} onOpenChange={(v) => !v && onClose()} title={o.name} description="الخطة ومدتها، والميزات الخاصة بهذا المحل.">
      <div className="space-y-4">
        <div>
          <label className={labelCls}>الخطة</label>
          <div className="grid grid-cols-4 gap-1.5">
            {Object.entries(PLAN_AR).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPlan(k)} className={cn("h-11 rounded-lg text-sm", plan === k ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>المدة من اليوم</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {[["7", "أسبوع"], ["30", "شهر"], ["90", "3 أشهر"], ["365", "سنة"], ["0", "بلا انتهاء"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => { setDays(v); setTouchDays(true); }} className={cn("px-3 h-10 rounded-lg text-sm", days === v && touchDays ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>{l}</button>
            ))}
            <input className={cn(inputCls, "w-24")} dir="ltr" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value.replace(/\D/g, "")); setTouchDays(true); }} aria-label="عدد الأيام" />
            <span className="text-xs text-muted-foreground">يوم</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            {o.plan_expires_at ? `الحالية تنتهي ${shortDate(o.plan_expires_at)}.` : "الحالية بلا انتهاء."} {touchDays || plan !== o.plan ? "تُحسب المدة الجديدة من اليوم." : "اتركها لتبقى المدة كما هي."}
          </div>
        </div>
        <div>
          <label className={labelCls}>الميزات</label>
          <div className="space-y-2">
            {keys.map((k) => (
              <label key={k} className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2.5 text-sm">
                <span>{FEATURE_AR[k] ?? k}</span>
                <Switch checked={!!features[k]} onCheckedChange={(v) => setFeatures((f) => ({ ...f, [k]: v }))} dir="ltr" />
              </label>
            ))}
          </div>
        </div>
        <Btn tone="gold" className="w-full min-h-12" disabled={saving} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}حفظ</Btn>
      </div>
    </Modal>
  );
}

/** A shop made for a customer: their account, their shop and their plan in one step. */
function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const empty = { name: "", nameEn: "", vertical: "restaurant", slug: "", ownerName: "", ownerPhone: "", password: "", plan: "pro", planDays: "30" };
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ menuUrl: string; loginUrl: string; phone: string; password: string; name: string } | null>(null);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const genPass = () => setF((x) => ({ ...x, password: Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("") }));
  const close = () => { setF(empty); setDone(null); onClose(); };

  const save = async () => {
    setSaving(true);
    try {
      const r = await post<{ menuUrl: string; loginUrl: string; ownerPhone: string }>("/api/admin/orgs", { ...f, planDays: Number(f.planDays) || 0 });
      setDone({ menuUrl: r.menuUrl, loginUrl: r.loginUrl, phone: r.ownerPhone, password: f.password, name: f.name });
      toast.success("تم إنشاء المحل");
      onCreated();
    } catch (e) { toast.error(errText(e)); }
    finally { setSaving(false); }
  };
  const message = done ? `أهلاً 👋\nتم تجهيز منيو «${done.name}» على منيو فور يو.\n\nالمنيو: ${done.menuUrl}\nلوحة التحكم: ${done.loginUrl}\nرقم الدخول: ${done.phone}\nكلمة المرور: ${done.password}\n\nغيّر كلمة المرور بعد أول دخول.` : "";

  return (
    <Modal open={open} onOpenChange={(v) => !v && close()} title={done ? "المحل جاهز" : "محل جديد"} description={done ? "أرسل بيانات الدخول لصاحب المحل — تظهر هنا مرة واحدة." : "حساب صاحب المحل والمحل والخطة في خطوة واحدة."}>
      {done ? (
        <div className="space-y-3">
          <pre className="whitespace-pre-wrap text-sm rounded-xl bg-secondary/60 p-4 leading-relaxed" dir="rtl">{message}</pre>
          <div className="grid grid-cols-2 gap-2">
            <Btn tone="gold" onClick={() => { void navigator.clipboard.writeText(message); toast.success("نُسخت الرسالة"); }}><Copy className="w-4 h-4" />نسخ الرسالة</Btn>
            <a href={done.menuUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold bg-secondary"><ExternalLink className="w-4 h-4" />افتح المنيو</a>
          </div>
          <Btn className="w-full" onClick={close}>تم</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>اسم المحل *</label><input className={inputCls} value={f.name} onChange={set("name")} placeholder="مطعم البيت الشامي" /></div>
            <div><label className={labelCls}>الاسم بالإنجليزي</label><input className={inputCls} dir="ltr" value={f.nameEn} onChange={set("nameEn")} placeholder="Bait Shami" /></div>
          </div>
          <div>
            <label className={labelCls}>نوع المحل</label>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(VERTICAL_AR).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setF((x) => ({ ...x, vertical: k }))} className={cn("h-11 rounded-lg text-sm", f.vertical === k ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>{l}</button>
              ))}
            </div>
          </div>
          <div><label className={labelCls}>رابط المنيو (اختياري — يُقترح من الاسم)</label><input className={inputCls} dir="ltr" value={f.slug} onChange={(e) => setF((x) => ({ ...x, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} placeholder="bait-shami" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>اسم صاحب المحل</label><input className={inputCls} value={f.ownerName} onChange={set("ownerName")} /></div>
            <div><label className={labelCls}>جواله (للدخول) *</label><input className={inputCls} dir="ltr" inputMode="tel" value={f.ownerPhone} onChange={set("ownerPhone")} placeholder="9715xxxxxxxx" /></div>
          </div>
          <div>
            <label className={labelCls}>كلمة المرور *</label>
            <div className="flex gap-2"><input className={inputCls} dir="ltr" value={f.password} onChange={set("password")} placeholder="6 أحرف على الأقل" /><Btn type="button" onClick={genPass}>توليد</Btn></div>
          </div>
          <div>
            <label className={labelCls}>الخطة والمدة</label>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(PLAN_AR).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setF((x) => ({ ...x, plan: k }))} className={cn("h-11 rounded-lg text-sm", f.plan === k ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>{l}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {[["14", "تجربة 14 يوم"], ["30", "شهر"], ["365", "سنة"], ["0", "بلا انتهاء"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setF((x) => ({ ...x, planDays: v! }))} className={cn("px-3 h-10 rounded-lg text-sm", f.planDays === v ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>{l}</button>
              ))}
            </div>
          </div>
          <Btn tone="gold" className="w-full min-h-12" disabled={saving || !f.name.trim() || !f.ownerPhone.trim() || f.password.length < 6} onClick={save}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}أنشئ المحل</Btn>
        </div>
      )}
    </Modal>
  );
}
