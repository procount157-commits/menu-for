// ── «ادعُ صديقاً» settings, on the deals page ──────────────────────

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { get, patch, useShop } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { errText, n } from "@/components/shop/ops/kit";

interface Resp { enabled: boolean; prefs: { friendPct: number; rewardPct: number; rewardDays: number }; stats: { friends: number; rewarded: number; sales: number }; allowed: boolean; planName: string }

export function ReferralPanel() {
  const shop = useShop();
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: ["/api/growth/referral"], queryFn: () => get("/api/growth/referral") });
  const [p, setP] = useState({ friendPct: 10, rewardPct: 15, rewardDays: 30 });
  useEffect(() => { if (q.data) setP(q.data.prefs); }, [q.data]);
  if (!q.data) return null;
  const d = q.data;
  const owner = shop.role === "owner";
  const save = async (body: Record<string, unknown>, ok?: string) => {
    try { await patch("/api/growth/referral", body); if (ok) toast.success(ok); qc.invalidateQueries({ queryKey: ["/api/growth/referral"] }); }
    catch (e) { toast.error(errText(e)); }
  };
  const field = (k: keyof typeof p, min: number, max: number) => (
    <input className="w-16 h-9 rounded-lg bg-input border border-border px-2 tabular-nums" type="number" min={min} max={max} value={p[k]} disabled={!owner}
      onChange={(e) => setP((x) => ({ ...x, [k]: Number(e.target.value) }))} onBlur={() => p[k] !== d.prefs[k] && save({ [k]: p[k] }, "حُفظت")} />
  );
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <UserPlus className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">ادعُ صديقاً</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            بعد كل طلب يظهر للزبون رابط يشاركه. صديقه الجديد على محلك يأخذ خصماً على أول طلب، وبعد اكتمال الطلب يصل الزبون كود هدية على واتساب.
            الرقم يكون «صديقاً» مرة واحدة فقط، ولا أحد يدعو نفسه.
          </p>
          {!d.allowed && <p className="text-[11px] text-amber-300 mt-1">ضمن خطة «أعمال» — خطتك {d.planName}.</p>}
        </div>
        {owner && <Switch checked={d.enabled} disabled={!d.allowed && !d.enabled} onCheckedChange={(v) => save({ enabled: v }, v ? "فُعّل «ادعُ صديقاً»" : "أُوقف")} dir="ltr" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">الصديق يأخذ</span>{field("friendPct", 5, 50)}<span className="text-muted-foreground">% · الزبون يأخذ</span>{field("rewardPct", 5, 50)}
        <span className="text-muted-foreground">% صالح</span>{field("rewardDays", 7, 90)}<span className="text-muted-foreground">يوماً</span>
      </div>
      <div className="text-xs text-muted-foreground">{n(d.stats.friends)} صديقاً طلبوا بدعوة · {n(d.stats.rewarded)} مكافأة أُرسلت · مبيعاتهم {formatMoney(d.stats.sales, shop.org.currency)}</div>
    </section>
  );
}
