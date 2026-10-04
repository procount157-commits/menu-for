// ── The Google review link, under «طلب التقييم بعد الزيارة» ───────

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, Loader2, Save, Star } from "lucide-react";
import { get, patch, inputCls } from "@/lib/shop-api";
import { Btn, errText, n } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface Resp { url: string | null; enabled: boolean; stats: { rated: number; happy: number; unhappy: number; avg: number | null; toGoogle: number } }

export function GoogleReviewPanel() {
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: ["/api/growth/reviews"], queryFn: () => get("/api/growth/reviews") });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => { if (q.data) setUrl(q.data.url ?? ""); }, [q.data]);
  if (!q.data) return null;
  const d = q.data;
  const dirty = url.trim() !== (d.url ?? "");

  const save = async () => {
    setBusy(true);
    try { const r = await patch<{ url: string | null }>("/api/growth/reviews", { url }); setUrl(r.url ?? ""); toast.success(r.url ? "حُفظ رابط Google" : "أُزيل الرابط"); qc.invalidateQueries({ queryKey: ["/api/growth/reviews"] }); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Star className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">تقييمات Google</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            من يقيّم زيارته بـ 4 أو 5 يصله رابط تقييمك على Google — فيرتفع محلك في الخرائط ويراك زبائن جدد.
            ومن يقيّم بـ 3 أو أقل لا يُرسل إلى Google أبداً: ملاحظته تصلك أنت على جوالك لتتواصل معه.
          </p>
          {!d.enabled && <p className="text-[11px] text-amber-300 mt-1">فعّل «طلب التقييم بعد الزيارة» أعلاه ليبدأ هذا.</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <input className={cn(inputCls, "font-mono text-xs")} dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://g.page/r/…/review" />
        <Btn tone="gold" disabled={busy || !dirty} onClick={save}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}حفظ</Btn>
        {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-3 rounded-xl bg-secondary text-muted-foreground hover:text-foreground" title="جرّب الرابط"><ExternalLink className="w-4 h-4" /></a>}
      </div>
      <button type="button" onClick={() => setHelp((v) => !v)} className="text-xs text-primary flex items-center gap-1"><ChevronDown className={cn("w-3.5 h-3.5 transition", help && "rotate-180")} />كيف أحصل على الرابط؟</button>
      {help && (
        <ol className="text-xs text-muted-foreground leading-relaxed list-decimal ps-5 space-y-0.5">
          <li>ابحث عن اسم محلك في Google وأنت مسجّل بحساب صاحب المحل (أو افتح business.google.com).</li>
          <li>اضغط «اطلب تقييمات» (Ask for reviews).</li>
          <li>انسخ الرابط والصقه هنا.</li>
        </ol>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[["قيّموا (30 يوماً)", n(d.stats.rated)], ["متوسط التقييم", d.stats.avg ?? "—"], ["أُرسلوا إلى Google", n(d.stats.toGoogle)], ["ملاحظات وصلتك", n(d.stats.unhappy)]].map(([l, v]) => (
          <div key={String(l)} className="rounded-lg bg-secondary/50 py-2"><div className="text-lg font-bold tabular-nums">{v}</div><div className="text-[11px] text-muted-foreground">{l}</div></div>
        ))}
      </div>
    </div>
  );
}
