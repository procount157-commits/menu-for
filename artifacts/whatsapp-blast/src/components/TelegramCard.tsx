import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send, Link2, Check, AlertCircle, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, input } from "./AgentPanel";

const card = "bg-card border border-card-border rounded-xl";
const ghost = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-card-border hover:border-primary/50 transition-colors disabled:opacity-40";

/**
 * Telegram takes two steps and there is no way around it: a bot cannot open a
 * conversation, so the owner has to message it before its chat id exists.
 */
export function TelegramCard() {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState<string | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["telegram"], queryFn: () => api("/api/telegram"),
  });

  const save = useMutation({
    mutationFn: () => api("/api/telegram/token", { method: "POST", body: JSON.stringify({ token }) }),
    onSuccess: (d: any) => {
      setUsername(d.username); setToken("");
      toast.success(`البوت @${d.username} تم التعرّف عليه`);
      qc.invalidateQueries({ queryKey: ["telegram"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const link = useMutation({
    mutationFn: () => api("/api/telegram/link", { method: "POST" }),
    onSuccess: (d: any) => {
      if (d.linked) { toast.success(`مربوط بـ ${d.chatTitle}`); qc.invalidateQueries({ queryKey: ["telegram"] }); }
      else toast.error("لم أجد رسالة منك بعد — أرسل /start للبوت ثم أعد المحاولة");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => api("/api/telegram/test", { method: "POST" }),
    onSuccess: (d: any) => d.ok ? toast.success("وصلتك رسالة على تليجرام") : toast.error("لم تصل — راجع الربط"),
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api("/api/telegram", { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telegram"] }),
  });

  if (isLoading) return <div className={cn(card, "p-6 flex justify-center")}><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const linked = data?.linked;

  return (
    <div className={card}>
      <div className="p-4 border-b border-card-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">تليجرام</p>
            {linked && (
              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-primary/30 text-primary">
                <Check className="w-3 h-3" /> {data.chatTitle}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            تصلك تقارير ريم الصباحية ومراجعات شمّة وتنبيهات فهد هنا.
          </p>
        </div>
        {linked && (
          <button onClick={() => toggle.mutate(!data.enabled)}
            className={cn(ghost, "shrink-0", data.enabled ? "" : "border-primary/30 text-primary")}>
            <Power className="w-3.5 h-3.5" /> {data.enabled ? "أوقف" : "شغّل"}
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {data?.lastError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 p-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">آخر خطأ: {data.lastError}</p>
          </div>
        )}

        {/* Step one */}
        <div>
          <label className="text-xs font-semibold block mb-1.5">
            ١. توكن البوت
            {data?.configured && <span className="text-muted-foreground font-normal"> — مضبوط ({data.tokenHint})</span>}
          </label>
          <div className="flex gap-2">
            <input value={token} onChange={(e) => setToken(e.target.value)} dir="ltr"
                   placeholder="1234567890:AA..." className={cn(input, "flex-1 font-mono text-xs")} />
            <button onClick={() => save.mutate()} disabled={!token.trim() || save.isPending} className={ghost}>
              {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} احفظ
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">من @BotFather على تليجرام</p>
        </div>

        {/* Step two */}
        {data?.configured && (
          <div>
            <label className="text-xs font-semibold block mb-1.5">٢. اربط محادثتك</label>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              افتح البوت{username ? ` @${username}` : ""} على تليجرام وأرسل له <code className="px-1 rounded bg-muted">/start</code>، ثم اضغط هنا.
              تليجرام لا يسمح للبوت ببدء المحادثة، فلا بد أن تراسله أنت أولاً.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => link.mutate()} disabled={link.isPending} className={ghost}>
                {link.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                {linked ? "أعد الربط" : "اربط الآن"}
              </button>
              {linked && (
                <button onClick={() => test.mutate()} disabled={test.isPending} className={ghost}>
                  {test.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  جرّب
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
