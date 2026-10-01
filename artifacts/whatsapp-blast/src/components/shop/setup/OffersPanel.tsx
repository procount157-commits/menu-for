// ── Menu › العروض ─────────────────────────────────────────────────
// Banners at the top of the menu and on the ticket page while a customer
// waits. An offer can point at one item and can run between two dates.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarRange, Loader2, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { del, get, patch, post, useShop, inputCls } from "@/lib/shop-api";
import { Empty, Field, ImageDrop, Modal, Skel, Toggle, btnPrimary, btnQuiet, iconBtn } from "./kit";
import { mediaUrl, type MenuItem } from "./ItemEditor";

interface Offer {
  id: number; title: string; titleEn: string | null; body: string | null; bodyEn: string | null; imageUrl: string | null;
  branchId: number | null; itemId: number | null; startsAt: string | null; endsAt: string | null; isActive: boolean; sort: number;
}
const KEY = ["/api/menu/offers"];

// datetime-local wants local time without a zone; the API takes ISO.
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ar-AE-u-nu-latn", { day: "numeric", month: "short" }) : null);

function status(o: Offer): { label: string; tone: string } {
  const now = Date.now();
  if (!o.isActive) return { label: "موقوف", tone: "bg-muted text-muted-foreground" };
  if (o.startsAt && new Date(o.startsAt).getTime() > now) return { label: "مجدول", tone: "bg-sky-500/15 text-sky-300" };
  if (o.endsAt && new Date(o.endsAt).getTime() < now) return { label: "انتهى", tone: "bg-muted text-muted-foreground" };
  return { label: "شغّال", tone: "bg-emerald-500/15 text-emerald-300" };
}

export default function OffersPanel({ items }: { items: MenuItem[] }) {
  const shop = useShop();
  const qc = useQueryClient();
  const q = useQuery<Offer[]>({ queryKey: KEY, queryFn: () => get("/api/menu/offers") });
  const [edit, setEdit] = useState<Partial<Offer> | null>(null);

  const save = useMutation({
    mutationFn: (o: Partial<Offer>) => (o.id ? patch(`/api/menu/offers/${o.id}`, o) : post("/api/menu/offers", o)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); setEdit(null); toast.success("انحفظ العرض"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => patch(`/api/menu/offers/${id}`, { isActive }),
    onMutate: async ({ id, isActive }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Offer[]>(KEY);
      qc.setQueryData<Offer[]>(KEY, (l) => l?.map((o) => (o.id === id ? { ...o, isActive } : o)));
      return { prev };
    },
    onError: (e, _v, ctx) => { qc.setQueryData(KEY, ctx?.prev); toast.error((e as Error).message); },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/api/menu/offers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); toast.success("انحذف العرض"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const itemName = (id: number | null) => (id ? items.find((i) => i.id === id)?.name : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground max-w-xl">العروض تطلع فوق المنيو وفي صفحة التذكرة وهو ينتظر — أحسن مكان تبيع فيه شي إضافي.</p>
        <button className={btnPrimary} onClick={() => setEdit({ title: "", isActive: true, branchId: null, itemId: null })}><Plus className="w-4 h-4" />عرض جديد</button>
      </div>
      {q.isLoading && <div className="grid sm:grid-cols-2 gap-3">{[0, 1].map((i) => <Skel key={i} className="h-40 rounded-2xl" />)}</div>}
      {q.data && !q.data.length && (
        <Empty icon={<Megaphone className="w-5 h-5" />} title="ما فيه عروض" sub="مثلاً: «قهوة مجانية مع أي حلى بعد 10 م» أو «صينية العيد — احجزها قبل الخميس»."
          action={<button className={btnPrimary} onClick={() => setEdit({ title: "", isActive: true, branchId: null, itemId: null })}><Plus className="w-4 h-4" />أضف أول عرض</button>} />
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {q.data?.map((o) => {
          const s = status(o);
          return (
            <div key={o.id} className="bg-card border border-card-border rounded-2xl overflow-hidden flex flex-col">
              {o.imageUrl ? <img src={mediaUrl(o.imageUrl)!} alt="" className="w-full aspect-[5/2] object-cover" /> : <div className="w-full aspect-[5/2] bg-gradient-to-l from-primary/25 to-primary/5 flex items-center justify-center"><Megaphone className="w-6 h-6 text-primary/60" /></div>}
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{o.title}</div>
                    {o.body && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{o.body}</div>}
                  </div>
                  <span className={cn("text-[11px] px-2 py-0.5 rounded-full shrink-0", s.tone)}>{s.label}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {itemName(o.itemId) && <span>← {itemName(o.itemId)}</span>}
                  {(o.startsAt || o.endsAt) && <span className="flex items-center gap-1"><CalendarRange className="w-3 h-3" />{fmt(o.startsAt) ?? "الحين"} – {fmt(o.endsAt) ?? "مفتوح"}</span>}
                  {o.branchId && <span>{shop.branches.find((b) => b.id === o.branchId)?.name}</span>}
                </div>
                <div className="flex items-center gap-1 mt-auto pt-1">
                  <Toggle checked={o.isActive} onChange={(isActive) => toggle.mutate({ id: o.id, isActive })} label="مفعّل" />
                  <span className="flex-1" />
                  <button className={iconBtn} onClick={() => setEdit(o)} aria-label="تعديل"><Pencil className="w-4 h-4" /></button>
                  <button className={iconBtn} onClick={() => confirm(`حذف «${o.title}»؟`) && remove.mutate(o.id)} aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "تعديل العرض" : "عرض جديد"}
        footer={<>
          <button className={btnQuiet} onClick={() => setEdit(null)}>إلغاء</button>
          <button className={btnPrimary} disabled={!edit?.title?.trim() || save.isPending} onClick={() => edit && save.mutate(edit)}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}احفظ</button>
        </>}>
        {edit && (
          <div className="space-y-4">
            <ImageDrop kind="offer" value={mediaUrl(edit.imageUrl)} className="w-full aspect-[5/2]" label="صورة العرض (عريضة)"
              onChange={(img) => setEdit((e) => e && { ...e, imageUrl: img ? (img.md ?? img.url) : null })} />
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="العنوان"><input autoFocus className={inputCls} value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="خصم 20% على الصواني" /></Field>
              <Field label="بالإنجليزي"><input className={inputCls} dir="ltr" value={edit.titleEn ?? ""} onChange={(e) => setEdit({ ...edit, titleEn: e.target.value })} /></Field>
              <Field label="التفاصيل"><textarea className={cn(inputCls, "min-h-[64px]")} value={edit.body ?? ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
              <Field label="بالإنجليزي"><textarea className={cn(inputCls, "min-h-[64px]")} dir="ltr" value={edit.bodyEn ?? ""} onChange={(e) => setEdit({ ...edit, bodyEn: e.target.value })} /></Field>
            </div>
            <Field label={`يفتح ${shop.vocab.item[0]}`} hint="اختياري — لما يضغط الزبون على العرض">
              <select className={inputCls} value={edit.itemId ?? ""} onChange={(e) => setEdit({ ...edit, itemId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">بدون</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            {shop.branches.length > 1 && (
              <Field label="الفرع">
                <select className={inputCls} value={edit.branchId ?? ""} onChange={(e) => setEdit({ ...edit, branchId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">كل الفروع</option>
                  {shop.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="يبدأ" hint="فاضي = من الحين"><input type="datetime-local" className={inputCls} value={toLocal(edit.startsAt ?? null)} onChange={(e) => setEdit({ ...edit, startsAt: fromLocal(e.target.value) })} /></Field>
              <Field label="ينتهي" hint="فاضي = بدون نهاية"><input type="datetime-local" className={inputCls} value={toLocal(edit.endsAt ?? null)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocal(e.target.value) })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
