// ── The staff and manager shell ───────────────────────────────────
// A counter tablet, not a dashboard: one slim bar with the shop, the branch
// and the three things staff do all evening, then the screen itself at full
// height. Managers get the menu, customers and reports as extra tabs.

import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { CalendarDays, ClipboardList, LogOut, Users, BarChart3, BookOpen, ListOrdered, ChevronDown, Store } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useShop, useSwitchBranch } from "@/lib/shop-api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function StaffLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const shop = useShop();
  const switchBranch = useSwitchBranch();
  const [path] = useLocation();
  const manager = (user?.role ?? shop.role) === "manager";

  const tabs = [
    { href: "/queue", label: "الصف", icon: ListOrdered },
    { href: "/orders", label: "الطلبات", icon: ClipboardList },
    { href: "/bookings", label: "الحجوزات", icon: CalendarDays },
    ...(manager ? [
      { href: "/menu", label: "المنيو", icon: BookOpen },
      { href: "/customers", label: "الزبائن", icon: Users },
      { href: "/reports", label: "التقارير", icon: BarChart3 },
    ] : []),
  ];

  const signOut = async () => {
    await logout();
    // Back to the staff door with the shop already filled in.
    window.location.href = `/staff-login?shop=${encodeURIComponent(shop.org.slug)}`;
  };

  const pick = async (id: number) => {
    if (id === shop.branch.id) return;
    try { await switchBranch(id); toast.success("تم تغيير الفرع"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "تعذّر تغيير الفرع"); }
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden" dir="rtl">
      <header className="shrink-0 border-b border-border bg-sidebar">
        <div className="flex items-center gap-2 px-3 h-14">
          <div className="flex items-center gap-2 min-w-0">
            {shop.org.logoUrl
              ? <img src={shop.org.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
              : <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary grid place-items-center shrink-0"><Store className="w-4 h-4" /></div>}
            <div className="min-w-0 leading-tight">
              <div className="font-bold text-sm truncate max-w-[8rem] sm:max-w-[14rem]">{shop.org.name}</div>
              {shop.branches.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground outline-none">
                    {shop.branch.name}<ChevronDown className="w-3 h-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {shop.branches.map((b) => (
                      <DropdownMenuItem key={b.id} onClick={() => pick(b.id)} className={cn(b.id === shop.branch.id && "text-primary font-semibold")}>
                        {b.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="text-[11px] text-muted-foreground truncate">{shop.branch.name}</div>
              )}
            </div>
          </div>

          <nav className="flex-1 flex items-center justify-center gap-1 overflow-x-auto mx-1 [scrollbar-width:none]">
            {tabs.map((t) => {
              const active = path === t.href || path.startsWith(`${t.href}/`);
              return (
                <Link key={t.href} href={t.href} title={t.label}
                  className={cn("flex items-center gap-1.5 px-3 h-10 rounded-lg text-sm whitespace-nowrap transition",
                    active ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60")}>
                  <t.icon className="w-4 h-4 shrink-0" />
                  {/* Six tabs do not fit a phone; the icons do. */}
                  <span className={cn(tabs.length > 3 ? "hidden md:inline" : "hidden min-[420px]:inline")}>{t.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1 shrink-0">
            <div className="hidden sm:block leading-tight me-1 text-left">
              <div className="text-xs font-medium truncate max-w-[8rem]">{shop.person?.name ?? user?.displayName ?? "موظف"}</div>
              <div className="text-[10px] text-muted-foreground">{manager ? "مدير الفرع" : "موظف"}</div>
            </div>
            <button onClick={signOut} title="تسجيل الخروج" aria-label="تسجيل الخروج"
              className="w-10 h-10 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}
