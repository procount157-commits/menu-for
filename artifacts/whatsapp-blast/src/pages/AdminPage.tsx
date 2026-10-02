import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import {
  Users, Shield, Ban, Trash2, Plus, CheckCircle,
  Loader2, Phone, BarChart3, RefreshCw, ChevronDown, ChevronUp,
  DollarSign, Link2, Copy, RotateCcw, Crown, Zap, Star, KeyRound,
  MessageCircle, QrCode, WifiOff, Ticket, Gift, Calendar,
  Clock, Eye, EyeOff, Percent, Package, Edit2, UserPlus, ToggleLeft, ToggleRight, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────
interface UserEntry {
  id:                  number;
  phone:               string;
  displayName:         string | null;
  isAdmin:             boolean;
  status:              string;
  createdAt:           string;
  lastLoginAt:         string | null;
  plan:                string;
  planExpiresAt:       string | null;
  monthlyPrice:        string | null;
  notes:               string | null;
  qrDisabled:          boolean;
  connectToken:        string | null;
  directLoginToken:    string | null;
  contactGroupsCount:  number;
  campaignsCount:      number;
  dailyMessageLimit:   number | null;
}

interface AdminStats {
  totalUsers:        number;
  activeUsers:       number;
  totalCampaigns:    number;
  totalMessagesSent: number;
  monthlyRevenue:    number;
  planCounts:        Record<string, number>;
}

interface Coupon {
  id:          number;
  code:        string;
  label:       string | null;
  type:        string;
  planUpgrade: string | null;
  daysAdded:   number | null;
  maxUses:     number | null;
  usedCount:   number;
  expiresAt:   string | null;
  createdAt:   string;
}

const PLANS = [
  { value: "free",  label: "تجريبي",  icon: "⬜" },
  { value: "basic", label: "أساسي",   icon: "🔵" },
  { value: "pro",   label: "احترافي", icon: "🟡" },
  { value: "business", label: "أعمال", icon: "🟢" },
] as const;

const PLAN_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  free:  { label: "مجاني",   color: "text-muted-foreground", bg: "bg-muted/40",      icon: Users  },
  basic: { label: "أساسي",   color: "text-blue-400",         bg: "bg-blue-500/10",   icon: Zap    },
  pro:   { label: "احترافي", color: "text-yellow-400",       bg: "bg-yellow-500/10", icon: Crown  },
};

const inputCls = "w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/admin${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "حدث خطأ");
  return data;
}

function getPublicQrUrl(token: string)    { return `${window.location.origin}/wa/${token}`; }
function getDirectLoginUrl(token: string) { return `${window.location.origin}/login/${token}`; }

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA", { year: "2-digit", month: "short", day: "numeric" });
}
function formatRelative(d: string | null): string {
  if (!d) return "لم يدخل بعد";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "الآن";
  if (mins < 60) return `${mins}د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}س`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}ي`;
  return formatDate(d);
}

// ── Plan Edit Panel ────────────────────────────────────────────────
function PlanPanel({ user, onSave }: { user: UserEntry; onSave: (u: Partial<UserEntry>) => void }) {
  const [plan,        setPlan]        = useState(user.plan || "free");
  const [price,       setPrice]       = useState(user.monthlyPrice || "0");
  const [expiry,      setExpiry]      = useState(user.planExpiresAt ? user.planExpiresAt.split("T")[0] : "");
  const [notes,       setNotes]       = useState(user.notes || "");
  const [dailyLimit,  setDailyLimit]  = useState(user.dailyMessageLimit ? String(user.dailyMessageLimit) : "");
  const [newPw,       setNewPw]       = useState("");
  const [showPw,      setShowPw]      = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [savingPw,    setSavingPw]    = useState(false);
  const [savingQr,    setSavingQr]    = useState(false);
  const [regen,       setRegen]       = useState(false);
  const [regenD,      setRegenD]      = useState(false);
  const [localToken,  setLocalToken]  = useState(user.connectToken || "");
  const [localDirect, setLocalDirect] = useState(user.directLoginToken || "");
  const [qrDisabled,  setQrDisabled]  = useState(user.qrDisabled);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          plan, monthlyPrice: price,
          planExpiresAt: expiry || null,
          notes,
          dailyMessageLimit: dailyLimit ? parseInt(dailyLimit) : null,
        }),
      });
      onSave({ plan, monthlyPrice: price, planExpiresAt: expiry || null, notes, dailyMessageLimit: dailyLimit ? parseInt(dailyLimit) : null });
      toast.success("تم حفظ إعدادات المشترك");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const toggleQrAccess = async (disable: boolean) => {
    setSavingQr(true);
    try {
      await apiFetch(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ qrDisabled: disable }) });
      setQrDisabled(disable);
      onSave({ qrDisabled: disable });
      toast.success(disable ? "🔒 تم إيقاف الوصول للـ QR" : "✅ تم تفعيل الوصول للـ QR");
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingQr(false); }
  };

  const resetPassword = async () => {
    if (!newPw || newPw.length < 6) { toast.error("6 أحرف على الأقل"); return; }
    setSavingPw(true);
    try {
      await apiFetch(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password: newPw }) });
      setNewPw("");
      toast.success("تم تغيير كلمة المرور ✓");
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingPw(false); }
  };

  const regenToken = async () => {
    setRegen(true);
    try {
      const d = await apiFetch(`/users/${user.id}/regenerate-token`, { method: "POST" });
      setLocalToken(d.connectToken);
      toast.success("تم تجديد رابط QR");
    } catch (e: any) { toast.error(e.message); }
    finally { setRegen(false); }
  };

  const regenDirectToken = async () => {
    setRegenD(true);
    try {
      const res = await fetch(`/api/auth/direct/regenerate/${user.id}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setLocalDirect(d.directLoginToken);
      toast.success("تم تجديد رابط الدخول المباشر");
    } catch (e: any) { toast.error(e.message); }
    finally { setRegenD(false); }
  };

  return (
    <div className="px-4 pb-4 pt-2 border-t border-card-border space-y-4">
      {/* ── QR Access Control ─────────────────────────────── */}
      <div className={cn(
        "rounded-xl p-4 border",
        qrDisabled
          ? "bg-red-500/10 border-red-500/30"
          : "bg-green-500/10 border-green-500/30"
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <QrCode className={cn("w-4 h-4", qrDisabled ? "text-red-400" : "text-green-400")} />
            <span className="text-sm font-semibold text-foreground">التحكم بالـ QR</span>
          </div>
          <span className={cn(
            "text-[11px] px-2 py-0.5 rounded-full font-medium",
            qrDisabled
              ? "bg-red-500/20 text-red-400"
              : "bg-green-500/20 text-green-400"
          )}>
            {qrDisabled ? "🔒 موقوف" : "✅ مفعّل"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {qrDisabled
            ? "المشترك لا يستطيع ربط واتساب حتى تفعّل له الوصول"
            : "المشترك يستطيع ربط واتساب وسكان QR الآن"}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => toggleQrAccess(false)}
            disabled={savingQr || !qrDisabled}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
          >
            {savingQr && !qrDisabled ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            تفعيل الوصول
          </button>
          <button
            onClick={() => toggleQrAccess(true)}
            disabled={savingQr || qrDisabled}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
          >
            {savingQr && qrDisabled ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
            إيقاف الوصول
          </button>
        </div>
      </div>

      {/* Plan & Price */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">الخطة</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inputCls}>
            {PLANS.map((p) => <option key={p.value} value={p.value}>{p.icon} {p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">السعر الشهري (ر.س)</label>
          <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} dir="ltr" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
            <Clock className="w-3 h-3" /> انتهاء الاشتراك
          </label>
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} dir="ltr" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
            <MessageCircle className="w-3 h-3" /> حد الرسائل اليومي
          </label>
          <input
            type="number" min="1" max="10000"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="بلا حد"
            className={inputCls} dir="ltr"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">ملاحظات الدعم</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          rows={2} placeholder="ملاحظات داخلية..." className={cn(inputCls, "resize-none")} />
      </div>

      <button onClick={save} disabled={saving}
        className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
        حفظ الإعدادات
      </button>

      {/* Reset Password */}
      <div className="border-t border-card-border pt-3 space-y-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" /> إعادة تعيين كلمة المرور
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input type={showPw ? "text" : "password"} value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="كلمة مرور جديدة..."
              className={cn(inputCls, "pl-9")} />
            <button onClick={() => setShowPw(!showPw)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={resetPassword} disabled={savingPw || !newPw}
            className="px-3 py-2 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg hover:bg-orange-500/20 transition-colors text-sm disabled:opacity-40 flex-shrink-0">
            {savingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : "تغيير"}
          </button>
        </div>
      </div>

      {/* QR Link */}
      <div className="border-t border-card-border pt-3 space-y-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" /> رابط ربط الواتساب
        </p>
        {localToken ? (
          <div className="flex gap-2">
            <input readOnly value={getPublicQrUrl(localToken)}
              className={cn(inputCls, "text-xs flex-1 text-muted-foreground")} dir="ltr"
              onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button onClick={() => { navigator.clipboard.writeText(getPublicQrUrl(localToken)); toast.success("تم النسخ ✓"); }}
              className="px-3 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors flex-shrink-0">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={() => {
              const msg = encodeURIComponent(`مرحباً 👋\nلربط رقم محلك في منيو فور يو:\n${getPublicQrUrl(localToken)}`);
              window.open(`https://wa.me/${user.phone}?text=${msg}`, "_blank");
            }} className="px-3 py-2 bg-[#25D366]/10 text-[#25D366] rounded-lg hover:bg-[#25D366]/20 transition-colors flex-shrink-0">
              <MessageCircle className="w-4 h-4" />
            </button>
            <button onClick={regenToken} disabled={regen}
              className="px-3 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors flex-shrink-0 disabled:opacity-50">
              {regen ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <button onClick={regenToken} disabled={regen}
            className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50">
            {regen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            إنشاء رابط ربط
          </button>
        )}
      </div>

      {/* Direct Login Link */}
      <div className="border-t border-card-border pt-3 space-y-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" /> رابط الدخول المباشر
        </p>
        {localDirect ? (
          <div className="flex gap-2">
            <input readOnly value={getDirectLoginUrl(localDirect)}
              className={cn(inputCls, "text-xs flex-1 text-muted-foreground")} dir="ltr"
              onClick={(e) => (e.target as HTMLInputElement).select()} />
            <button onClick={() => { navigator.clipboard.writeText(getDirectLoginUrl(localDirect)); toast.success("تم النسخ ✓"); }}
              className="px-3 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors flex-shrink-0">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={regenDirectToken} disabled={regenD}
              className="px-3 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors flex-shrink-0 disabled:opacity-50">
              {regenD ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <button onClick={regenDirectToken} disabled={regenD}
            className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50">
            {regenD ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            إنشاء رابط دخول مباشر
          </button>
        )}
        <p className="text-xs text-muted-foreground/60">سري — دخول بدون كلمة مرور · للدعم الفني فقط</p>
      </div>
    </div>
  );
}

// ── Coupons Panel ──────────────────────────────────────────────────
function CouponsPanel() {
  const [coupons,    setCoupons]    = useState<Coupon[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    label: "", type: "days", planUpgrade: "pro",
    daysAdded: "30", maxUses: "1", expiresAt: "",
  });

  const load = async () => {
    setLoading(true);
    try { setCoupons(await apiFetch("/coupons")); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const coupon = await apiFetch("/coupons", {
        method: "POST",
        body: JSON.stringify({
          label: form.label || null,
          type: form.type,
          planUpgrade: (form.type === "plan" || form.type === "plan_days") ? form.planUpgrade : null,
          daysAdded: form.type !== "plan" ? parseInt(form.daysAdded) : null,
          maxUses: parseInt(form.maxUses),
          expiresAt: form.expiresAt || null,
        }),
      });
      setCoupons((p) => [coupon, ...p]);
      setShowForm(false);
      setForm({ label: "", type: "days", planUpgrade: "pro", daysAdded: "30", maxUses: "1", expiresAt: "" });
      toast.success(`✓ كوبون جديد: ${coupon.code}`);
    } catch (e: any) { toast.error(e.message); }
    finally { setCreating(false); }
  };

  const del = async (id: number) => {
    if (!confirm("حذف هذا الكوبون نهائياً؟")) return;
    setDeletingId(id);
    try {
      await apiFetch(`/coupons/${id}`, { method: "DELETE" });
      setCoupons((p) => p.filter((c) => c.id !== id));
      toast.success("تم الحذف");
    } catch (e: any) { toast.error(e.message); }
    finally { setDeletingId(null); }
  };

  const typeLabel = (c: Coupon) => {
    if (c.type === "plan")      return `ترقية → ${c.planUpgrade}`;
    if (c.type === "plan_days") return `${c.planUpgrade} + ${c.daysAdded}ي`;
    return `${c.daysAdded} يوم مجاني`;
  };

  const sendViaWa = (c: Coupon) => {
    const msg = encodeURIComponent(
      `مرحباً 👋\n🎁 كوبون خاص لك في منيو فور يو:\n\n*الكود: ${c.code}*\nالمزايا: ${typeLabel(c)}\n\nادخل الكود في لوحة التحكم ← الإعدادات ← استخدام كوبون`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Ticket className="w-5 h-5 text-primary" /> إدارة الكوبونات
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">أنشئ كوبونات وشاركها مع المشتركين</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> كوبون جديد
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-card border border-primary/30 rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary" /> إنشاء كوبون جديد
          </h3>
          <form onSubmit={create} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">وصف الكوبون (اختياري)</label>
              <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="مثال: كوبون ترحيب للعملاء الجدد" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">نوع الكوبون</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inputCls}>
                <option value="days">أيام مجانية فقط</option>
                <option value="plan">ترقية الخطة فقط</option>
                <option value="plan_days">ترقية + أيام مجانية</option>
              </select>
            </div>
            {(form.type === "plan" || form.type === "plan_days") && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">الخطة المستهدفة</label>
                <select value={form.planUpgrade} onChange={(e) => setForm({ ...form, planUpgrade: e.target.value })} className={inputCls}>
                  <option value="basic">🔵 أساسي</option>
                  <option value="pro">🟡 احترافي</option>
                  <option value="business">🟢 أعمال</option>
                </select>
              </div>
            )}
            {form.type !== "plan" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">عدد الأيام المجانية</label>
                <input type="number" min="1" max="365" value={form.daysAdded}
                  onChange={(e) => setForm({ ...form, daysAdded: e.target.value })} className={inputCls} dir="ltr" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">الحد الأقصى للاستخدام</label>
              <input type="number" min="1" value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className={inputCls} dir="ltr" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">انتهاء الكوبون (اختياري)</label>
              <input type="date" value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputCls} dir="ltr" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={creating}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                إنشاء الكوبون
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-5 py-2.5 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors">
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Coupons List */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري التحميل...
        </div>
      ) : coupons.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl py-16 text-center">
          <Ticket className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">لا توجد كوبونات بعد</p>
          <p className="text-muted-foreground/50 text-xs mt-1">أنشئ كوبوناً وشاركه مع مشتركيك</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="divide-y divide-card-border">
            {coupons.map((c) => {
              const expired = !!(c.expiresAt && new Date(c.expiresAt) < new Date());
              const full    = (c.usedCount ?? 0) >= (c.maxUses ?? 1);
              const dead    = expired || full;
              return (
                <div key={c.id} className={cn("flex items-center gap-3 px-4 py-3", dead && "opacity-60")}>
                  <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 flex-shrink-0 min-w-[80px] text-center">
                    <p className="text-primary font-bold text-sm tracking-widest font-mono" dir="ltr">{c.code}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{c.label || "بدون وصف"}</p>
                      <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{typeLabel(c)}</span>
                      {dead && (
                        <span className="text-xs bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">
                          {expired ? "منتهي" : "مكتمل"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Percent className="w-3 h-3" />{c.usedCount}/{c.maxUses} استخدام</span>
                      {c.expiresAt && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />ينتهي {formatDate(c.expiresAt)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => { navigator.clipboard.writeText(c.code); toast.success(`نُسخ: ${c.code}`); }}
                      title="نسخ الكود"
                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                      <Copy className="w-4 h-4" />
                    </button>
                    <button onClick={() => sendViaWa(c)} title="إرسال عبر واتساب"
                      className="p-1.5 rounded-lg text-[#25D366] hover:bg-[#25D366]/10 transition-colors">
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    <button onClick={() => del(c.id)} disabled={deletingId === c.id} title="حذف"
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                      {deletingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Plans Panel ────────────────────────────────────────────────────
interface SubscriptionPlan {
  id: number; name: string; name_en: string | null;
  price: string; period: string; period_label: string | null;
  description: string | null; description_en: string | null;
  features: string[]; features_en: string[] | null;
  badge: string | null; badge_en: string | null;
  is_active: boolean; is_featured: boolean; sort_order: number;
}

const EMPTY_PLAN: Omit<SubscriptionPlan, "id" | "is_active"> = {
  name: "", name_en: "", price: "", period: "", period_label: "",
  description: "", description_en: "",
  features: [], features_en: [],
  badge: "", badge_en: "",
  is_featured: false, sort_order: 0,
};

function PlansPanel() {
  const [plans,      setPlans]      = useState<SubscriptionPlan[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<SubscriptionPlan | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [form, setForm] = useState<typeof EMPTY_PLAN>({ ...EMPTY_PLAN });

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetch("/api/plans/admin", { credentials: "include" }).then((r) => r.json());
      setPlans(Array.isArray(data) ? data : []);
    } catch { toast.error("فشل تحميل الباقات"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_PLAN }); setShowForm(true); };
  const openEdit   = (p: SubscriptionPlan) => {
    setEditing(p);
    setForm({
      name: p.name, name_en: p.name_en || "", price: p.price, period: p.period,
      period_label: p.period_label || "", description: p.description || "",
      description_en: p.description_en || "",
      features: p.features, features_en: p.features_en || [],
      badge: p.badge || "", badge_en: p.badge_en || "",
      is_featured: p.is_featured, sort_order: p.sort_order,
    });
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.price || !form.period) { toast.error("الاسم والسعر والفترة مطلوبة"); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        features:    Array.isArray(form.features)    ? form.features    : String(form.features).split("\n").filter(Boolean),
        features_en: Array.isArray(form.features_en) ? form.features_en : String(form.features_en).split("\n").filter(Boolean),
      };
      if (editing) {
        const res = await fetch(`/api/plans/admin/${editing.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const updated = await res.json();
        setPlans((p) => p.map((x) => x.id === editing.id ? updated : x));
        toast.success("تم تحديث الباقة");
      } else {
        const res = await fetch("/api/plans/admin", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const created = await res.json();
        setPlans((p) => [...p, created]);
        toast.success("تم إنشاء الباقة");
      }
      setShowForm(false);
    } catch { toast.error("حدث خطأ في الحفظ"); }
    finally { setSaving(false); }
  };

  const toggle = async (p: SubscriptionPlan) => {
    try {
      const res = await fetch(`/api/plans/admin/${p.id}/toggle`, { method: "PATCH", credentials: "include" });
      const updated = await res.json();
      setPlans((prev) => prev.map((x) => x.id === p.id ? updated : x));
    } catch { toast.error("فشل التبديل"); }
  };

  const del = async (id: number) => {
    if (!confirm("حذف هذه الباقة نهائياً؟")) return;
    try {
      await fetch(`/api/plans/admin/${id}`, { method: "DELETE", credentials: "include" });
      setPlans((p) => p.filter((x) => x.id !== id));
      toast.success("تم الحذف");
    } catch { toast.error("فشل الحذف"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> إدارة الباقات</h2>
          <p className="text-xs text-muted-foreground mt-0.5">الباقات المعروضة في صفحة الأسعار</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> باقة جديدة
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-card border border-primary/30 rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-4">{editing ? "تعديل الباقة" : "إنشاء باقة جديدة"}</h3>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">الاسم بالعربية *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="الباقة الشهرية" className={inputCls} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">الاسم بالإنجليزية</label>
              <input value={form.name_en || ""} onChange={(e) => setForm({ ...form, name_en: e.target.value })} placeholder="Monthly Plan" className={inputCls} dir="ltr" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">السعر *</label>
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="299" className={inputCls} dir="ltr" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">تسمية الفترة (عرض)</label>
              <input value={form.period_label || ""} onChange={(e) => setForm({ ...form, period_label: e.target.value })} placeholder="درهم / شهر" className={inputCls} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">الشارة العربية</label>
              <input value={form.badge || ""} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="الأكثر توفيراً" className={inputCls} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">الشارة الإنجليزية</label>
              <input value={form.badge_en || ""} onChange={(e) => setForm({ ...form, badge_en: e.target.value })} placeholder="Best Value" className={inputCls} dir="ltr" /></div>
            <div className="col-span-2"><label className="text-xs text-muted-foreground mb-1 block">المميزات (عربي — سطر لكل ميزة)</label>
              <textarea rows={4} value={Array.isArray(form.features) ? form.features.join("\n") : form.features}
                onChange={(e) => setForm({ ...form, features: e.target.value.split("\n") })}
                className={inputCls} /></div>
            <div className="col-span-2"><label className="text-xs text-muted-foreground mb-1 block">المميزات (إنجليزي — سطر لكل ميزة)</label>
              <textarea rows={4} value={Array.isArray(form.features_en) ? (form.features_en || []).join("\n") : (form.features_en || "")}
                onChange={(e) => setForm({ ...form, features_en: e.target.value.split("\n") })}
                className={inputCls} dir="ltr" /></div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={!!form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} className="w-4 h-4 accent-primary" />
                <span className="text-sm">الأكثر مبيعاً (مميّز)</span>
              </label>
            </div>
            <div><label className="text-xs text-muted-foreground mb-1 block">ترتيب العرض</label>
              <input type="number" min="0" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className={inputCls} dir="ltr" /></div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {editing ? "حفظ التعديلات" : "إنشاء الباقة"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2.5 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80">إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري التحميل...</div>
      ) : plans.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl py-16 text-center">
          <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">لا توجد باقات بعد</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="divide-y divide-card-border">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.name}</span>
                    {p.is_featured && <span className="text-xs bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded">مميّز</span>}
                    <span className={cn("text-xs px-1.5 py-0.5 rounded", p.is_active ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground")}>
                      {p.is_active ? "نشط" : "مخفي"}
                    </span>
                    {p.badge && <span className="text-xs bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">{p.badge}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{Number(p.price).toLocaleString("ar-SA")} · {p.period_label || p.period} · {p.features?.length ?? 0} مميزات</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => toggle(p)} title={p.is_active ? "إخفاء" : "إظهار"}
                    className={cn("p-1.5 rounded-lg transition-colors", p.is_active ? "text-green-400 hover:bg-green-500/10" : "text-muted-foreground hover:bg-muted")}>
                    {p.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(p)} title="تعديل" className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => del(p.id)} title="حذف" className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Leads Panel ────────────────────────────────────────────────────
interface SubscriptionLead {
  id: number; name: string | null; phone: string; plan_name: string | null;
  business_type: string | null; estimated_customers: string | null;
  notes: string | null; source: string; status: string; created_at: string;
}

const LEAD_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  new:         { label: "جديد",       color: "text-blue-400",   bg: "bg-blue-500/10"  },
  contacted:   { label: "تم التواصل", color: "text-yellow-400", bg: "bg-yellow-500/10"},
  negotiating: { label: "مفاوضة",    color: "text-orange-400", bg: "bg-orange-500/10"},
  converted:   { label: "تحوّل",      color: "text-green-400",  bg: "bg-green-500/10" },
  lost:        { label: "خسارة",      color: "text-red-400",    bg: "bg-red-500/10"   },
};
const STATUS_NEXT: Record<string, string> = {
  new: "contacted", contacted: "negotiating", negotiating: "converted",
};

function LeadsPanel() {
  const [leads,      setLeads]      = useState<SubscriptionLead[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState("");
  const [updating,   setUpdating]   = useState<number | null>(null);

  const load = async (s = "") => {
    setLoading(true);
    try {
      const url = s ? `/api/leads?status=${s}` : "/api/leads";
      const data = await fetch(url, { credentials: "include" }).then((r) => r.json());
      setLeads(Array.isArray(data) ? data : []);
    } catch { toast.error("فشل تحميل الطلبات"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const setFilter2 = (s: string) => { setFilter(s); load(s); };

  const updateStatus = async (lead: SubscriptionLead, status: string) => {
    setUpdating(lead.id);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const updated = await res.json();
      setLeads((p) => p.map((x) => x.id === lead.id ? updated : x));
    } catch { toast.error("فشل التحديث"); }
    finally { setUpdating(null); }
  };

  const contactViaWa = (lead: SubscriptionLead) => {
    const msg = `مرحباً ${lead.name || ""}، شكراً لاهتمامك بـ ${lead.plan_name || "الاشتراك"}`;
    window.open(`https://wa.me/${lead.phone.replace(/\D/g,"")}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const del = async (id: number) => {
    if (!confirm("حذف هذا الطلب نهائياً؟")) return;
    try {
      await fetch(`/api/leads/${id}`, { method: "DELETE", credentials: "include" });
      setLeads((p) => p.filter((x) => x.id !== id));
    } catch { toast.error("فشل الحذف"); }
  };

  const filteredLeads = filter ? leads.filter((l) => l.status === filter) : leads;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> طلبات الاشتراك</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{leads.length} طلب</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(filter)} disabled={loading} className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilter2("")} className={cn("flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border", !filter ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-card-border")}>
          <Filter className="w-3 h-3" /> الكل
        </button>
        {Object.entries(LEAD_STATUS_LABELS).map(([key, { label, color, bg }]) => (
          <button key={key} onClick={() => setFilter2(key)} className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border", filter === key ? `${bg} ${color} border-current` : "bg-muted text-muted-foreground border-card-border")}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin ml-2" /> جاري التحميل...</div>
      ) : filteredLeads.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl py-16 text-center">
          <UserPlus className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">لا توجد طلبات اشتراك بعد</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="divide-y divide-card-border">
            {filteredLeads.map((lead) => {
              const sm = LEAD_STATUS_LABELS[lead.status] ?? LEAD_STATUS_LABELS.new;
              const busy = updating === lead.id;
              return (
                <div key={lead.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{lead.name || "بدون اسم"}</span>
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", sm.bg, sm.color)}>{sm.label}</span>
                      {lead.plan_name && <span className="text-xs bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">{lead.plan_name}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span dir="ltr">{lead.phone}</span>
                      {lead.business_type && <span>{lead.business_type}</span>}
                      {lead.estimated_customers && <span>~{lead.estimated_customers} عميل</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(lead.created_at).toLocaleDateString("ar-SA")}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {STATUS_NEXT[lead.status] && (
                      <button disabled={busy} onClick={() => updateStatus(lead, STATUS_NEXT[lead.status])}
                        title={`تحديث إلى: ${LEAD_STATUS_LABELS[STATUS_NEXT[lead.status]]?.label}`}
                        className="p-1.5 rounded-lg text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-40">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      </button>
                    )}
                    <button onClick={() => contactViaWa(lead)} title="تواصل عبر واتساب"
                      className="p-1.5 rounded-lg text-[#25D366] hover:bg-[#25D366]/10 transition-colors">
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    <button onClick={() => del(lead.id)} title="حذف"
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────
export default function AdminPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const [tab,        setTab]        = useState<"users" | "coupons" | "plans" | "leads">("users");
  const [users,      setUsers]      = useState<UserEntry[]>([]);
  const [stats,      setStats]      = useState<AdminStats | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [newUser,    setNewUser]    = useState({ phone: "", password: "", displayName: "", isAdmin: false, plan: "free", monthlyPrice: "0" });
  const [actionId,   setActionId]   = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) { navigate("/"); return; }
    load();
  }, [user]);

  const load = async () => {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([apiFetch("/users"), apiFetch("/stats")]);
      setUsers(u); setStats(s);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.phone || !newUser.password) { toast.error("الرقم وكلمة المرور مطلوبان"); return; }
    setCreating(true);
    try {
      await apiFetch("/users", { method: "POST", body: JSON.stringify(newUser) });
      toast.success("تم إنشاء المشترك");
      setShowCreate(false);
      setNewUser({ phone: "", password: "", displayName: "", isAdmin: false, plan: "free", monthlyPrice: "0" });
      load();
    } catch (err: any) { toast.error(err.message); }
    finally { setCreating(false); }
  };

  const toggleStatus = async (u: UserEntry) => {
    const newStatus = u.status === "active" ? "suspended" : "active";
    setActionId(u.id);
    try {
      await apiFetch(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      toast.success(newStatus === "active" ? "تم تفعيل الحساب" : "تم تعليق الحساب");
      setUsers((p) => p.map((x) => x.id === u.id ? { ...x, status: newStatus } : x));
    } catch (err: any) { toast.error(err.message); }
    finally { setActionId(null); }
  };

  const toggleQr = async (u: UserEntry) => {
    setActionId(u.id);
    try {
      const res = await apiFetch(`/users/${u.id}/toggle-qr`, { method: "POST" });
      setUsers((p) => p.map((x) => x.id === u.id ? { ...x, qrDisabled: res.qrDisabled } : x));
      toast.success(res.qrDisabled ? "تم تعطيل QR" : "تم تفعيل QR");
    } catch (err: any) { toast.error(err.message); }
    finally { setActionId(null); }
  };

  const restartWa = async (u: UserEntry) => {
    if (!confirm(`فصل وإعادة تشغيل واتساب لـ ${u.displayName || u.phone}؟`)) return;
    setActionId(u.id);
    try {
      await apiFetch(`/users/${u.id}/restart-wa`, { method: "POST" });
      toast.success("تم فصل واتساب · سيتولّد QR جديد عند الدخول");
    } catch (err: any) { toast.error(err.message); }
    finally { setActionId(null); }
  };

  const deleteUser = async (u: UserEntry) => {
    if (!confirm(`حذف ${u.displayName || u.phone}؟ سيتم حذف جميع بياناته نهائياً.`)) return;
    setActionId(u.id);
    try {
      await apiFetch(`/users/${u.id}`, { method: "DELETE" });
      toast.success("تم حذف المشترك");
      setUsers((p) => p.filter((x) => x.id !== u.id));
    } catch (err: any) { toast.error(err.message); }
    finally { setActionId(null); }
  };

  if (!user?.isAdmin) return null;

  return (
    <div className="p-6 max-w-5xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" /> لوحة الإدارة
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">إدارة المشتركين · الكوبونات · الإيرادات</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground transition-colors disabled:opacity-50">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          {tab === "users" && (
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" /> مشترك جديد
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {([
            { label: "المشتركون",    val: stats.totalUsers,                                    icon: Users,       color: "text-blue-400"   },
            { label: "النشطون",      val: stats.activeUsers,                                   icon: CheckCircle, color: "text-green-400"  },
            { label: "الإيراد/شهر",  val: `${stats.monthlyRevenue.toLocaleString("ar")} ر.س`, icon: DollarSign,  color: "text-yellow-400" },
            { label: "الحملات",      val: stats.totalCampaigns,                                icon: BarChart3,   color: "text-primary"    },
            { label: "الرسائل",      val: stats.totalMessagesSent.toLocaleString("ar"),        icon: Phone,       color: "text-purple-400" },
          ] as const).map(({ label, val, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-card-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className={cn("w-4 h-4", color)} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-xl font-bold">{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Plan counts */}
      {stats?.planCounts && Object.keys(stats.planCounts).length > 0 && (
        <div className="flex gap-3 mb-5 flex-wrap">
          {Object.entries(stats.planCounts).map(([plan, cnt]) => {
            const m = PLAN_META[plan] ?? PLAN_META.free;
            const I = m.icon;
            return (
              <div key={plan} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border border-card-border", m.bg)}>
                <I className={cn("w-3.5 h-3.5", m.color)} />
                <span className={cn("text-sm font-medium", m.color)}>{m.label}</span>
                <span className="text-xs text-muted-foreground">({cnt})</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 border border-card-border rounded-xl p-1 mb-5 flex-wrap">
        {([
          { key: "users",   label: "المشتركون",   icon: Users   },
          { key: "coupons", label: "الكوبونات",   icon: Ticket  },
          { key: "plans",   label: "الباقات",     icon: Package },
          { key: "leads",   label: "الطلبات",     icon: UserPlus},
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Coupons Tab */}
      {tab === "coupons" && <CouponsPanel />}

      {/* Plans Tab */}
      {tab === "plans" && <PlansPanel />}

      {/* Leads Tab */}
      {tab === "leads" && <LeadsPanel />}

      {/* Users Tab */}
      {tab === "users" && (
        <>
          {/* Create form */}
          {showCreate && (
            <div className="bg-card border border-primary/30 rounded-xl p-5 mb-5">
              <h3 className="text-sm font-semibold mb-4">إضافة مشترك جديد</h3>
              <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">رقم الهاتف *</label>
                  <input type="tel" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                    placeholder="971501234567" className={inputCls} dir="ltr" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">كلمة المرور *</label>
                  <input type="password" value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="6 أحرف على الأقل" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">الاسم</label>
                  <input type="text" value={newUser.displayName}
                    onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                    placeholder="اسم المشترك" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">الخطة</label>
                  <select value={newUser.plan} onChange={(e) => setNewUser({ ...newUser, plan: e.target.value })} className={inputCls}>
                    {PLANS.map((p) => <option key={p.value} value={p.value}>{p.icon} {p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">السعر الشهري (ر.س)</label>
                  <input type="number" min="0" value={newUser.monthlyPrice}
                    onChange={(e) => setNewUser({ ...newUser, monthlyPrice: e.target.value })}
                    className={inputCls} dir="ltr" />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none flex-1 pb-2">
                    <input type="checkbox" checked={newUser.isAdmin}
                      onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })}
                      className="w-4 h-4 accent-primary" />
                    <span className="text-sm">صلاحيات مدير</span>
                  </label>
                  <button type="submit" disabled={creating}
                    className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    إضافة
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Users list */}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin ml-2" /> جاري التحميل...
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
                <p className="text-sm font-medium">{users.length} مشترك</p>
                <p className="text-xs text-muted-foreground">
                  إيراد شهري: <span className="text-yellow-400 font-medium">{stats?.monthlyRevenue?.toLocaleString("ar") ?? 0} ر.س</span>
                </p>
              </div>
              <div className="divide-y divide-card-border">
                {users.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">لا يوجد مشتركون بعد</div>
                ) : users.map((u) => {
                  const pm      = PLAN_META[u.plan] ?? PLAN_META.free;
                  const PI      = pm.icon;
                  const expired = !!(u.planExpiresAt && new Date(u.planExpiresAt) < new Date());
                  const busy    = actionId === u.id;
                  const isSelf  = u.id === user.id;

                  return (
                    <div key={u.id}>
                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* Avatar */}
                        <div className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0",
                          u.isAdmin ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          {(u.displayName || u.phone).charAt(0)}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium truncate">{u.displayName || "—"}</p>
                            {u.isAdmin && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">مدير</span>}
                            <span className={cn("text-xs px-1.5 py-0.5 rounded",
                              u.status === "active" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                              {u.status === "active" ? "نشط" : "موقوف"}
                            </span>
                            <span className={cn("text-xs px-1.5 py-0.5 rounded flex items-center gap-0.5", pm.bg, pm.color)}>
                              <PI className="w-3 h-3" /> {pm.label}{expired && " ⚠️"}
                            </span>
                            {u.qrDisabled && (
                              <span className="text-xs bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <QrCode className="w-3 h-3" /> QR معطّل
                              </span>
                            )}
                            {u.monthlyPrice && u.monthlyPrice !== "0" && (
                              <span className="text-xs text-yellow-400">{u.monthlyPrice} ر.س</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-muted-foreground" dir="ltr">{u.phone}</span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {formatRelative(u.lastLoginAt)}
                            </span>
                          </div>
                        </div>

                        {/* Mini stats */}
                        <div className="text-xs text-muted-foreground text-center hidden sm:block flex-shrink-0">
                          <p>{u.campaignsCount} حملة</p>
                          <p>{u.contactGroupsCount} قائمة</p>
                        </div>

                        {/* Expand */}
                        <button onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors flex-shrink-0">
                          {expandedId === u.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {/* Actions */}
                        <div className="flex gap-1 flex-shrink-0">
                          {/* QR toggle */}
                          <button disabled={busy} onClick={() => toggleQr(u)}
                            title={u.qrDisabled ? "تفعيل QR" : "تعطيل QR"}
                            className={cn("p-1.5 rounded-lg transition-colors disabled:opacity-40",
                              u.qrDisabled ? "text-green-400 hover:bg-green-500/10" : "text-orange-400 hover:bg-orange-500/10")}>
                            <QrCode className="w-4 h-4" />
                          </button>

                          {/* WA restart */}
                          <button disabled={busy || isSelf} onClick={() => restartWa(u)}
                            title="فصل واتساب وتوليد QR جديد"
                            className="p-1.5 rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-40">
                            <WifiOff className="w-4 h-4" />
                          </button>

                          {/* Suspend/activate */}
                          <button disabled={busy || isSelf} onClick={() => toggleStatus(u)}
                            title={u.status === "active" ? "تعليق الحساب" : "تفعيل الحساب"}
                            className={cn("p-1.5 rounded-lg transition-colors disabled:opacity-40",
                              u.status === "active" ? "text-yellow-400 hover:bg-yellow-500/10" : "text-green-400 hover:bg-green-500/10")}>
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : u.status === "active" ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                          </button>

                          {/* Delete */}
                          <button disabled={busy || isSelf} onClick={() => deleteUser(u)}
                            title="حذف المشترك"
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded plan panel */}
                      {expandedId === u.id && (
                        <PlanPanel
                          user={u}
                          onSave={(ch) => setUsers((p) => p.map((x) => x.id === u.id ? { ...x, ...ch } : x))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
