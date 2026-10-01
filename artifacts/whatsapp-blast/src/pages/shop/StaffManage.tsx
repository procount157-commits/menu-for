// ── /staff — who works the counter ────────────────────────────────
// Staff sign in with the shop's address, a username and a password the
// owner sets here; there is no email or phone to verify. After adding or
// resetting someone, the page shows the details once, ready to send them.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Loader2, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { del, get, patch, post, useShop, inputCls } from "@/lib/shop-api";
import {
  CopyButton, Empty, Field, Modal, PageHeader, Skel, Toggle, UpgradeNotice, btnGhost, btnPrimary, btnQuiet, iconBtn, isPlanError,
} from "@/components/shop/setup/kit";

interface Staff {
  id: number; name: string; username: string; role: "staff" | "manager"; branchId: number | null;
  isActive: boolean; lastLoginAt: string | null; createdAt: string;
}
interface StaffResp { staff: Staff[]; loginUrl: string; shop: string }

const KEY = ["/api/staff"];

const ROLES = [
  { id: "staff" as const, title: "موظف", sub: "شاشة الصف والطلبات والحجوزات لفرعه بس — ما يشوف المنيو ولا الإعدادات." },
  { id: "manager" as const, title: "مدير فرع", sub: "كل اللي للموظف، ويعدّل المنيو والتوفّر ويشوف الزبائن والتقارير." },
];

function genPassword() {
  // No look-alikes (0/O, 1/l): it gets read aloud or typed off a phone.
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = new Uint32Array(8); crypto.getRandomValues(b);
  return Array.from(b, (n) => a[n % a.length]).join("");
}

function lastSeen(iso: string | null) {
  if (!iso) return "ما دخل بعد";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 2) return "دخل الحين";
  if (m < 60) return `آخر دخول قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `آخر دخول قبل ${h} ساعة`;
  return `آخر دخول قبل ${Math.round(h / 24)} يوم`;
}

type Draft = { id?: number; name: string; username: string; password: string; role: "staff" | "manager"; branchId: number | null };

export default function StaffManage() {
  const shop = useShop();
  const qc = useQueryClient();
  const q = useQuery<StaffResp>({ queryKey: KEY, queryFn: () => get("/api/staff") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetFor, setResetFor] = useState<Staff | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [shared, setShared] = useState<{ name: string; username: string; password: string } | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  const branchName = (id: number | null) => (id ? shop.branches.find((b) => b.id === id)?.name ?? "فرع محذوف" : "كل الفروع");
  const multiBranch = shop.branches.length > 1;

  const save = useMutation({
    mutationFn: (d: Draft) => d.id
      ? patch(`/api/staff/${d.id}`, { name: d.name, role: d.role, branchId: d.branchId })
      : post("/api/staff", { name: d.name, username: d.username, password: d.password, role: d.role, branchId: d.branchId }),
    onSuccess: (_r, d) => {
      qc.invalidateQueries({ queryKey: KEY });
      setDraft(null);
      if (!d.id) setShared({ name: d.name, username: d.username.trim().toLowerCase(), password: d.password });
      else toast.success("انحفظ");
    },
    onError: (e) => { if (isPlanError(e)) { setDraft(null); setUpgrade(e.message); } else toast.error((e as Error).message); },
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => patch(`/api/staff/${id}`, { isActive }),
    // Optimistic: the toggle should move under the finger, not after the round trip.
    onMutate: async ({ id, isActive }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<StaffResp>(KEY);
      if (prev) qc.setQueryData<StaffResp>(KEY, { ...prev, staff: prev.staff.map((s) => (s.id === id ? { ...s, isActive } : s)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      if (isPlanError(e)) setUpgrade(e.message); else toast.error((e as Error).message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const reset = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => patch(`/api/staff/${id}`, { password }),
    onSuccess: (_r, v) => {
      const s = resetFor!;
      setResetFor(null);
      setShared({ name: s.name, username: s.username, password: v.password });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => del(`/api/staff/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("انحذف"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const staff = q.data?.staff ?? [];
  const activeCount = staff.filter((s) => s.isActive).length;
  const limit = shop.plan.limits.staff;
  const atLimit = limit >= 0 && activeCount >= limit;

  const shareText = shared && q.data
    ? `هلا ${shared.name}، هذي بيانات دخولك لشاشة ${shop.org.name}:\n${q.data.loginUrl}\nاسم الدخول: ${shared.username}\nكلمة المرور: ${shared.password}`
    : "";

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl" dir="rtl">
      <PageHeader
        icon={<Users className="w-6 h-6 text-primary" />}
        title="الموظفون"
        sub="كل موظف له حساب يدخل فيه من جواله أو تابلت الكاونتر، ويشوف بس اللي يخصه."
        actions={
          <button className={btnPrimary} onClick={() => atLimit ? setUpgrade(`باقتك تسمح بـ ${limit} موظفين نشطين — رقّها عشان تضيف أكثر، أو أوقف حساب قديم.`) : setDraft({ name: "", username: "", password: genPassword(), role: "staff", branchId: multiBranch ? shop.branch.id : null })}>
            <Plus className="w-4 h-4" />أضف موظف
          </button>
        }
      />

      {upgrade && <UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} />}

      <section className="bg-card border border-card-border rounded-2xl p-4 sm:p-5 space-y-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">رابط دخول الموظفين — يفتحه على جهاز الكاونتر ويحفظه</div>
          {q.data ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-primary truncate max-w-full" dir="ltr">{q.data.loginUrl.replace(/^https?:\/\//, "")}</span>
              <CopyButton text={q.data.loginUrl} className="ms-auto" />
            </div>
          ) : <Skel className="h-6 w-64" />}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 pt-1">
          {ROLES.map((r) => (
            <div key={r.id} className="flex gap-3 rounded-xl bg-muted/40 p-3">
              {r.id === "manager" ? <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" /> : <UserCog className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
              <div><div className="text-sm font-medium">{r.title}</div><div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{r.sub}</div></div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        {q.isLoading && [0, 1, 2].map((i) => <Skel key={i} className="h-[72px] rounded-xl" />)}
        {q.data && !staff.length && (
          <Empty icon={<Users className="w-5 h-5" />} title="ما فيه موظفين للحين"
            sub="أضف الكاشير أو المضيف عشان يشغّل «التالي» من جهازه، وأنت تتابع من جوالك."
            action={<button className={btnPrimary} onClick={() => setDraft({ name: "", username: "", password: genPassword(), role: "staff", branchId: multiBranch ? shop.branch.id : null })}><Plus className="w-4 h-4" />أضف أول موظف</button>} />
        )}
        {staff.map((s) => (
          <div key={s.id} className={cn("bg-card border border-card-border rounded-xl px-4 py-3 flex items-center gap-3", !s.isActive && "opacity-60")}>
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">{s.name.trim()[0]}</div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium truncate">{s.name}</span>
                <span className={cn("text-[11px] px-2 py-0.5 rounded-full", s.role === "manager" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{s.role === "manager" ? "مدير فرع" : "موظف"}</span>
                {!s.isActive && <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">موقوف</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                <span dir="ltr" className="font-mono">{s.username}</span>
                {multiBranch && <> · {branchName(s.branchId)}</>}
                {" · "}{lastSeen(s.lastLoginAt)}
              </div>
            </div>
            <Toggle checked={s.isActive} label="نشط" onChange={(v) => setActive.mutate({ id: s.id, isActive: v })} />
            <div className="relative">
              <button className={iconBtn} onClick={() => setMenuFor(menuFor === s.id ? null : s.id)} aria-label="خيارات"><MoreHorizontal className="w-4 h-4" /></button>
              {menuFor === s.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                  <div className="absolute left-0 top-9 z-20 w-44 rounded-xl border border-popover-border bg-popover shadow-xl p-1 text-sm">
                    <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted text-start" onClick={() => { setMenuFor(null); setDraft({ id: s.id, name: s.name, username: s.username, password: "", role: s.role, branchId: s.branchId }); }}><Pencil className="w-3.5 h-3.5" />تعديل</button>
                    <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted text-start" onClick={() => { setMenuFor(null); setResetPw(genPassword()); setResetFor(s); }}><KeyRound className="w-3.5 h-3.5" />كلمة مرور جديدة</button>
                    <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-destructive/10 text-destructive text-start" onClick={() => { setMenuFor(null); if (confirm(`حذف ${s.name} نهائياً؟ لو تبيه يرجع بعدين، أوقفه بدال الحذف.`)) remove.mutate(s.id); }}><Trash2 className="w-3.5 h-3.5" />حذف</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {limit >= 0 && staff.length > 0 && <div className="text-xs text-muted-foreground pt-1">{activeCount} من {limit} موظفين نشطين في باقة {shop.plan.planName}</div>}
      </section>

      {/* add / edit */}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `تعديل ${draft.name}` : "موظف جديد"}
        footer={<>
          <button className={btnQuiet} onClick={() => setDraft(null)}>إلغاء</button>
          <button className={btnPrimary} disabled={save.isPending || !draft?.name.trim() || (!draft?.id && (draft!.username.length < 3 || draft!.password.length < 6))} onClick={() => draft && save.mutate(draft)}>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{draft?.id ? "احفظ" : "أضف"}
          </button>
        </>}>
        {draft && (
          <div className="space-y-4">
            <Field label="الاسم"><input autoFocus className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="مثلاً: أحمد" /></Field>
            {!draft.id && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="اسم الدخول" hint="إنجليزي صغير وأرقام">
                  <input className={cn(inputCls, "font-mono")} dir="ltr" value={draft.username} placeholder="ahmed"
                    onChange={(e) => setDraft({ ...draft, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "") })} />
                </Field>
                <Field label="كلمة المرور" hint={<button type="button" className="text-primary" onClick={() => setDraft({ ...draft, password: genPassword() })}>ولّد وحدة جديدة</button>}>
                  <input className={cn(inputCls, "font-mono")} dir="ltr" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
                </Field>
              </div>
            )}
            <div>
              <div className="text-sm text-muted-foreground mb-1.5">الصلاحية</div>
              <div className="grid gap-2">
                {ROLES.map((r) => (
                  <button key={r.id} type="button" onClick={() => setDraft({ ...draft, role: r.id })}
                    className={cn("text-start rounded-xl border p-3 transition-colors", draft.role === r.id ? "border-primary bg-primary/10" : "border-card-border hover:border-primary/40")}>
                    <div className="text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.sub}</div>
                  </button>
                ))}
              </div>
            </div>
            {multiBranch && (
              <Field label="الفرع">
                <select className={inputCls} value={draft.branchId ?? ""} onChange={(e) => setDraft({ ...draft, branchId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">كل الفروع</option>
                  {shop.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
      </Modal>

      {/* new password */}
      <Modal open={!!resetFor} onClose={() => setResetFor(null)} title={`كلمة مرور جديدة لـ ${resetFor?.name ?? ""}`} sub="القديمة تبطل على طول."
        footer={<>
          <button className={btnQuiet} onClick={() => setResetFor(null)}>إلغاء</button>
          <button className={btnPrimary} disabled={reset.isPending || resetPw.length < 6} onClick={() => resetFor && reset.mutate({ id: resetFor.id, password: resetPw })}>
            {reset.isPending && <Loader2 className="w-4 h-4 animate-spin" />}غيّر
          </button>
        </>}>
        <Field label="كلمة المرور" hint="6 أحرف على الأقل">
          <div className="flex gap-2">
            <input className={cn(inputCls, "font-mono")} dir="ltr" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
            <button type="button" className={btnGhost} onClick={() => setResetPw(genPassword())}>ولّد</button>
          </div>
        </Field>
      </Modal>

      {/* the details, once */}
      <Modal open={!!shared} onClose={() => setShared(null)} title="أرسل له بيانات الدخول" sub="ما نقدر نعرض كلمة المرور مرة ثانية — انسخها الحين."
        footer={<>
          <button className={btnQuiet} onClick={() => setShared(null)}>تم</button>
          <CopyButton text={shareText} label="انسخ الرسالة" className="bg-primary text-primary-foreground border-primary" />
        </>}>
        {shared && q.data && (
          <div className="rounded-xl bg-muted/50 p-4 space-y-2 text-sm">
            <Row k="رابط الدخول" v={q.data.loginUrl} />
            <Row k="المحل" v={q.data.shop} />
            <Row k="اسم الدخول" v={shared.username} />
            <Row k="كلمة المرور" v={shared.password} />
          </div>
        )}
      </Modal>

      {remove.isPending && <div className="fixed bottom-4 left-4 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />يحذف…</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className="font-mono truncate" dir="ltr">{v}</span>
    </div>
  );
}
