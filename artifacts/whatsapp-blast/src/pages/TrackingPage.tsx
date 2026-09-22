import { useState, useEffect } from "react";
import {
  BarChart3, Link2, Settings2, Plus, Copy, Trash2, ExternalLink,
  CheckCircle, XCircle, Loader2, MousePointerClick, Activity,
  TrendingUp, AlertCircle, Info,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "pixels" | "links" | "events";
type Platform = "meta" | "snapchat" | "tiktok";

interface Pixel {
  id: number; platform: Platform; pixelId: string;
  accessToken: string; testCode?: string; enabled: boolean;
}

interface TrackingLink {
  id: number; code: string; title: string; originalUrl: string;
  campaignId?: number; campaignName?: string; clicks: number; createdAt: string;
}

interface TrackingEvent {
  id: number; phone?: string; ip?: string;
  metaFired: boolean; snapFired: boolean; tiktokFired: boolean;
  clickedAt: string; linkTitle: string; linkCode: string; originalUrl: string;
}

interface DashboardData {
  clicksByDay: { date: string; count: number }[];
  platformStats: Record<Platform, { fired: number; total: number }>;
  topLinks: { id: number; code: string; title: string; originalUrl: string; clicks: number }[];
}

const PLATFORMS: {
  id: Platform; name: string; color: string; bg: string; border: string;
  icon: string; helpText: string;
}[] = [
  {
    id: "meta",
    name: "Meta (Facebook/Instagram)",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    icon: "M",
    helpText: "أدخل Pixel ID من Events Manager + System User Access Token. استخدم Test Event Code أثناء الاختبار.",
  },
  {
    id: "snapchat",
    name: "Snapchat",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    icon: "S",
    helpText: "Snap CAPI لا يتصل بالواتساب مباشرة. الطريقة الصحيحة: أنشئ رابط متتبع → ضعه في حملة الواتساب → عند الضغط يُرسل السيرفر حدث PAGE_VIEW لـ Snap CAPI تلقائياً. هكذا تحصل على بيانات التحويل في Snap Ads Manager.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
    icon: "T",
    helpText: "TikTok Events API (server-side). أدخل Pixel Code من TikTok Ads Manager + Access Token. الحدث المُرسَل: ClickButton عند كل ضغطة على رابط متتبع.",
  },
];

function pct(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

export default function TrackingPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [pixels, setPixels]       = useState<Pixel[]>([]);
  const [links, setLinks]         = useState<TrackingLink[]>([]);
  const [events, setEvents]       = useState<TrackingEvent[]>([]);
  const [stats, setStats]         = useState({ totalClicks: 0, totalLinks: 0 });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading]     = useState(false);

  const [forms, setForms] = useState<Record<Platform, { pixelId: string; accessToken: string; testCode: string }>>({
    meta:     { pixelId: "", accessToken: "", testCode: "" },
    snapchat: { pixelId: "", accessToken: "", testCode: "" },
    tiktok:   { pixelId: "", accessToken: "", testCode: "" },
  });
  const [saving, setSaving]       = useState<Platform | null>(null);
  const [newLink, setNewLink]     = useState({ title: "", originalUrl: "" });
  const [creatingLink, setCreatingLink] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [px, lk, ev, st, db] = await Promise.all([
        fetch("/api/tracking/pixels",    { credentials: "include" }).then(r => r.json()),
        fetch("/api/tracking/links",     { credentials: "include" }).then(r => r.json()),
        fetch("/api/tracking/events",    { credentials: "include" }).then(r => r.json()),
        fetch("/api/tracking/stats",     { credentials: "include" }).then(r => r.json()),
        fetch("/api/tracking/dashboard", { credentials: "include" }).then(r => r.json()),
      ]);
      setPixels(Array.isArray(px) ? px : []);
      setLinks(Array.isArray(lk) ? lk : []);
      setEvents(Array.isArray(ev) ? ev : []);
      if (st && !st.error) setStats(st);
      if (db && !db.error) setDashboard(db);

      if (Array.isArray(px)) {
        const updated = { ...forms };
        for (const p of px as Pixel[]) {
          if (p.platform in updated)
            updated[p.platform] = { pixelId: p.pixelId, accessToken: p.accessToken, testCode: p.testCode || "" };
        }
        setForms(updated);
      }
    } finally { setLoading(false); }
  }

  async function savePixel(platform: Platform) {
    const f = forms[platform];
    if (!f.pixelId.trim() || !f.accessToken.trim()) { toast.error("Pixel ID والـ Access Token مطلوبان"); return; }
    setSaving(platform);
    try {
      const r = await fetch("/api/tracking/pixels", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, pixelId: f.pixelId.trim(), accessToken: f.accessToken.trim(), testCode: f.testCode.trim() || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      toast.success("تم حفظ الإعدادات");
      await loadAll();
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); }
    finally { setSaving(null); }
  }

  async function deletePixel(id: number) {
    await fetch(`/api/tracking/pixels/${id}`, { method: "DELETE", credentials: "include" });
    toast.success("تم الحذف");
    loadAll();
  }

  async function createLink() {
    if (!newLink.title.trim() || !newLink.originalUrl.trim()) { toast.error("العنوان والرابط مطلوبان"); return; }
    setCreatingLink(true);
    try {
      const r = await fetch("/api/tracking/links", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLink),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setNewLink({ title: "", originalUrl: "" });
      toast.success("تم إنشاء الرابط");
      loadAll();
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); }
    finally { setCreatingLink(false); }
  }

  async function deleteLink(id: number) {
    await fetch(`/api/tracking/links/${id}`, { method: "DELETE", credentials: "include" });
    toast.success("تم حذف الرابط");
    loadAll();
  }

  function copyLink(code: string, withPhone = false) {
    const url = `${window.location.origin}/t/${code}${withPhone ? "?p={الرقم}" : ""}`;
    navigator.clipboard.writeText(url);
    toast.success("تم نسخ الرابط");
  }

  // ── Micro bar chart ─────────────────────────────────────────
  const maxClicks = Math.max(...(dashboard?.clicksByDay.map(d => Number(d.count)) ?? [1]), 1);

  const TABS = [
    { id: "dashboard" as Tab, label: "داش بورد",        icon: BarChart3  },
    { id: "pixels"    as Tab, label: "إعدادات البيكسل", icon: Settings2  },
    { id: "links"     as Tab, label: "الروابط",          icon: Link2      },
    { id: "events"    as Tab, label: "الأحداث",          icon: Activity   },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary" />
            تتبع الحملات والتحولات
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            ربط بيكسل Meta وSnapchat وTikTok — تتبع الضغطات والتحولات سيرفر-سايد
          </p>
        </div>
        <div className="flex gap-3">
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-center min-w-[90px]">
            <p className="text-2xl font-bold text-primary">{stats.totalClicks}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">إجمالي الضغطات</p>
          </div>
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-center min-w-[90px]">
            <p className="text-2xl font-bold text-foreground">{stats.totalLinks}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">روابط نشطة</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 rounded-xl p-1 mb-6 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              tab === id
                ? "bg-background text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            )}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin ml-2" /><span>جاري التحميل...</span>
        </div>
      )}

      {/* ── DASHBOARD TAB ─────────────────────────────────────── */}
      {!loading && tab === "dashboard" && (
        <div className="space-y-5">
          {/* Platform stats */}
          <div className="grid grid-cols-3 gap-4">
            {PLATFORMS.map(plat => {
              const ps = dashboard?.platformStats[plat.id];
              const fired = ps?.fired ?? 0;
              const total = ps?.total ?? 0;
              const saved = pixels.find(p => p.platform === plat.id);
              return (
                <div key={plat.id} className={cn("border rounded-xl p-4", plat.bg, plat.border)}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center font-bold text-base border", plat.bg, plat.border, plat.color)}>
                      {plat.icon}
                    </span>
                    {saved
                      ? <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20">مفعّل</span>
                      : <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">غير مُعدّ</span>}
                  </div>
                  <p className={cn("text-2xl font-bold", plat.color)}>{fired.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">حدث أُرسل</p>
                  <div className="mt-2 bg-black/20 rounded-full h-1.5 overflow-hidden">
                    <div className={cn("h-full rounded-full", plat.bg.replace("/10", ""))} style={{ width: pct(fired, total) === "—" ? "0%" : pct(fired, total) }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">معدل النجاح: {pct(fired, total)}</p>
                </div>
              );
            })}
          </div>

          {/* Clicks chart */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground text-sm mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              الضغطات خلال آخر 30 يوم
            </h3>
            {(!dashboard?.clicksByDay || dashboard.clicksByDay.length === 0) ? (
              <div className="flex flex-col items-center py-10 text-muted-foreground">
                <BarChart3 className="w-10 h-10 opacity-20 mb-2" />
                <p className="text-sm">لا توجد بيانات بعد — أنشئ رابطاً متتبعاً وشاركه في حملاتك</p>
              </div>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {dashboard.clicksByDay.map((d, i) => {
                  const h = Math.max(4, Math.round((Number(d.count) / maxClicks) * 100));
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-popover border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                        {d.count} ضغطة
                      </div>
                      <div
                        className="w-full bg-primary/70 hover:bg-primary rounded-sm transition-colors cursor-default"
                        style={{ height: `${h}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top links */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground text-sm mb-4 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              أكثر الروابط ضغطاً
            </h3>
            {(!dashboard?.topLinks || dashboard.topLinks.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-6">لا توجد روابط بعد</p>
            ) : (
              <div className="space-y-2">
                {dashboard.topLinks.map((link, i) => (
                  <div key={link.id} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{link.title}</p>
                      <p className="text-xs text-muted-foreground font-mono" dir="ltr">/t/{link.code}</p>
                    </div>
                    <span className="flex items-center gap-1 text-sm font-bold text-primary flex-shrink-0">
                      <MousePointerClick className="w-3.5 h-3.5" />{link.clicks}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PIXELS TAB ───────────────────────────────────────── */}
      {!loading && tab === "pixels" && (
        <div className="space-y-4">
          {/* Snapchat explanation */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-400">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <strong>كيف يعمل الربط مع واتساب؟</strong>
                <p className="mt-1 text-xs leading-relaxed">
                  Snapchat وTikTok وMeta <strong>لا تتصل بواتساب مباشرة</strong>. الحل: أنشئ رابطاً متتبعاً من تبويب "الروابط" ←
                  ضعه في رسالة حملتك مع <code className="bg-amber-500/20 px-1 rounded">?p={"{الرقم}"}</code> ←
                  عند الضغط يُرسل السيرفر تلقائياً حدث تحويل لجميع البيكسلات المفعّلة.
                  هكذا تحصل على بيانات التحويل في Ads Manager لكل منصة.
                </p>
              </div>
            </div>
          </div>

          {PLATFORMS.map(plat => {
            const saved = pixels.find(p => p.platform === plat.id);
            const f = forms[plat.id];
            return (
              <div key={plat.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg border", plat.bg, plat.border, plat.color)}>
                      {plat.icon}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{plat.name}</p>
                      {saved
                        ? <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> مفعّل</p>
                        : <p className="text-xs text-muted-foreground">غير مُعدّ بعد</p>}
                    </div>
                  </div>
                  {saved && (
                    <button onClick={() => deletePixel(saved.id)}
                      className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" /> حذف
                    </button>
                  )}
                </div>

                {/* Help text */}
                <div className={cn("text-xs rounded-lg p-3 mb-3 flex items-start gap-2", plat.bg, plat.border, "border")}>
                  <AlertCircle className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", plat.color)} />
                  <p className={plat.color}>{plat.helpText}</p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      {plat.id === "meta" ? "Pixel ID" : plat.id === "tiktok" ? "Pixel Code" : "Pixel ID"} *
                    </label>
                    <input
                      value={f.pixelId}
                      onChange={e => setForms(p => ({ ...p, [plat.id]: { ...p[plat.id], pixelId: e.target.value } }))}
                      placeholder={plat.id === "meta" ? "123456789012345" : plat.id === "tiktok" ? "CXXXXXXXXXXXXXX" : "a1b2c3d4..."}
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Access Token *</label>
                    <input type="password" value={f.accessToken}
                      onChange={e => setForms(p => ({ ...p, [plat.id]: { ...p[plat.id], accessToken: e.target.value } }))}
                      placeholder="أدخل Access Token"
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  {plat.id === "meta" && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Test Event Code (اختياري)</label>
                      <input value={f.testCode}
                        onChange={e => setForms(p => ({ ...p, [plat.id]: { ...p[plat.id], testCode: e.target.value } }))}
                        placeholder="TEST12345"
                        className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  )}
                </div>

                <button onClick={() => savePixel(plat.id)} disabled={saving === plat.id}
                  className="mt-4 w-full py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2">
                  {saving === plat.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {saved ? "تحديث الإعدادات" : "حفظ وتفعيل"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LINKS TAB ────────────────────────────────────────── */}
      {!loading && tab === "links" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />إنشاء رابط متتبع جديد
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">عنوان الرابط *</label>
                <input value={newLink.title} onChange={e => setNewLink(p => ({ ...p, title: e.target.value }))}
                  placeholder="مثال: عرض العيد — صفحة الهبوط"
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">الرابط الأصلي *</label>
                <input value={newLink.originalUrl} onChange={e => setNewLink(p => ({ ...p, originalUrl: e.target.value }))}
                  placeholder="https://yoursite.com/offer" dir="ltr"
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
              </div>
            </div>
            <button onClick={createLink} disabled={creatingLink}
              className="mt-3 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-2">
              {creatingLink ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              إنشاء الرابط
            </button>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-400">
            ضع الرابط في رسالة الحملة هكذا:
            <code className="block mt-1 bg-blue-500/20 px-3 py-2 rounded text-xs dir-ltr" dir="ltr">
              https://yoursite.com/t/abc123?p={"{الرقم}"}
            </code>
            <span className="text-xs mt-1 block">سيُستبدل {"{الرقم}"} تلقائياً برقم كل مستلم عند الإرسال</span>
          </div>

          {links.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground bg-card border border-border rounded-xl">
              <Link2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>لا توجد روابط — أنشئ رابطك الأول أعلاه</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-right text-xs text-muted-foreground px-4 py-3 font-medium">العنوان</th>
                    <th className="text-right text-xs text-muted-foreground px-4 py-3 font-medium">الرابط الأصلي</th>
                    <th className="text-center text-xs text-muted-foreground px-4 py-3 font-medium">الضغطات</th>
                    <th className="text-center text-xs text-muted-foreground px-4 py-3 font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map(link => (
                    <tr key={link.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{link.title}</p>
                        <p className="text-xs text-primary/70 font-mono mt-0.5" dir="ltr">/t/{link.code}</p>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <a href={link.originalUrl} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-400 hover:underline flex items-center gap-1 truncate" dir="ltr">
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{link.originalUrl}</span>
                        </a>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-primary">
                          <MousePointerClick className="w-3.5 h-3.5" />{link.clicks}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => copyLink(link.code, false)} title="نسخ الرابط"
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => copyLink(link.code, true)} title="نسخ رابط مع رقم للحملات"
                            className="p-1.5 text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors text-[10px] font-medium px-2">
                            +رقم
                          </button>
                          <button onClick={() => deleteLink(link.id)}
                            className="p-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EVENTS TAB ───────────────────────────────────────── */}
      {!loading && tab === "events" && (
        <div>
          {events.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
              <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>لا توجد أحداث — أرسل حملة بروابط متتبعة لتظهر هنا</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">آخر {events.length} حدث</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-right text-xs text-muted-foreground px-4 py-2.5 font-medium">الرابط</th>
                      <th className="text-right text-xs text-muted-foreground px-4 py-2.5 font-medium">الرقم</th>
                      <th className="text-center text-xs text-muted-foreground px-4 py-2.5 font-medium">Meta</th>
                      <th className="text-center text-xs text-muted-foreground px-4 py-2.5 font-medium">Snap</th>
                      <th className="text-center text-xs text-muted-foreground px-4 py-2.5 font-medium">TikTok</th>
                      <th className="text-right text-xs text-muted-foreground px-4 py-2.5 font-medium">الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(ev => (
                      <tr key={ev.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-sm text-foreground">{ev.linkTitle}</p>
                          <p className="text-xs text-muted-foreground font-mono" dir="ltr">/t/{ev.linkCode}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-foreground font-mono" dir="ltr">
                            {ev.phone || <span className="text-muted-foreground/50">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {ev.metaFired ? <CheckCircle className="w-4 h-4 text-green-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground/30 mx-auto" />}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {ev.snapFired ? <CheckCircle className="w-4 h-4 text-green-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground/30 mx-auto" />}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {ev.tiktokFired ? <CheckCircle className="w-4 h-4 text-green-400 mx-auto" /> : <XCircle className="w-4 h-4 text-muted-foreground/30 mx-auto" />}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(ev.clickedAt).toLocaleString("ar-SA")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
