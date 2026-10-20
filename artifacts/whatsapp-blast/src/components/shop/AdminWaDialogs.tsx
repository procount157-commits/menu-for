// ── Admin dialogs: a branch's WhatsApp QR link, and the messaging rules ──

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, QrCode, RefreshCw, Send } from "lucide-react";
import { get, post, put, inputCls, labelCls } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, errText } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

interface WaLink { branchId: number; name: string; waUserId: number; connected: boolean; phone: string | null; link: string }

/** The links that open each branch's QR page — send one to the owner, or open it and link it yourself. */
export function WaLinksDialog({ org, onClose }: { org: { id: number; name: string; owner_name: string | null; owner_phone: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery<WaLink[]>({ queryKey: ["/api/admin/orgs/wa-links", org?.id], queryFn: () => get(`/api/admin/orgs/${org!.id}/wa-links`), enabled: !!org, refetchInterval: 10_000 });
  const [busy, setBusy] = useState<number | null>(null);
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast.success("نُسخ الرابط"); } catch { toast.error("تعذّر النسخ"); } };
  const renew = async (w: WaLink) => {
    if (!confirm("رابط جديد يلغي الرابط القديم. متأكد؟")) return;
    setBusy(w.waUserId);
    try { await post(`/api/admin/orgs/wa-links/${w.waUserId}/renew`); await qc.invalidateQueries({ queryKey: ["/api/admin/orgs/wa-links", org?.id] }); toast.success("رابط جديد جاهز"); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(null); }
  };
  const waText = (w: WaLink) => `مرحباً ${org?.owner_name ?? ""} 👋\nهذا رابط ربط واتساب «${org?.name}»${w.name && q.data && q.data.length > 1 ? ` — فرع ${w.name}` : ""}:\n${w.link}\n\nافتحه من الكمبيوتر أو جوال آخر، ثم من واتساب على جوالك: الإعدادات ← الأجهزة المرتبطة ← ربط جهاز، وامسح الرمز.`;
  return (
    <Modal open={!!org} onOpenChange={(v) => !v && onClose()} title={<span className="flex items-center gap-2"><QrCode className="w-5 h-5 text-primary" />ربط واتساب — {org?.name}</span>}
      description="رابط يفتح صفحة فيها رمز QR الخاص بالفرع فقط، بلا تسجيل دخول. أرسله لصاحب المحل يمسحه بنفسه، أو افتحه أنت واربطه معه.">
      {q.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <div className="space-y-3">
          {q.data?.map((w) => (
            <div key={w.waUserId} className="rounded-xl border border-card-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{w.name}</span>
                <span className={cn("text-xs rounded-full px-2 py-0.5", w.connected ? "bg-emerald-500/15 text-emerald-300" : "bg-secondary text-muted-foreground")}>{w.connected ? `متصل${w.phone ? ` · ${w.phone}` : ""}` : "غير متصل"}</span>
              </div>
              <div className="flex gap-2"><input readOnly dir="ltr" className={cn(inputCls, "text-xs")} value={w.link} onFocus={(e) => e.currentTarget.select()} /></div>
              <div className="flex flex-wrap gap-1.5">
                <Btn className="min-h-9" onClick={() => copy(w.link)}><Copy className="w-4 h-4" />نسخ</Btn>
                <a href={w.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl px-3 min-h-9 text-sm border border-border hover:bg-secondary/60"><ExternalLink className="w-4 h-4" />افتح الرمز</a>
                <a href={`https://wa.me/${(org?.owner_phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(waText(w))}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 min-h-9 text-sm bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><Send className="w-4 h-4" />أرسله لصاحب المحل</a>
                <Btn tone="ghost" className="min-h-9" disabled={busy === w.waUserId} onClick={() => renew(w)}><RefreshCw className="w-4 h-4" />رابط جديد</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface Messaging { interactive: boolean; stopDays: number; stopButton: boolean; footer: string }

/** Real buttons, the stop button, and how long a stop lasts — for every account on the platform. */
export function MessagingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery<Messaging>({ queryKey: ["/api/admin/orgs/messaging"], queryFn: () => get("/api/admin/orgs/messaging"), enabled: open });
  const qc = useQueryClient();
  const [m, setM] = useState<Messaging | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setM(q.data); }, [q.data]);
  const save = async (patch: Partial<Messaging>) => {
    try { const r = await put<Messaging>("/api/admin/orgs/messaging", { ...m, ...patch }); setM(r); qc.setQueryData(["/api/admin/orgs/messaging"], r); toast.success("انحفظ"); }
    catch (e) { toast.error(errText(e)); }
  };
  const test = async () => {
    setBusy(true);
    try { await post("/api/admin/orgs/messaging/test", { phone }); toast.success("أُرسلت رسالة التجربة — افتحها على الجوال"); }
    catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="الرسائل والأزرار" description="تسري على كل الحسابات: الحملات، رسائل العروض للزبائن، وموظف المبيعات.">
      {!m ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <div className="space-y-5">
          <div className="rounded-xl border border-card-border p-3 space-y-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">أزرار واتساب الحقيقية<span className="block text-xs text-muted-foreground font-normal">أزرار تُضغط تحت الرسالة بدل سطور النص. جرّبها على جوالك أولاً.</span></span>
              <Switch checked={m.interactive} onCheckedChange={(v) => save({ interactive: v })} />
            </label>
            <div className="flex gap-2">
              <input className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9715XXXXXXXX" />
              <Btn disabled={busy || phone.replace(/\D/g, "").length < 8} onClick={test}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}أرسل تجربة</Btn>
            </div>
            <p className="text-[11px] text-muted-foreground">تُرسل من حسابك المتصل. إن ظهرت الأزرار على جوالك (آيفون وأندرويد) فعّلها. إن ظهرت الرسالة فارغة أو «لا يمكن عرضها» اتركها مطفأة — تبقى الأزرار سطوراً نظيفة.</p>
            <label className="block"><span className={labelCls}>سطر صغير تحت الرسالة (اختياري)</span>
              <input className={inputCls} value={m.footer} maxLength={60} onChange={(e) => setM({ ...m, footer: e.target.value })} onBlur={() => save({ footer: m.footer })} placeholder="مثل: منيو فور يو" /></label>
          </div>
          <div className="rounded-xl border border-card-border p-3 space-y-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">زر «إيقاف الرسائل» تلقائياً<span className="block text-xs text-muted-foreground font-normal">على كل حملة، ورسائل العروض للزبائن، ورسائل موظف المبيعات الأولى والمتابعات.</span></span>
              <Switch checked={m.stopButton} onCheckedChange={(v) => save({ stopButton: v })} />
            </label>
            <p className="text-[11px] text-muted-foreground">الإيقاف دائم: من يضغط الزر أو يكتب «توقف» (أو أي رسالة قصيرة تطلب الإيقاف) لا تصله أي رسالة عروض من الحساب الذي راسله بعد اليوم، ويُحذف من قوائم ذلك الحساب. طلباته ودوره وحجوزاته تصله عادي.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
