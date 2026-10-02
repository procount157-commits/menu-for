// ── Model keys per channel ────────────────────────────────────────
// WhatsApp (the reply agent, the weekly campaign) and email (the outreach
// writer) each run on their own keys, tried in order — so heavy use of one
// never starves the other. A key is checked against its provider before it
// is stored, and only its last characters are ever shown again.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, Loader2, Mail, MessageCircle, Plus, Trash2, XCircle, FlaskConical } from "lucide-react";
import { del, get, patch, post, inputCls, labelCls } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, errText } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

interface KeyRow { id: number; channel: "whatsapp" | "email"; provider: string; model: string | null; label: string | null; isActive: boolean; sort: number; key: string }
interface Resp { providers: string[]; keys: KeyRow[] }

const QK = ["/api/admin/orgs/llm-keys"];
const CHANNELS = [
  { key: "whatsapp" as const, label: "واتساب", icon: MessageCircle, text: "وكيل الرد على الزبائن، كتابة الحملة الأسبوعية، المتابعات." },
  { key: "email" as const, label: "البريد", icon: Mail, text: "كتابة رسائل البريد والرد عليها وتحليل المستندات." },
];

export function LlmKeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery<Resp>({ queryKey: QK, queryFn: () => get(QK[0]!), enabled: open });
  const [f, setF] = useState({ channel: "whatsapp" as "whatsapp" | "email", provider: "", apiKey: "", model: "", label: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<number, { ok: boolean; text: string }>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: QK });
  const provider = f.provider || q.data?.providers[0] || "";

  const add = async () => {
    setBusy("add");
    try {
      await post(QK[0]!, { ...f, provider });
      toast.success("المفتاح يعمل وحُفظ");
      setF((x) => ({ ...x, apiKey: "", model: "", label: "" }));
      await refresh();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(null); }
  };
  const test = async (k: KeyRow) => {
    setBusy(`t${k.id}`);
    try {
      const r = await post<{ ok: boolean; reply?: string; error?: string }>(`${QK[0]}/${k.id}/test`);
      setTests((t) => ({ ...t, [k.id]: { ok: r.ok, text: r.ok ? "يعمل" : r.error ?? "لم يعمل" } }));
    } catch (e) { setTests((t) => ({ ...t, [k.id]: { ok: false, text: errText(e) } })); }
    finally { setBusy(null); }
  };
  const toggle = async (k: KeyRow, v: boolean) => { try { await patch(`${QK[0]}/${k.id}`, { isActive: v }); await refresh(); } catch (e) { toast.error(errText(e)); } };
  const remove = async (k: KeyRow) => {
    if (!confirm("حذف هذا المفتاح؟")) return;
    try { await del(`${QK[0]}/${k.id}`); await refresh(); } catch (e) { toast.error(errText(e)); }
  };

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} wide title={<span className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" />مفاتيح الذكاء الاصطناعي</span>}
      description="مفاتيح مستقلة لكل قناة، تُجرَّب بالترتيب. بدون مفتاح للقناة يُستخدم المفتاح العام للنظام.">
      {q.isLoading ? <div className="py-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-5">
          {CHANNELS.map((ch) => {
            const keys = (q.data?.keys ?? []).filter((k) => k.channel === ch.key);
            return (
              <section key={ch.key} className="space-y-2">
                <div className="flex items-center gap-2"><ch.icon className="w-4 h-4 text-primary" /><h3 className="font-bold text-sm">{ch.label}</h3><span className="text-xs text-muted-foreground">{ch.text}</span></div>
                {keys.length === 0 ? <div className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2.5">لا مفاتيح لهذه القناة — تعمل على المفتاح العام.</div> : keys.map((k, i) => (
                  <div key={k.id} className="rounded-lg border border-border px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-5 h-5 rounded-full bg-secondary text-[11px] grid place-items-center tabular-nums">{i + 1}</span>
                    <span className="font-semibold">{k.provider}</span>
                    <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">{k.key}</span>
                    {k.model && <span className="text-xs text-muted-foreground" dir="ltr">{k.model}</span>}
                    {k.label && <span className="text-xs rounded-full bg-secondary px-2 py-0.5">{k.label}</span>}
                    {tests[k.id] && <span className={cn("text-xs flex items-center gap-1", tests[k.id]!.ok ? "text-emerald-300" : "text-red-300")}>{tests[k.id]!.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}{tests[k.id]!.text}</span>}
                    <span className="flex-1" />
                    <button onClick={() => test(k)} disabled={!!busy} className="text-xs text-primary flex items-center gap-1 hover:underline">{busy === `t${k.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}جرّب</button>
                    <Switch checked={k.isActive} onCheckedChange={(v) => toggle(k, v)} dir="ltr" />
                    <button onClick={() => remove(k)} className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:text-red-300 hover:bg-secondary/60" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </section>
            );
          })}

          <section className="rounded-xl border border-primary/25 bg-primary/5 p-3 space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-2"><Plus className="w-4 h-4" />مفتاح جديد</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label><span className={labelCls}>القناة</span>
                <select className={inputCls} value={f.channel} onChange={(e) => setF((x) => ({ ...x, channel: e.target.value as "whatsapp" | "email" }))}>{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
              <label><span className={labelCls}>المزوّد</span>
                <select className={inputCls} value={provider} onChange={(e) => setF((x) => ({ ...x, provider: e.target.value }))}>{(q.data?.providers ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              <label className="sm:col-span-2"><span className={labelCls}>المفتاح (API key)</span>
                <input className={cn(inputCls, "font-mono")} dir="ltr" type="password" autoComplete="off" value={f.apiKey} onChange={(e) => setF((x) => ({ ...x, apiKey: e.target.value }))} placeholder="sk-… / gsk_…" /></label>
              <label><span className={labelCls}>النموذج (اختياري)</span>
                <input className={inputCls} dir="ltr" value={f.model} onChange={(e) => setF((x) => ({ ...x, model: e.target.value }))} placeholder="الافتراضي للمزوّد" /></label>
              <label><span className={labelCls}>اسم للتمييز (اختياري)</span>
                <input className={inputCls} value={f.label} maxLength={80} onChange={(e) => setF((x) => ({ ...x, label: e.target.value }))} placeholder="مثال: مفتاح واتساب الأساسي" /></label>
            </div>
            <Btn tone="gold" disabled={busy === "add" || f.apiKey.trim().length < 10 || !provider} onClick={add}>{busy === "add" ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}جرّب المفتاح واحفظه</Btn>
            <p className="text-xs text-muted-foreground leading-relaxed">المفتاح يُجرَّب مع المزوّد قبل الحفظ، ولا يُعرض بعدها إلا آخر أربعة أحرف منه.</p>
          </section>
        </div>
      )}
    </Modal>
  );
}
