// ── The weekly report card on /reports ────────────────────────────
// What the owner's phone receives every week, shown here as it will look,
// with the day and hour and a button to send this week's now.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { CalendarClock, CheckCheck, ChevronDown, Loader2, Send } from "lucide-react";
import { get, patch, post } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, clock, errText, shortDate } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface Prefs { enabled: boolean; weekday: number; hour: number }
interface Resp {
  prefs: Prefs; preview: string; recipients: string[];
  recent: Array<{ id: number; weekStart: string; sentTo: string[]; manual: boolean; createdAt: string; text: string }>;
}
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const hourLabel = (h: number) => (h > 12 ? `${h - 12} مساءً` : h === 12 ? "12 ظهراً" : `${h} صباحاً`);

export function WeeklyReportCard({ tz }: { tz: string }) {
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: ["/api/growth/report"], queryFn: () => get("/api/growth/report") });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (q.data) setPrefs(q.data.prefs); }, [q.data]);
  if (!q.data || !prefs) return null;
  const d = q.data;

  const save = async (next: Prefs) => {
    setPrefs(next);
    try { await patch("/api/growth/report", next); toast.success(next.enabled ? "حُفظ موعد التقرير" : "أُوقف التقرير الأسبوعي"); qc.invalidateQueries({ queryKey: ["/api/growth/report"] }); }
    catch (e) { toast.error(errText(e)); setPrefs(d.prefs); }
  };
  const sendNow = async () => {
    setBusy(true);
    try { const r = await post<{ to: string[] }>("/api/growth/report/send"); toast.success(`أُرسل إلى ${r.to.map((p) => `+${p}`).join("، ")}`); qc.invalidateQueries({ queryKey: ["/api/growth/report"] }); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <CalendarClock className="w-5 h-5 text-primary" />
        <h2 className="font-bold flex-1">التقرير الأسبوعي على واتساب</h2>
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{prefs.enabled ? "يعمل" : "متوقف"}</span>
          <Switch checked={prefs.enabled} onCheckedChange={(v) => save({ ...prefs, enabled: v })} dir="ltr" /></label>
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-4">
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground leading-relaxed">كل أسبوع تصلك رسالة واحدة على جوالك: الطلبات والمبيعات، من رجع من زبائنك، من خسرت من الصف، الصنف الأكثر طلباً — ونصيحة واحدة من أرقام أسبوعك.</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">يصلك يوم</span>
            <select className="h-9 rounded-lg bg-input border border-border px-2" value={prefs.weekday} onChange={(e) => save({ ...prefs, weekday: Number(e.target.value) })}>
              {DAYS.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
            <span className="text-muted-foreground">الساعة</span>
            <select className="h-9 rounded-lg bg-input border border-border px-2" value={prefs.hour} onChange={(e) => save({ ...prefs, hour: Number(e.target.value) })}>
              {Array.from({ length: 14 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">إلى:</span>
            {d.recipients.length ? d.recipients.map((p) => <span key={p} className="rounded-full bg-secondary px-2.5 py-0.5 tabular-nums" dir="ltr">+{p}</span>)
              : <span className="text-amber-300">لا يوجد رقم بعد —</span>}
            <Link href="/wa-auto" className="text-primary underline underline-offset-4 text-xs">{d.recipients.length ? "غيّر الأرقام" : "أضف رقمك في «تنبيهات المحل»"}</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn tone="gold" disabled={busy || !d.recipients.length} onClick={sendNow}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}أرسله لي الآن</Btn>
            {d.recent.length > 0 && <Btn tone="ghost" onClick={() => setOpen((v) => !v)}><ChevronDown className={cn("w-4 h-4 transition", open && "rotate-180")} />التقارير السابقة ({d.recent.length})</Btn>}
          </div>
          {open && (
            <ul className="divide-y divide-border/60 rounded-lg border border-border">
              {d.recent.map((r) => (
                <li key={r.id} className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">أسبوع {r.weekStart}</span>
                  {r.manual && <span className="rounded-full bg-secondary px-2 py-0.5">يدوي</span>}
                  <span className="text-muted-foreground">{shortDate(r.createdAt, tz)} {clock(r.createdAt, tz)}</span>
                  <span className="text-muted-foreground tabular-nums" dir="ltr">{r.sentTo.map((p) => `+${p}`).join(", ") || "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl p-3 bg-[#0b141a]">
          <div className="text-[11px] text-[#8696a0] mb-1.5 text-center">هذا الأسبوع حتى الآن — هكذا يصلك</div>
          <div className="rounded-xl rounded-tr-sm px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-[#e9edef] bg-[#005c4b] shadow max-h-80 overflow-y-auto">
            {d.preview.replace(/\*/g, "")}
            <div className="text-[10px] text-[#8696a0] mt-1 flex items-center justify-end gap-1">{clock(new Date(), tz)}<CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
