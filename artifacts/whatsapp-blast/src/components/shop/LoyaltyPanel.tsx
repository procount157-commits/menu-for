// ── The stamp card, on the deals page ─────────────────────────────

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Stamp } from "lucide-react";
import { get, patch, useShop } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { errText, n } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface Prefs { target: number; rewardKind: "pct" | "amount"; rewardValue: number; rewardLabel: string | null; rewardDays: number }
interface Resp { enabled: boolean; prefs: Prefs; reward: string; stats: { members: number; rewards: number; returning: number; redeemed: number }; allowed: boolean; planName: string }

export function LoyaltyPanel() {
  const shop = useShop();
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: ["/api/growth/loyalty"], queryFn: () => get("/api/growth/loyalty") });
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => { if (q.data) setP(q.data.prefs); }, [q.data]);
  if (!q.data || !p) return null;
  const d = q.data;
  const owner = shop.role === "owner";
  const save = async (body: Partial<Prefs> & { enabled?: boolean }, ok?: string) => {
    try { await patch("/api/growth/loyalty", body); if (ok) toast.success(ok); qc.invalidateQueries({ queryKey: ["/api/growth/loyalty"] }); }
    catch (e) { toast.error(errText(e)); }
  };
  const num = (k: "target" | "rewardValue" | "rewardDays", w = "w-16") => (
    <input className={cn(w, "h-9 rounded-lg bg-input border border-border px-2 tabular-nums")} type="number" disabled={!owner} value={p[k]}
      onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} onBlur={() => p[k] !== d.prefs[k] && save({ [k]: p[k] }, "حُفظت")} />
  );
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Stamp className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">بطاقة الأختام</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            ختم لكل زيارة أو طلب مكتمل (ختم واحد في اليوم). عند اكتمال البطاقة تصل الزبون هديته على واتساب بكود خاص به، وتبدأ بطاقة جديدة.
            يرى الزبون أختامه في صفحة طلبه ودوره وحجزه — بدون تطبيق ولا بطاقة ورق.
          </p>
          {!d.allowed && <p className="text-[11px] text-amber-300 mt-1">ضمن خطة «احترافي» — خطتك {d.planName}.</p>}
        </div>
        {owner && <Switch checked={d.enabled} disabled={!d.allowed && !d.enabled} onCheckedChange={(v) => save({ enabled: v }, v ? "فُعّلت بطاقة الأختام" : "أُوقفت")} dir="ltr" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">كل</span>{num("target")}<span className="text-muted-foreground">أختام = هدية:</span>
        <div className="flex rounded-lg bg-secondary p-0.5">
          {(["amount", "pct"] as const).map((k) => <button key={k} type="button" disabled={!owner} onClick={() => { setP({ ...p, rewardKind: k }); void save({ rewardKind: k }); }} className={cn("px-2.5 h-8 rounded-md text-xs", p.rewardKind === k ? "bg-background font-semibold" : "text-muted-foreground")}>{k === "amount" ? `مبلغ (${shop.org.currency})` : "نسبة %"}</button>)}
        </div>
        {num("rewardValue", "w-20")}
        <span className="text-muted-foreground">صالحة</span>{num("rewardDays")}<span className="text-muted-foreground">يوماً</span>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">اسم الهدية كما يراه الزبون (اختياري):</span>
        <input className="flex-1 min-w-[10rem] h-9 rounded-lg bg-input border border-border px-2" disabled={!owner} value={p.rewardLabel ?? ""} placeholder={d.reward}
          onChange={(e) => setP({ ...p, rewardLabel: e.target.value })} onBlur={() => (p.rewardLabel ?? "") !== (d.prefs.rewardLabel ?? "") && save({ rewardLabel: p.rewardLabel ?? "" }, "حُفظت")} />
      </label>
      <div className="text-xs text-muted-foreground">{n(d.stats.members)} زبوناً عندهم أختام · {n(d.stats.returning)} رجعوا أكثر من مرة · {n(d.stats.rewards)} بطاقة اكتملت · {n(d.stats.redeemed)} هدية استُخدمت</div>
    </section>
  );
}
