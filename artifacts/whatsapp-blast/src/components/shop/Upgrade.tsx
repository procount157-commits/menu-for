// ── «اطلب الترقية» ────────────────────────────────────────────────
// Opens by itself whenever the server answers «this is in a higher plan»
// (any 402), and from the plan card on the home page. The request lands in
// the platform owner's subscription requests with the shop and the reason.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpCircle, Check, Crown, Loader2 } from "lucide-react";
import { get, post, useShopQuery } from "@/lib/shop-api";
import { Btn, errText } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

export const UPGRADE_EVENT = "mfy:upgrade";
export function askUpgrade(reason: string) { window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail: { reason } })); }

interface PlanRow { id: number; name: string; price: string; period_label: string | null; features: string[]; plan_key: string | null; badge: string | null }

export function UpgradeDialog() {
  const me = useShopQuery();
  const current = me.data && !me.data.needsOnboarding ? me.data.plan.plan : null;
  const owner = me.data && !me.data.needsOnboarding && me.data.role === "owner";
  const [reason, setReason] = useState<string | null>(null);
  const [want, setWant] = useState<"pro" | "business">("pro");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const plans = useQuery<PlanRow[]>({ queryKey: ["/api/plans"], queryFn: () => get("/api/plans"), enabled: reason !== null });

  useEffect(() => {
    const on = (e: Event) => {
      if (!owner || current === "business") return;
      setReason((e as CustomEvent).detail?.reason ?? "");
      setWant(current === "pro" ? "business" : "pro");
      setSent(false);
    };
    window.addEventListener(UPGRADE_EVENT, on);
    return () => window.removeEventListener(UPGRADE_EVENT, on);
  }, [owner, current]);

  const send = async () => {
    setBusy(true);
    try { await post("/api/tenancy/upgrade-request", { plan: want, reason }); setSent(true); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  const choices = (plans.data ?? []).filter((p) => (p.plan_key === "pro" && current !== "pro") || p.plan_key === "business");
  return (
    <Modal open={reason !== null} onOpenChange={(v) => !v && setReason(null)} wide title={<span className="flex items-center gap-2"><Crown className="w-5 h-5 text-primary" />{sent ? "وصل طلبك" : "ارفع خطتك"}</span>}
      description={sent ? undefined : reason || "خطة أكبر تعطيك فروعاً وموظفين أكثر وأدوات تبيع أكثر."}>
      {sent ? (
        <div className="space-y-3 text-sm">
          <p className="leading-relaxed">سجّلنا طلب الترقية إلى «{want === "business" ? "الأعمال" : "الاحترافية"}» — نتواصل معك على واتساب لتفعيلها. تقدر تكمل شغلك الآن عادي.</p>
          <Btn tone="gold" onClick={() => setReason(null)}>تم</Btn>
        </div>
      ) : (
        <div className="space-y-4">
          {plans.isLoading ? <div className="py-8 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
            <div className="grid sm:grid-cols-2 gap-3">
              {choices.map((p) => {
                const k = p.plan_key as "pro" | "business";
                return (
                  <button key={p.id} type="button" onClick={() => setWant(k)} className={cn("text-start rounded-xl border p-4 transition", want === k ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40")}>
                    <div className="flex items-center gap-2"><span className="font-bold flex-1">{p.name}</span>{p.badge && <span className="text-[10px] rounded-full bg-primary/20 text-primary px-2 py-0.5">{p.badge}</span>}</div>
                    <div className="text-xl font-black mt-1 tabular-nums">{Number(p.price)} <span className="text-xs font-normal text-muted-foreground">{p.period_label}</span></div>
                    <ul className="mt-2 space-y-1">
                      {(p.features ?? []).slice(0, 7).map((f) => <li key={f} className="text-xs text-muted-foreground flex gap-1.5"><Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />{f}</li>)}
                    </ul>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            <Btn tone="gold" disabled={busy} onClick={send}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}اطلب الترقية</Btn>
            <Btn tone="ghost" onClick={() => setReason(null)}>لاحقاً</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
