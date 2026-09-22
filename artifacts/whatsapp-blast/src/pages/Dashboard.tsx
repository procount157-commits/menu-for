import { Link } from "wouter";
import { useGetDashboardStats, useGetWhatsappStatus } from "@workspace/api-client-react";
import { Megaphone, Users, Send, XCircle, Activity, AlertCircle, Plus, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  draft: { label: "مسودة", class: "bg-gray-500/15 text-gray-400 border-gray-500/20" },
  scheduled: { label: "مجدولة", class: "bg-purple-500/15 text-purple-400 border-purple-500/20" },
  running: { label: "تعمل", class: "bg-green-500/15 text-green-400 border-green-500/20" },
  paused: { label: "متوقفة", class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
  completed: { label: "مكتملة", class: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  failed: { label: "فشلت", class: "bg-red-500/15 text-red-400 border-red-500/20" },
};

export default function Dashboard() {
  const { data: stats, isLoading } = useGetDashboardStats();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: waStatus } = useGetWhatsappStatus({ query: { refetchInterval: 5000 } as any });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: "إجمالي الحملات", value: stats?.totalCampaigns ?? 0, icon: Megaphone, color: "text-blue-400" },
    { label: "حملات نشطة", value: stats?.activeCampaigns ?? 0, icon: Activity, color: "text-green-400" },
    { label: "إجمالي جهات الاتصال", value: stats?.totalContacts ?? 0, icon: Users, color: "text-purple-400" },
    { label: "رسائل مُرسلة", value: stats?.totalSent ?? 0, icon: Send, color: "text-primary" },
    { label: "رسائل فاشلة", value: stats?.totalFailed ?? 0, icon: XCircle, color: "text-red-400" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">لوحة التحكم</h1>
          <p className="text-muted-foreground text-sm mt-1">نظرة عامة على حملاتك</p>
        </div>
        <Link
          href="/campaigns/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          حملة جديدة
        </Link>
      </div>

      {/* Connection Alert */}
      {!waStatus?.connected && (
        <Link
          href="/connect"
          className="flex items-center gap-3 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm hover:bg-yellow-500/15 transition-colors"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>الواتساب غير متصل. اضغط هنا لربطه عبر QR كود</span>
          <ChevronLeft className="w-4 h-4 mr-auto" />
        </Link>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-muted-foreground leading-tight">{label}</p>
              <Icon className={cn("w-4 h-4 flex-shrink-0", color)} />
            </div>
            <p className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString("ar-SA")}</p>
          </div>
        ))}
      </div>

      {/* Recent Campaigns */}
      <div className="bg-card border border-card-border rounded-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
          <h2 className="font-semibold text-sm text-foreground">آخر الحملات</h2>
          <Link href="/campaigns" className="text-xs text-primary hover:underline">
            عرض الكل
          </Link>
        </div>
        {!stats?.recentCampaigns?.length ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            لا توجد حملات بعد
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {stats.recentCampaigns.map((c) => {
              const st = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft;
              const progress = c.totalCount > 0 ? (c.sentCount / c.totalCount) * 100 : 0;
              return (
                <Link
                  key={c.id}
                  href={`/campaigns/${c.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.contactGroupName || "—"}</p>
                  </div>
                  <div className="hidden md:flex items-center gap-6 text-xs text-muted-foreground">
                    <span>{c.sentCount} / {c.totalCount} مُرسل</span>
                    {c.totalCount > 0 && (
                      <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                  <span className={cn("text-xs px-2 py-1 rounded-md border font-medium", st.class)}>
                    {st.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
