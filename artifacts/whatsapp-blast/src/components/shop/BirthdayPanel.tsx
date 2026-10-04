// ── The birthday gift, under the automatic messages ───────────────

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cake } from "lucide-react";
import { get, patch } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { errText, n } from "@/components/shop/ops/kit";

interface Resp { enabled: boolean; prefs: { pct: number; days: number }; known: number; sentThisYear: number; allowed: boolean; planName: string }

export function BirthdayPanel() {
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: ["/api/growth/birthday"], queryFn: () => get("/api/growth/birthday") });
  const [pct, setPct] = useState(15);
  const [days, setDays] = useState(7);
  useEffect(() => { if (q.data) { setPct(q.data.prefs.pct); setDays(q.data.prefs.days); } }, [q.data]);
  if (!q.data) return null;
  const d = q.data;
  const save = async (body: Record<string, unknown>, ok?: string) => {
    try { await patch("/api/growth/birthday", body); if (ok) toast.success(ok); qc.invalidateQueries({ queryKey: ["/api/growth/birthday"] }); }
    catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Cake className="w-5 h-5 text-pink-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">هدية عيد الميلاد</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            بعد الزيارة نسأل الزبون مرة واحدة عن يوم وشهر ميلاده. في يومه تصله تهنئة من محلك مع كود خصم خاص به وحده — رسالة واحدة في السنة لمن اختار أن يعطينا التاريخ.
          </p>
          {!d.allowed && <p className="text-[11px] text-amber-300 mt-1">ضمن خطة «احترافي» — خطتك {d.planName}.</p>}
        </div>
        <Switch checked={d.enabled} disabled={!d.allowed && !d.enabled} onCheckedChange={(v) => save({ enabled: v }, v ? "فُعّلت هدية عيد الميلاد" : "أُوقفت")} dir="ltr" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">الهدية: خصم</span>
        <input className="w-16 h-9 rounded-lg bg-input border border-border px-2 tabular-nums" type="number" min={5} max={50} value={pct} onChange={(e) => setPct(Number(e.target.value))} onBlur={() => pct !== d.prefs.pct && save({ pct }, "حُفظت")} />
        <span className="text-muted-foreground">% صالح</span>
        <input className="w-16 h-9 rounded-lg bg-input border border-border px-2 tabular-nums" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} onBlur={() => days !== d.prefs.days && save({ days }, "حُفظت")} />
        <span className="text-muted-foreground">أيام</span>
      </div>
      <div className="text-xs text-muted-foreground">{n(d.known)} زبوناً أعطونا تاريخ ميلادهم · {n(d.sentThisYear)} هدية أُرسلت هذه السنة</div>
    </div>
  );
}
