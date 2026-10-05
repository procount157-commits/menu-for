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

interface PlanRow { id: string | number; name: string; price: string; price_yearly: string | null; contact_sales: boolean; period_label: string | null; features: string[]; plan_key: string | null; badge: string | null; sort_order: number }

export function UpgradeDialog() {
  const me = useShopQuery();
  const current = me.data && !me.data.needsOnboarding ? me.data.plan.plan : null;
  const owner = me.data && !me.data.needsOnboarding && me.data.role === "owner";
  const [reason, setReason] = useState<string | null>(null);
  const [want, setWant] = useState<string>("pro");
  const [yearly, setYearly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const plans = useQuery<PlanRow[]>({ queryKey: ["/api/plans"], queryFn: () => get("/api/plans"), enabled: reason !== null });

  useEffect(() => {
    const on = (e: Event) => {
      if (!owner) return;
      setReason((e as CustomEvent).detail?.reason ?? "");
      setSent(false);
    };
    window.addEventListener(UPGRADE_EVENT, on);
    return () => window.removeEventListener(UPGRADE_EVENT, on);
  }, [owner, current]);

  const send = async () => {
    setBusy(true);
    try { await post("/api/tenancy/upgrade-request", { plan: want, reason, yearly }); setSent(true); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  // Every public plan above the current one, by price.
  const curPrice = (plans.data ?? []).find((p) => p.plan_key === current)?.price ?? "0";
  const choices = (plans.data ?? []).filter((p) => p.plan_key && p.plan_key !== current && Number(p.price) > Number(curPrice)).sort((a, b) => Number(a.price) - Number(b.price));
  const anyYearly = choices.some((p) => p.price_yearly);
  useEffect(() => { if (choices.length && !choices.some((p) => p.plan_key === want)) setWant(choices[0]!.plan_key!); }, [choices, want]);
  return (
    <Modal open={reason !== null} onOpenChange={(v) => !v && setReason(null)} wide title={<span className="flex items-center gap-2"><Crown className="w-5 h-5 text-primary" />{sent ? "وصل طلبك" : "ارفع خطتك"}</span>}
      description={sent ? undefined : reason || "خطة أكبر تعطيك فروعاً وموظفين أكثر وأدوات تبيع أكثر."}>
      {sent ? (
        <div className="space-y-3 text-sm">
          <p className="leading-relaxed">سجّلنا طلب الترقية إلى «{choices.find((p) => p.plan_key === want)?.name ?? want}» — نتواصل معك على واتساب لتفعيلها. تقدر تكمل شغلك الآن عادي.</p>
          <Btn tone="gold" onClick={() => setReason(null)}>تم</Btn>
        </div>
      ) : (
        <div className="space-y-4">
          {anyYearly && (
            <div className="flex justify-center"><div className="flex rounded-xl bg-secondary p-1 gap-1 text-sm">
              <button type="button" onClick={() => setYearly(false)} className={cn("px-4 h-9 rounded-lg", !yearly ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}>شهري</button>
              <button type="button" onClick={() => setYearly(true)} className={cn("px-4 h-9 rounded-lg", yearly ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}>سنوي</button>
            </div></div>
          )}
          {plans.isLoading ? <div className="py-8 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
            <div className={cn("grid gap-3", choices.length > 1 && "sm:grid-cols-2")}>
              {choices.map((p) => {
                const k = p.plan_key!;
                const price = yearly && p.price_yearly ? Number(p.price_yearly) : Number(p.price);
                return (
                  <button key={p.id} type="button" onClick={() => setWant(k)} className={cn("text-start rounded-xl border p-4 transition", want === k ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/40")}>
                    <div className="flex items-center gap-2"><span className="font-bold flex-1">{p.name}</span>{p.badge && <span className="text-[10px] rounded-full bg-primary/20 text-primary px-2 py-0.5">{p.badge}</span>}</div>
                    <div className="text-xl font-black mt-1 tabular-nums">{p.contact_sales ? <span className="text-base">تواصل معنا</span> : <>{price} <span className="text-xs font-normal text-muted-foreground">{yearly && p.price_yearly ? "درهم / سنة" : p.period_label}</span></>}</div>
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
