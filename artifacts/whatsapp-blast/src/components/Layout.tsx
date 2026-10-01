import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetWhatsappStatus } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useKeepAlive } from "@/hooks/use-keep-alive";
import QrModal from "./QrModal";
import {
  LayoutDashboard, QrCode, Users, Megaphone, Bot,
  Wifi, WifiOff, Loader2, LogOut, Shield, User, TrendingUp, Download, BarChart3,
  MessageCircle, MessagesSquare, MessageSquare, BookOpen, RefreshCw, Sparkles, Settings2, Activity, Clock, Brain, Users2, Radar, LayoutGrid, Globe, Mail, Target,
  Store, ListOrdered, ShoppingBag, CalendarDays, UtensilsCrossed, Contact, ChevronDown, ExternalLink, Building2, Undo2 } from "lucide-react";
import { useShopQuery, useSwitchBranch, post } from "@/lib/shop-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Grouped: the shop first — what an owner opens every day — then WhatsApp,
// marketing and the AI team that came from Flow Hub.
type NavItem = { href: string; label: string; icon: any; badge?: string; owner?: boolean; feature?: "queue" | "booking" | "marketing" };
const NAV: Array<{ title: string; items: NavItem[] }> = [
  { title: "المحل", items: [
    { href: "/shop",          label: "الرئيسية",           icon: Store },
    { href: "/queue",         label: "الصف",               icon: ListOrdered, feature: "queue" },
    { href: "/orders",        label: "الطلبات",            icon: ShoppingBag },
    { href: "/bookings",      label: "الحجوزات",           icon: CalendarDays, feature: "booking" },
    { href: "/menu",          label: "المنيو",             icon: UtensilsCrossed },
    { href: "/customers",     label: "الزبائن",            icon: Contact },
    { href: "/reports",       label: "التقارير",           icon: BarChart3 },
  ] },
  { title: "الإعداد", items: [
    { href: "/shop/settings", label: "المحل والفروع",      icon: Settings2 },
    { href: "/staff",         label: "الموظفون",           icon: Users2 },
    { href: "/messages",      label: "رسائل واتساب",       icon: MessageCircle },
    { href: "/qr",            label: "QR والمطبوعات",      icon: QrCode },
  ] },
  { title: "واتساب", items: [
    { href: "/connect",       label: "ربط الواتساب",      icon: QrCode },
    { href: "/conversations", label: "المحادثات",          icon: MessageSquare },
    { href: "/inbox",         label: "صندوق الوارد",       icon: MessagesSquare },
    { href: "/knowledge",     label: "معرفة البوت",        icon: Brain },
    { href: "/wa-link",       label: "رابط واتساب",        icon: Globe },
  ] },
  { title: "التسويق", items: [
    { href: "/campaigns",     label: "الحملات",            icon: Megaphone, feature: "marketing" },
    { href: "/follow-ups",    label: "المتابعات",          icon: Clock },
    { href: "/contacts",      label: "قوائم الأرقام",     icon: Users },
    { href: "/extractor",     label: "مستخرج الأرقام",    icon: Download },
    { href: "/email",         label: "التسويق بالبريد",    icon: Mail, owner: true },
  ] },
  { title: "الفريق الذكي", items: [
    { href: "/employees",     label: "فريق البوتات",       icon: Bot },
    { href: "/board",         label: "لوحة الفريق",        icon: LayoutGrid },
    { href: "/meetings",      label: "اجتماعات الفريق",    icon: Users2 },
    { href: "/ops",           label: "غرفة العمليات",      icon: Radar },
    { href: "/arena",         label: "ميدان التدريب",      icon: Target },
    { href: "/assistant",     label: "المساعد الداخلي",    icon: Sparkles },
    { href: "/browser",       label: "مكتب التصفّح",       icon: Globe },
    { href: "/dashboard",     label: "إحصائيات واتساب",   icon: LayoutDashboard },
    { href: "/settings",      label: "إعدادات النظام",     icon: Settings2 },
    { href: "/diagnostics",   label: "التشخيص",           icon: Activity },
  ] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [fixing, setFixing] = useState(false);
  // On a phone the sidebar is a drawer; it closes whenever the page changes.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [location]);
  const { data: shop } = useShopQuery();
  const switchBranch = useSwitchBranch();
  const plan = shop && !shop.needsOnboarding ? shop.plan : null;

  // Keep the browser tab alive: Wake Lock + session ping + 20-min reload
  useKeepAlive(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: status, refetch: refetchStatus } = useGetWhatsappStatus({ query: { refetchInterval: 5000 } as any });

  const connected   = status?.connected;
  const waStatus    = status?.status as string | undefined;
  const isActive    = connected || waStatus === "connecting" || waStatus === "reconnecting" || waStatus === "qr_ready";
  const disconnected = !isActive;

  const handleLogout = async () => {
    try { await logout(); } catch { toast.error("فشل تسجيل الخروج"); }
  };

  const handleFix = async () => {
    setFixing(true);
    try {
      const res = await fetch("/api/whatsapp/connect", { method: "POST", credentials: "include" });
      if (res.ok) {
        toast.success("جاري إعادة الاتصال بواتساب...");
        setTimeout(() => refetchStatus(), 2000);
      } else {
        toast.error("فشل إعادة الاتصال، حاول مجدداً");
      }
    } catch {
      toast.error("تعذّر الوصول للخادم");
    } finally {
      setTimeout(() => setFixing(false), 4000);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden" dir="rtl">
      {/* Global QR / reconnect modal — appears on any page when WA needs attention */}
      <QrModal />

      {navOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />}
      <aside className={cn(
        "w-64 flex-shrink-0 bg-sidebar border-l border-sidebar-border flex flex-col",
        "fixed inset-y-0 right-0 z-50 transition-transform duration-300 md:static md:translate-x-0",
        navOpen ? "translate-x-0" : "translate-x-full",
      )}>
        {/* Logo */}
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center flex-shrink-0 hidden">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <MfyMark />
            <div className="min-w-0">
              <p className="font-bold text-sm text-sidebar-foreground leading-none">منيو فور يو</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{shop && !shop.needsOnboarding ? shop.org.name : "المنيو والصف الرقمي"}</p>
            </div>
          </div>
        </div>

        {shop && !shop.needsOnboarding && (
          <div className="px-4 pt-3 space-y-2">
            {shop.impersonating && (
              <button onClick={async () => { await post("/api/tenancy/stop-impersonating"); window.location.href = "/admin/orgs"; }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <Undo2 className="w-3.5 h-3.5" /> أنت تعاين محل {shop.org.name} — رجوع
              </button>
            )}
            {shop.branches.length > 1 ? (
              <label className="block">
                <span className="sr-only">الفرع</span>
                <div className="relative">
                  <Building2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <select value={shop.branch.id} onChange={(e) => void switchBranch(Number(e.target.value))}
                    className="w-full appearance-none pr-8 pl-7 py-2 rounded-lg bg-sidebar-accent text-xs font-medium text-sidebar-foreground border border-sidebar-border focus:outline-none focus:ring-2 focus:ring-ring">
                    {shop.branches.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </label>
            ) : null}
            <a href={shop.links.menu} target="_blank" rel="noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs bg-primary/10 text-primary hover:bg-primary/15 transition-colors">
              <span className="truncate" dir="ltr">{shop.links.menu.replace(/^https?:\/\//, "")}</span>
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
            </a>
          </div>
        )}

        {/* WhatsApp Status */}
        <div className="px-4 py-3 border-b border-sidebar-border space-y-2">
          {/* Status pill */}
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium",
            connected                              ? "bg-green-500/10 text-green-400" :
            waStatus === "reconnecting"            ? "bg-orange-500/10 text-orange-400" :
            waStatus === "connecting" || waStatus === "qr_ready" ? "bg-yellow-500/10 text-yellow-400" :
            "bg-red-500/10 text-red-400"
          )}>
            {waStatus === "connecting" || waStatus === "reconnecting"
              ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              : connected
                ? <Wifi className="w-3 h-3 flex-shrink-0" />
                : <WifiOff className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate">
              {connected
                ? `متصل ${status?.phone ? `(${status.phone})` : ""}`
                : waStatus === "reconnecting"
                  ? "يُعيد الاتصال..."
                  : waStatus === "qr_ready"
                    ? "في انتظار QR"
                    : waStatus === "connecting"
                      ? "جاري الاتصال..."
                      : "غير متصل"}
            </span>
          </div>

          {/* One-click fix button — shown only when fully disconnected */}
          {disconnected && (
            <button
              onClick={handleFix}
              disabled={fixing}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all",
                fixing
                  ? "bg-primary/20 text-primary cursor-not-allowed"
                  : "bg-primary text-white hover:bg-primary/90 active:scale-95 shadow-sm"
              )}
            >
              {fixing
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />جاري الإصلاح...</>
                : <><RefreshCw className="w-3.5 h-3.5" />إصلاح الاتصال</>}
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map((group) => {
            const items = group.items.filter((it) => (!it.owner || user?.isAdmin) && (!it.feature || !plan || plan.features[it.feature] || it.feature === "marketing"));
            if (!items.length) return null;
            return (
              <div key={group.title} className="pb-2">
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground/70">{group.title}</p>
                {items.map(({ href, label, icon: Icon, badge, feature }) => {
                  const active = href === "/shop" ? location === "/shop" : location.startsWith(href);
                  const locked = feature && plan && !plan.features[feature];
                  return (
                    <Link key={href} href={href} className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                      active
                        ? "bg-primary/15 text-primary border border-primary/20"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}>
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1">{label}</span>
                      {locked && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground leading-none">ترقية</span>}
                      {badge && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary leading-none">
                          {badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
          {user?.isAdmin && (
            <Link href="/admin/orgs" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              location.startsWith("/admin/orgs")
                ? "bg-primary/15 text-primary border border-primary/20"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}>
              <Store className="w-4 h-4 flex-shrink-0" />
              المحلات (الإدارة)
            </Link>
          )}
          {user?.isAdmin && (
            <Link href="/admin" className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              location === "/admin"
                ? "bg-primary/15 text-primary border border-primary/20"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}>
              <Shield className="w-4 h-4 flex-shrink-0" />
              إدارة المشتركين
            </Link>
          )}
        </nav>

        {/* User + Logout */}
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/50">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <User className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{user?.displayName || "مشترك"}</p>
              <p className="text-[10px] text-muted-foreground truncate" dir="ltr">{user?.phone}</p>
            </div>
            {user?.isAdmin && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded flex-shrink-0">مدير</span>
            )}
          </div>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <LogOut className="w-3.5 h-3.5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-background min-w-0">
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-background/90 backdrop-blur border-b border-border">
          <button onClick={() => setNavOpen(true)} aria-label="القائمة" className="w-10 h-10 -mr-2 rounded-lg flex items-center justify-center hover:bg-muted">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <MfyMark className="w-8 h-8" />
          <span className="font-bold text-sm truncate">{shop && !shop.needsOnboarding ? shop.org.name : "منيو فور يو"}</span>
        </div>
        {children}
      </main>
    </div>
  );
}

/** The Menu For You mark: a plate seen from above, with a queue ticket's notch. */
export function MfyMark({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <div className={cn("rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-sm", className)}>
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ color: "hsl(var(--primary-foreground))" }}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4.2" opacity=".6" />
        <path d="M3.5 4.5v5M5.25 4.5v5M3.5 7h1.75M4.4 9.5v10" />
        <path d="M20.5 4.5c-1.3 1-1.9 2.6-1.9 4.4v2.1h1.9v8.5" />
      </svg>
    </div>
  );
}
