// ── /gifts — gift cards ───────────────────────────────────────────
// Sell one (it goes to the recipient's WhatsApp at once), take an amount off
// one at the counter, and see what has been sold and what is still owed.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Copy, Gift, Loader2, Plus, Search, Send, XCircle } from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { ApiError, get, patch, post, useShop, inputCls, labelCls } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, Stat, errText, n, shortDate } from "@/components/shop/ops/kit";
import { Modal } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

interface Card {
  id: number; code: string; amount: number; balance: number; status: "active" | "used" | "void"; problem: string | null;
  recipientName: string | null; recipientPhone: string | null; buyerName: string | null; message: string | null;
  expiresAt: string | null; createdBy: string | null; createdAt: string; url: string;
  uses?: Array<{ id: number; amount: string; note: string | null; byWho: string | null; createdAt: string; orderId: number | null }>;
}
interface Resp { allowed: boolean; planName: string; onMenu: boolean; stats: { sold: number; outstanding: number; redeemed: number; count: number }; cards: Card[] }

export default function Gifts() {
  const shop = useShop();
  const { user } = useAuth();
  const role = user?.role ?? shop.role;
  const qc = useQueryClient();
  const money = (v: number) => formatMoney(v, shop.org.currency);
  const q = useQuery<Resp>({ queryKey: ["/api/gifts"], queryFn: () => get("/api/gifts"), enabled: role !== "staff", retry: (_, e) => !(e instanceof ApiError && e.status === 403) });
  const [creating, setCreating] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/gifts"] });

  const toggleMenu = async (v: boolean) => { try { await patch("/api/gifts/menu", { onMenu: v }); toast.success(v ? "ظهر «أهدِ بطاقة» في المنيو" : "أُخفي من المنيو"); refresh(); } catch (e) { toast.error(errText(e)); } };
  const voidCard = async (c: Card) => { if (!confirm(`إلغاء البطاقة ${c.code}؟ لن يمكن استخدامها بعدها.`)) return; try { await post(`/api/gifts/${c.id}/void`); refresh(); } catch (e) { toast.error(errText(e)); } };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold flex items-center gap-2"><Gift className="w-5 h-5 text-primary" />بطاقات الهدايا</h1>
          <p className="text-sm text-muted-foreground mt-0.5">تبيعها عندك، وتصل للمُهدى إليه على واتساب فوراً. يصرفها عند الكاشير أو بكتابة رمزها في السلة.</p>
        </div>
        {q.data && <Btn tone="gold" disabled={!q.data.allowed} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />بطاقة جديدة</Btn>}
      </div>

      {q.data && !q.data.allowed && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300" />بطاقات الهدايا من خطة «أعمال» — خطتك الحالية {q.data.planName}. تقدر تصرف البطاقات الموجودة.
        </div>
      )}

      <Redeem money={money} onDone={refresh} />

      {q.data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="مبيعات البطاقات" value={money(q.data.stats.sold)} hint={`${n(q.data.stats.count)} بطاقة`} tone="gold" />
            <Stat label="صُرف منها" value={money(q.data.stats.redeemed)} />
            <Stat label="رصيد لم يُصرف بعد" value={money(q.data.stats.outstanding)} />
          </div>
          {role === "owner" && (
            <label className="rounded-xl border border-card-border bg-card px-4 py-3 flex items-center gap-3 text-sm">
              <span className="flex-1"><span className="font-semibold">«أهدِ بطاقة» في المنيو</span><span className="block text-xs text-muted-foreground mt-0.5">زر في المنيو يفتح محادثة واتساب معك جاهزة: القيمة، لمن، والرسالة. تستلم المبلغ وتصدر البطاقة من هنا.</span></span>
              <Switch checked={q.data.onMenu} onCheckedChange={toggleMenu} dir="ltr" />
            </label>
          )}
          <div className="rounded-xl border border-card-border bg-card divide-y divide-border/60">
            {q.data.cards.length === 0 ? <Empty title="لا بطاقات بعد" icon={<Gift />}>في المواسم (العيد، رمضان، يوم الأم) بطاقة الهدية تبيع وحدها — وتجيب لك زبوناً جديداً كل مرة.</Empty>
              : q.data.cards.map((c) => (
                <div key={c.id} className="p-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <span className="font-mono text-xs rounded bg-secondary px-1.5 py-0.5" dir="ltr">{c.code}</span>
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-semibold">{c.recipientName || "بدون اسم"}{c.buyerName ? <span className="text-muted-foreground font-normal"> · من {c.buyerName}</span> : null}</div>
                    <div className="text-xs text-muted-foreground">{shortDate(c.createdAt, shop.org.timezone)}{c.createdBy ? ` · ${c.createdBy}` : ""}{c.recipientPhone ? <span dir="ltr"> · +{c.recipientPhone}</span> : null}</div>
                  </div>
                  <div className="text-left tabular-nums"><span className="font-bold">{money(c.balance)}</span><span className="text-xs text-muted-foreground"> / {money(c.amount)}</span></div>
                  <span className={cn("text-[11px] rounded-full px-2 py-0.5", c.problem ? "bg-secondary text-muted-foreground" : "bg-emerald-500/15 text-emerald-300")}>{c.problem ?? "فعّالة"}</span>
                  <button className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60" title="نسخ رابط البطاقة" onClick={() => { void navigator.clipboard.writeText(c.url); toast.success("نُسخ الرابط"); }}><Copy className="w-4 h-4" /></button>
                  {role === "owner" && c.status !== "void" && <button className="w-8 h-8 grid place-items-center rounded-lg text-muted-foreground hover:text-red-300 hover:bg-secondary/60" title="إلغاء" onClick={() => voidCard(c)}><XCircle className="w-4 h-4" /></button>}
                </div>
              ))}
          </div>
        </>
      )}
      <CreateDialog open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} currency={shop.org.currency} />
    </div>
  );
}

function Redeem({ money, onDone }: { money: (v: number) => string; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const find = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try { const c = await get<Card>(`/api/gifts/code/${encodeURIComponent(code.trim())}`); setCard(c); setAmount(""); }
    catch (e) { setCard(null); toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  const redeem = async () => {
    if (!card) return;
    setBusy(true);
    try { const c = await post<Card>(`/api/gifts/${card.id}/redeem`, { amount: Number(amount) }); setCard({ ...card, ...c }); setAmount(""); toast.success(`خُصم ${money(Number(amount))} — الباقي ${money(c.balance)}`); onDone(); }
    catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
      <h2 className="font-bold text-sm flex items-center gap-2"><Search className="w-4 h-4" />صرف بطاقة عند الكاشير</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void find(); }}>
        <input className={cn(inputCls, "font-mono uppercase")} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="GXXXXXX" />
        <Btn tone="plain" type="submit" disabled={busy || !code.trim()}>{busy && !card ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}ابحث</Btn>
      </form>
      {card && (
        <div className="rounded-lg bg-card border border-border p-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{card.recipientName || "بطاقة"}</span>
            <span className="tabular-nums">الرصيد <b>{money(card.balance)}</b> من {money(card.amount)}</span>
            {card.problem && <span className="text-amber-300">— {card.problem}</span>}
          </div>
          {!card.problem && (
            <div className="flex gap-2">
              <input className={cn(inputCls, "tabular-nums")} type="number" min={1} max={card.balance} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="المبلغ" />
              <Btn tone="gold" disabled={busy || !(Number(amount) > 0)} onClick={redeem}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}اخصم</Btn>
              <Btn tone="ghost" onClick={() => setAmount(String(card.balance))}>كامل الرصيد</Btn>
            </div>
          )}
          {!!card.uses?.length && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {card.uses.slice(0, 5).map((u) => <li key={u.id}>{Number(u.amount) < 0 ? "استرجاع" : "صُرف"} {money(Math.abs(Number(u.amount)))} · {u.note ?? ""}{u.byWho ? ` · ${u.byWho}` : ""}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function CreateDialog({ open, onClose, onDone, currency }: { open: boolean; onClose: () => void; onDone: () => void; currency: string }) {
  const empty = { amount: "100", recipientName: "", recipientPhone: "", buyerName: "", message: "", months: "12" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      const c = await post<Card>("/api/gifts", { ...f, amount: Number(f.amount), months: Number(f.months) });
      toast.success(f.recipientPhone ? `أُصدرت البطاقة ${c.code} وتُرسل على واتساب الآن` : `أُصدرت البطاقة ${c.code} — انسخ رابطها وأرسله`);
      setF(empty); onDone();
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="بطاقة هدية جديدة" description="بعد استلام المبلغ من المشتري. تصل للمُهدى إليه على واتساب برسالة المشتري ورابط البطاقة.">
      <div className="space-y-3">
        <div>
          <span className={labelCls}>القيمة ({currency})</span>
          <div className="flex gap-1.5 mb-2">{["50", "100", "200", "500"].map((v) => <button key={v} type="button" onClick={() => setF((x) => ({ ...x, amount: v }))} className={cn("flex-1 h-9 rounded-lg text-sm tabular-nums", f.amount === v ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary")}>{v}</button>)}</div>
          <input className={cn(inputCls, "tabular-nums")} type="number" min={1} value={f.amount} onChange={set("amount")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label><span className={labelCls}>اسم المُهدى إليه</span><input className={inputCls} value={f.recipientName} onChange={set("recipientName")} /></label>
          <label><span className={labelCls}>واتسابه</span><input className={cn(inputCls, "tabular-nums")} dir="ltr" inputMode="tel" value={f.recipientPhone} onChange={set("recipientPhone")} placeholder="05xxxxxxxx" /></label>
        </div>
        <label className="block"><span className={labelCls}>من (اسم المشتري)</span><input className={inputCls} value={f.buyerName} onChange={set("buyerName")} /></label>
        <label className="block"><span className={labelCls}>رسالة المشتري (اختياري)</span><textarea className={inputCls} rows={2} maxLength={300} value={f.message} onChange={set("message")} placeholder="كل عام وأنت بخير 🌙" /></label>
        <label className="block"><span className={labelCls}>صالحة لمدة</span>
          <select className={inputCls} value={f.months} onChange={set("months")}>{[["3", "3 أشهر"], ["6", "6 أشهر"], ["12", "سنة"], ["24", "سنتين"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div className="flex gap-2 pt-1">
          <Btn tone="gold" disabled={busy || !(Number(f.amount) > 0)} onClick={save}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}أصدر وأرسل</Btn>
          <Btn tone="ghost" onClick={onClose}>إلغاء</Btn>
        </div>
      </div>
    </Modal>
  );
}
