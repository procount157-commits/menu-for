import { useState } from "react";
import { Link } from "wouter";
import {
  useListCampaigns,
  useDeleteCampaign,
  useStartCampaign,
  usePauseCampaign,
  getListCampaignsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Megaphone, Trash2, Play, Pause, ChevronLeft, Loader2, RotateCcw, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  draft: { label: "مسودة", class: "bg-gray-500/15 text-gray-400 border-gray-500/20" },
  scheduled: { label: "مجدولة", class: "bg-purple-500/15 text-purple-400 border-purple-500/20" },
  running: { label: "تعمل", class: "bg-green-500/15 text-green-400 border-green-500/20" },
  paused: { label: "متوقفة", class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
  completed: { label: "مكتملة", class: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  failed: { label: "فشلت", class: "bg-red-500/15 text-red-400 border-red-500/20" },
};

const TYPE_LABELS: Record<string, string> = {
  text: "نص",
  image: "صورة",
  video: "فيديو",
  carousel: "كاروسيل",
  button: "أزرار",
};

async function restartCampaign(id: number): Promise<void> {
  const res = await fetch(`/api/campaigns/${id}/restart`, { method: "POST", credentials: "include" });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "فشلت إعادة التشغيل"); }
}

export default function CampaignsList() {
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useListCampaigns();
  const [restartingId, setRestartingId] = useState<number | null>(null);

  const deleteMutation = useDeleteCampaign({
    mutation: {
      onSuccess: () => {
        toast.success("تم حذف الحملة");
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      },
      onError: () => toast.error("حدث خطأ أثناء الحذف"),
    },
  });

  const startMutation = useStartCampaign({
    mutation: {
      onSuccess: () => {
        toast.success("بدأت الحملة");
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      },
      onError: (err: any) => toast.error(err?.data?.error || "خطأ في بدء الحملة"),
    },
  });

  const pauseMutation = usePauseCampaign({
    mutation: {
      onSuccess: () => {
        toast.success("تم إيقاف الحملة مؤقتاً");
        queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      },
      onError: () => toast.error("حدث خطأ"),
    },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الحملات</h1>
          <p className="text-sm text-muted-foreground mt-1">إدارة حملات الإرسال الجماعي</p>
        </div>
        <Link
          href="/campaigns/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          حملة جديدة
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !campaigns?.length ? (
        <div className="bg-card border border-card-border rounded-xl py-16 text-center">
          <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">لا توجد حملات بعد</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">أنشئ حملتك الأولى وابدأ الإرسال</p>
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            حملة جديدة
          </Link>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">الحملة</th>
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium hidden md:table-cell">النوع</th>
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium hidden lg:table-cell">الأرقام</th>
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">التقدم</th>
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">الحالة</th>
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {campaigns.map((c) => {
                  const st = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft;
                  const progress = c.totalCount > 0 ? Math.round((c.sentCount / c.totalCount) * 100) : 0;
                  return (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-medium text-sm text-foreground hover:text-primary transition-colors"
                        >
                          {c.name}
                        </Link>
                        <p className="text-xs text-muted-foreground mt-0.5">{c.contactGroupName || "—"}</p>
                      </td>
                      <td className="px-5 py-3.5 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground">{TYPE_LABELS[c.messageType] || c.messageType}</span>
                      </td>
                      <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-muted-foreground">
                        {c.sentCount} / {c.totalCount}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn("text-xs px-2 py-1 rounded-md border font-medium", st.class)}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {c.status === "running" ? (
                            <button
                              onClick={() => pauseMutation.mutate({ id: c.id })}
                              className="p-1.5 text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors"
                              title="إيقاف مؤقت"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                          ) : (c.status === "draft" || c.status === "paused" || (c.status as string) === "auto_paused") ? (
                            <button
                              onClick={() => startMutation.mutate({ id: c.id })}
                              className="p-1.5 text-green-400 hover:bg-green-500/10 rounded transition-colors"
                              title="تشغيل"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                          {(c.status === "completed" || c.status === "failed" || c.status === "paused" || (c.status as string) === "auto_paused") && (
                            <button
                              disabled={restartingId === c.id}
                              onClick={async () => {
                                if (!confirm(`إعادة إرسال حملة "${c.name}" من البداية؟ سيتم مسح سجل الإرسال السابق.`)) return;
                                setRestartingId(c.id);
                                try {
                                  await restartCampaign(c.id);
                                  toast.success("تم إعادة تشغيل الحملة ✓");
                                  queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
                                } catch (e: any) {
                                  toast.error(e.message);
                                } finally {
                                  setRestartingId(null);
                                }
                              }}
                              className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50"
                              title="إعادة الإرسال من البداية"
                            >
                              {restartingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <Link
                            href={`/campaigns/${c.id}/edit`}
                            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
                            title="تعديل"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Link>
                          <Link
                            href={`/campaigns/${c.id}`}
                            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </Link>
                          <button
                            onClick={() => {
                              if (confirm(`حذف حملة "${c.name}"؟`)) {
                                deleteMutation.mutate({ id: c.id });
                              }
                            }}
                            className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
