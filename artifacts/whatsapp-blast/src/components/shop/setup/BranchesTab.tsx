// ── Settings › الفروع ─────────────────────────────────────────────
// A branch either shares the owner's WhatsApp number or has its own (a plan
// feature: the server makes a service account to hold that session). Hours
// are per weekday, 0 = Sunday as in Date#getDay, and a closing time at or
// before the opening time means the branch closes after midnight.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ExternalLink, Loader2, Lock, MapPin, MessageCircle, Moon, Pencil, Phone, Plus, RefreshCw, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { SHOP_KEY, get, patch, post, useShop, useSwitchBranch, inputCls } from "@/lib/shop-api";
import { CopyButton, Field, Modal, Skel, Toggle, ToggleRow, UpgradeNotice, btnGhost, btnPrimary, btnQuiet, isPlanError } from "./kit";

type Hours = Record<string, { open: string; close: string; closed?: boolean }>;

export interface Branch {
  id: number; name: string; nameEn: string | null; slug: string; address: string | null; mapUrl: string | null;
  displayPhone: string | null; waPhone: string | null; hours: Hours; isActive: boolean; ownNumber: boolean; sort: number;
  wa: { connected: boolean; status: string; phone: string | null }; menuUrl: string; displayUrl: string;
}

const KEY = ["/api/branches"];
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function hoursSummary(h: Hours) {
  const open = Object.entries(h ?? {}).filter(([, v]) => !v.closed);
  if (!open.length) return "ما فيه ساعات عمل";
  const first = open[0]![1];
  const same = open.every(([, v]) => v.open === first.open && v.close === first.close);
  const closed = 7 - open.length;
  return `${same ? `${first.open}–${first.close}` : "ساعات مختلفة"}${closed ? ` · مغلق ${closed === 1 ? "يوم" : `${closed} أيام`}` : " · كل يوم"}`;
}

export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const day = (d: string) => value[d] ?? { open: "09:00", close: "23:00" };
  const set = (d: string, v: Partial<Hours[string]>) => onChange({ ...value, [d]: { ...day(d), ...v } });
  const copyToAll = (d: string) => { const src = day(d); const out: Hours = {}; for (let i = 0; i < 7; i++) out[String(i)] = { ...src }; onChange(out); };
  return (
    <div className="divide-y divide-border rounded-xl border border-card-border">
      {DAYS.map((name, i) => {
        const d = String(i), v = day(d);
        const overnight = !v.closed && v.close <= v.open;
        return (
          <div key={d} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="w-20 text-sm">{name}</div>
            <Toggle checked={!v.closed} onChange={(on) => set(d, on ? { closed: false, open: v.open === "00:00" && v.close === "00:00" ? "09:00" : v.open, close: v.open === "00:00" && v.close === "00:00" ? "23:00" : v.close } : { closed: true })} label={`${name} مفتوح`} />
            {v.closed ? <span className="text-xs text-muted-foreground">مغلق</span> : (
              <div className="flex items-center gap-2" dir="ltr">
                <input type="time" className={cn(inputCls, "w-[7.5rem] py-1.5")} value={v.open} onChange={(e) => set(d, { open: e.target.value })} />
                <span className="text-muted-foreground">–</span>
                <input type="time" className={cn(inputCls, "w-[7.5rem] py-1.5")} value={v.close} onChange={(e) => set(d, { close: e.target.value })} />
              </div>
            )}
            {overnight && <span className="text-[11px] text-primary flex items-center gap-1"><Moon className="w-3 h-3" />يسكّر بعد نص الليل</span>}
            <button type="button" className="ms-auto text-[11px] text-muted-foreground hover:text-primary" onClick={() => copyToAll(d)}>طبّق على الكل</button>
          </div>
        );
      })}
    </div>
  );
}

type NewBranch = { name: string; nameEn: string; slug: string; address: string; displayPhone: string; ownNumber: boolean };

export default function BranchesTab() {
  const shop = useShop();
  const qc = useQueryClient();
  const switchBranch = useSwitchBranch();
  const [, go] = useLocation();
  const q = useQuery<Branch[]>({ queryKey: KEY, queryFn: () => get("/api/branches") });
  const [adding, setAdding] = useState<NewBranch | null>(null);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  // Shown inside the add dialog, where the owner is looking when they tap the locked option.
  const [addNotice, setAddNotice] = useState<string | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: SHOP_KEY }); };

  const create = useMutation({
    mutationFn: (b: NewBranch) => post("/api/branches", { ...b, slug: b.slug || undefined }),
    onSuccess: () => { refresh(); setAdding(null); toast.success("انضاف الفرع — عدّل ساعاته من «تعديل»"); },
    onError: (e) => { if (isPlanError(e)) setAddNotice(e.message); else toast.error((e as Error).message); },
  });

  const rows = q.data ?? [];
  const limit = shop.plan.limits.branches;
  const atLimit = limit >= 0 && rows.length >= limit;
  const canOwnNumber = shop.plan.features.branchNumbers;

  return (
    <div className="space-y-4">
      {upgrade && <UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{limit >= 0 ? `${rows.length} من ${limit} فروع في باقة ${shop.plan.planName}` : `${rows.length} فروع`}</p>
        <button className={btnPrimary} onClick={() => atLimit
          ? setUpgrade(`باقتك تسمح بـ ${limit} ${limit === 1 ? "فرع" : "فروع"} — رقّها عشان تضيف فرع جديد.`)
          : (setAddNotice(null), setAdding({ name: "", nameEn: "", slug: "", address: "", displayPhone: "", ownNumber: false }))}>
          <Plus className="w-4 h-4" />أضف فرع
        </button>
      </div>

      {q.isLoading && [0, 1].map((i) => <Skel key={i} className="h-36 rounded-2xl" />)}
      {rows.map((b) => (
        <div key={b.id} className={cn("bg-card border border-card-border rounded-2xl p-4 sm:p-5", !b.isActive && "opacity-60")}>
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Store className="w-5 h-5" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.name}</span>
                {b.id === shop.branch.id && rows.length > 1 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">الحالي</span>}
                {!b.isActive && <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">موقوف</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                {b.address && <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{b.address}</div>}
                <div>{hoursSummary(b.hours)}</div>
              </div>
            </div>
            <button className={cn(btnGhost, "text-xs")} onClick={() => setEditing(b)}><Pencil className="w-3.5 h-3.5" />تعديل</button>
          </div>
          <div className="mt-4 grid sm:grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-muted/40 px-3 py-2.5 flex items-center gap-2">
              <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {b.ownNumber ? "رقم خاص بالفرع" : "على الرقم الرئيسي"}
                {" · "}
                {b.wa.connected ? <span className="text-emerald-400">مربوط{b.wa.phone ? ` (${b.wa.phone})` : ""}</span> : <span className="text-amber-400">غير مربوط</span>}
              </span>
              {!b.wa.connected && (
                <button className="text-primary shrink-0" onClick={async () => { if (b.id !== shop.branch.id) await switchBranch(b.id); go("/connect"); }}>اربط</button>
              )}
            </div>
            <div className="rounded-xl bg-muted/40 px-3 py-2.5 flex items-center gap-2">
              <span className="font-mono truncate flex-1 text-muted-foreground" dir="ltr">{b.menuUrl.replace(/^https?:\/\//, "")}</span>
              <a href={b.menuUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><ExternalLink className="w-3.5 h-3.5" /></a>
            </div>
          </div>
        </div>
      ))}

      {/* add */}
      <Modal open={!!adding} onClose={() => setAdding(null)} title="فرع جديد" sub="يبدأ بصف انتظار وساعات افتراضية، وتعدّلها بعدين."
        footer={<>
          <button className={btnQuiet} onClick={() => setAdding(null)}>إلغاء</button>
          <button className={btnPrimary} disabled={create.isPending || (adding?.name.trim().length ?? 0) < 2} onClick={() => adding && create.mutate(adding)}>
            {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}أضف الفرع
          </button>
        </>}>
        {adding && (
          <div className="space-y-4">
            {addNotice && <UpgradeNotice message={addNotice} onClose={() => setAddNotice(null)} />}
            <div className="grid grid-cols-2 gap-3">
              <Field label="اسم الفرع"><input autoFocus className={inputCls} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="فرع الجيمي" /></Field>
              <Field label="بالإنجليزي"><input className={inputCls} dir="ltr" value={adding.nameEn} onChange={(e) => setAdding({ ...adding, nameEn: e.target.value })} placeholder="Al Jimi" /></Field>
            </div>
            <Field label="رابط الفرع" hint={`${shop.org.slug}/${adding.slug || "…"} — نولّده من الاسم لو تركته فاضي`}>
              <input className={cn(inputCls, "font-mono")} dir="ltr" value={adding.slug} onChange={(e) => setAdding({ ...adding, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="al-jimi" />
            </Field>
            <Field label="العنوان"><input className={inputCls} value={adding.address} onChange={(e) => setAdding({ ...adding, address: e.target.value })} /></Field>
            <Field label="هاتف للعرض"><input className={inputCls} dir="ltr" value={adding.displayPhone} onChange={(e) => setAdding({ ...adding, displayPhone: e.target.value })} placeholder="+971 3 000 0000" /></Field>
            <div>
              <div className="text-sm text-muted-foreground mb-1.5">رقم الواتساب</div>
              <div className="grid gap-2">
                <button type="button" onClick={() => setAdding({ ...adding, ownNumber: false })}
                  className={cn("text-start rounded-xl border p-3", !adding.ownNumber ? "border-primary bg-primary/10" : "border-card-border")}>
                  <div className="text-sm font-medium">استخدم الرقم الرئيسي</div>
                  <div className="text-xs text-muted-foreground mt-0.5">الرسائل تطلع من نفس رقم المحل — أسهل بداية.</div>
                </button>
                <button type="button" onClick={() => canOwnNumber ? setAdding({ ...adding, ownNumber: true }) : setAddNotice(`رقم واتساب خاص لكل فرع مو ضمن باقة ${shop.plan.planName} — يحتاج باقة أعلى.`)}
                  className={cn("text-start rounded-xl border p-3", adding.ownNumber ? "border-primary bg-primary/10" : "border-card-border", !canOwnNumber && "opacity-70")}>
                  <div className="text-sm font-medium flex items-center gap-1.5">رقم خاص بالفرع {!canOwnNumber && <Lock className="w-3.5 h-3.5 text-primary" />}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">كل فرع يربط جواله، والزبون يكلّم فرعه مباشرة.</div>
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {editing && <EditBranch key={editing.id} branch={editing} onClose={() => setEditing(null)} onSaved={refresh} canDeactivate={rows.filter((r) => r.isActive).length > 1 || !editing.isActive} />}
    </div>
  );
}

function EditBranch({ branch, onClose, onSaved, canDeactivate }: { branch: Branch; onClose: () => void; onSaved: () => void; canDeactivate: boolean }) {
  const shop = useShop();
  const [f, setF] = useState({
    name: branch.name, nameEn: branch.nameEn ?? "", slug: branch.slug, address: branch.address ?? "", mapUrl: branch.mapUrl ?? "",
    displayPhone: branch.displayPhone ?? "", waPhone: branch.waPhone ?? "", isActive: branch.isActive, hours: branch.hours ?? {},
  });
  const [displayUrl, setDisplayUrl] = useState(branch.displayUrl);
  useEffect(() => setDisplayUrl(branch.displayUrl), [branch.displayUrl]);

  const save = useMutation({
    mutationFn: () => patch(`/api/branches/${branch.id}`, { ...f, waPhone: f.waPhone.replace(/\D/g, "") }),
    onSuccess: () => { onSaved(); onClose(); toast.success("انحفظ الفرع"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const rotate = useMutation({
    mutationFn: () => post<{ displayUrl: string }>(`/api/branches/${branch.id}/rotate-display`),
    onSuccess: (r) => { setDisplayUrl(r.displayUrl); onSaved(); toast.success("رابط جديد — افتحه على الشاشة من جديد"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const waDigits = f.waPhone.replace(/\D/g, "");
  const waBad = waDigits.length > 0 && (waDigits.length < 8 || waDigits.length > 15);

  return (
    <Modal open onClose={onClose} wide title={`تعديل ${branch.name}`}
      footer={<>
        <button className={btnQuiet} onClick={onClose}>إلغاء</button>
        <button className={btnPrimary} disabled={save.isPending || f.name.trim().length < 2 || waBad} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}احفظ
        </button>
      </>}>
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="اسم الفرع"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="بالإنجليزي"><input className={inputCls} dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
          <Field label="رابط الفرع" hint={f.slug !== branch.slug ? <span className="text-amber-400">تغيير الرابط يعطّل أي QR مطبوع لهذا الفرع.</span> : `${shop.org.slug}/${f.slug}`}>
            <input className={cn(inputCls, "font-mono")} dir="ltr" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
          </Field>
          <Field label="العنوان"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="رابط الخريطة" hint="من Google Maps ← مشاركة ← نسخ الرابط">
            <input className={inputCls} dir="ltr" value={f.mapUrl} onChange={(e) => setF({ ...f, mapUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" />
          </Field>
          <Field label="هاتف للعرض" hint="يطلع للزبون في صفحة المنيو">
            <div className="relative"><Phone className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 left-3 text-muted-foreground" />
              <input className={cn(inputCls, "pl-8")} dir="ltr" value={f.displayPhone} onChange={(e) => setF({ ...f, displayPhone: e.target.value })} /></div>
          </Field>
          <Field label="رقم الواتساب اللي يراسله الزبون" className="sm:col-span-2"
            hint={waBad ? <span className="text-destructive">أرقام فقط، 8 إلى 15 رقم مع رمز الدولة</span> : "أرقام فقط مع رمز الدولة، مثل 971501234567. فاضي = رقم الواتساب المربوط."}>
            <input className={cn(inputCls, "font-mono")} dir="ltr" inputMode="numeric" value={f.waPhone} onChange={(e) => setF({ ...f, waPhone: e.target.value.replace(/[^\d+ ]/g, "") })} placeholder="971501234567" />
          </Field>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">ساعات العمل</div>
          <HoursEditor value={f.hours} onChange={(hours) => setF({ ...f, hours })} />
        </div>

        <div className="rounded-xl border border-card-border p-3 space-y-2">
          <div className="text-sm font-medium">رابط شاشة العرض (TV)</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-0" dir="ltr">{displayUrl.replace(/^https?:\/\//, "")}</span>
            <CopyButton text={displayUrl} />
            <button className={cn(btnGhost, "text-xs px-3 py-1.5")} disabled={rotate.isPending}
              onClick={() => confirm("نطلع رابط جديد للشاشة؟ الرابط القديم يوقف على طول — استخدمها لو أحد غريب صار عنده الرابط.") && rotate.mutate()}>
              {rotate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}رابط جديد
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-card-border px-3">
          <ToggleRow title="الفرع شغّال" hint={canDeactivate ? "إيقافه يخفيه من المنيو ويقفل صفه وحجوزاته." : "ما تقدر توقف الفرع الوحيد."}
            checked={f.isActive} disabled={!canDeactivate && f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
        </div>
      </div>
    </Modal>
  );
}
