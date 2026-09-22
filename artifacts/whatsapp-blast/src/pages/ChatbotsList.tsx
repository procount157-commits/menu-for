import { useState } from "react";
import { Link } from "wouter";
import {
  useListChatbots,
  useCreateChatbot,
  useDeleteChatbot,
  useToggleChatbot,
  getListChatbotsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Bot, Trash2, ChevronLeft, Loader2, Power } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function ChatbotsList() {
  const queryClient = useQueryClient();
  const { data: bots, isLoading } = useListChatbots();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [welcome, setWelcome] = useState("");

  const createMutation = useCreateChatbot({
    mutation: {
      onSuccess: () => {
        toast.success("تم إنشاء الشات بوت");
        queryClient.invalidateQueries({ queryKey: getListChatbotsQueryKey() });
        setShowCreate(false);
        setName("");
        setWelcome("");
      },
      onError: () => toast.error("حدث خطأ"),
    },
  });

  const deleteMutation = useDeleteChatbot({
    mutation: {
      onSuccess: () => {
        toast.success("تم حذف الشات بوت");
        queryClient.invalidateQueries({ queryKey: getListChatbotsQueryKey() });
      },
    },
  });

  const toggleMutation = useToggleChatbot({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListChatbotsQueryKey() }),
      onError: () => toast.error("حدث خطأ"),
    },
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">الشات بوت</h1>
          <p className="text-sm text-muted-foreground mt-1">بناء وإدارة ردود تلقائية ذكية</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          شات بوت جديد
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-card-border rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-foreground mb-4">شات بوت جديد</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim() || !welcome.trim()) return;
                createMutation.mutate({ data: { name: name.trim(), welcomeMessage: welcome.trim() } });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">اسم الشات بوت *</label>
                <input
                  autoFocus type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: خدمة العملاء"
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">رسالة الترحيب *</label>
                <textarea
                  value={welcome} onChange={(e) => setWelcome(e.target.value)}
                  placeholder="أهلاً بك! كيف يمكنني مساعدتك؟" rows={3}
                  className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={createMutation.isPending || !name.trim() || !welcome.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  إنشاء
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setName(""); setWelcome(""); }}
                  className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !bots?.length ? (
        <div className="bg-card border border-card-border rounded-xl py-16 text-center">
          <Bot className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">لا يوجد شات بوت بعد</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">أنشئ شات بوت لأتمتة الردود على العملاء</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="divide-y divide-card-border">
            {bots.map((bot) => (
              <div key={bot.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{bot.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{bot.welcomeMessage}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleMutation.mutate({ id: bot.id })}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      bot.enabled
                        ? "bg-green-500/15 text-green-400 border-green-500/20 hover:bg-green-500/20"
                        : "bg-muted text-muted-foreground border-border hover:border-primary/20"
                    )}
                  >
                    <Power className="w-3 h-3" />
                    {bot.enabled ? "مفعّل" : "معطّل"}
                  </button>
                  <Link href={`/chatbots/${bot.id}`} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={() => { if (confirm(`حذف "${bot.name}"؟`)) deleteMutation.mutate({ id: bot.id }); }}
                    className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                  >
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
