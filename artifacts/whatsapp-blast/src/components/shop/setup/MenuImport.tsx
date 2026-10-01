// ── Menu › استيراد ────────────────────────────────────────────────
// Three ways in for a shop that already has a menu somewhere: a sheet, a
// photo of the paper menu, and translating what is there into English.
// Nothing is saved without a preview first: the sheet goes through ?dry=1,
// and the photo comes back as rows the owner edits and ticks.

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, CheckCircle2, Download, FileSpreadsheet, Languages, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { post, upload, useShop, inputCls } from "@/lib/shop-api";
import { Section, btnGhost, btnPrimary, btnQuiet } from "./kit";
import { CATS_KEY, ITEMS_KEY } from "./ItemEditor";

interface Row { category: string | null; name: string; nameEn: string | null; price: number; description: string | null; descriptionEn: string | null; durationMin: number | null }
interface DryResult { dry: boolean; rows: Row[]; skipped: Array<{ row: number; why: string }>; saved: { categories: number; items: number } | null; error?: string }

function RowsTable({ rows, editable, keep, onKeep, onEdit, currency }: {
  rows: Row[]; editable?: boolean; keep?: boolean[]; onKeep?: (i: number, v: boolean) => void; onEdit?: (i: number, r: Row) => void; currency: string;
}) {
  return (
    <div className="rounded-xl border border-card-border overflow-auto max-h-[420px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
          <tr>
            {editable && <th className="w-8 p-2" />}
            <th className="text-start p-2 font-normal">التصنيف</th>
            <th className="text-start p-2 font-normal">الاسم</th>
            <th className="text-start p-2 font-normal hidden sm:table-cell">بالإنجليزي</th>
            <th className="text-start p-2 font-normal w-24">السعر ({currency})</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i} className={cn(editable && keep && !keep[i] && "opacity-40")}>
              {editable && <td className="p-2"><input type="checkbox" className="accent-[hsl(var(--primary))] w-4 h-4" checked={keep?.[i] ?? true} onChange={(e) => onKeep?.(i, e.target.checked)} /></td>}
              {editable ? (
                <>
                  <td className="p-1"><input className={cn(inputCls, "py-1 text-xs")} value={r.category ?? ""} onChange={(e) => onEdit?.(i, { ...r, category: e.target.value || null })} /></td>
                  <td className="p-1"><input className={cn(inputCls, "py-1 text-xs")} value={r.name} onChange={(e) => onEdit?.(i, { ...r, name: e.target.value })} /></td>
                  <td className="p-1 hidden sm:table-cell"><input className={cn(inputCls, "py-1 text-xs")} dir="ltr" value={r.nameEn ?? ""} onChange={(e) => onEdit?.(i, { ...r, nameEn: e.target.value || null })} /></td>
                  <td className="p-1"><input type="number" className={cn(inputCls, "py-1 text-xs tabular-nums")} value={Number.isFinite(r.price) ? r.price : ""} onChange={(e) => onEdit?.(i, { ...r, price: Number(e.target.value) })} /></td>
                </>
              ) : (
                <>
                  <td className="p-2 text-muted-foreground">{r.category ?? "—"}</td>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 hidden sm:table-cell text-muted-foreground" dir="ltr">{r.nameEn ?? ""}</td>
                  <td className="p-2 tabular-nums">{r.price}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MenuImport() {
  const shop = useShop();
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ITEMS_KEY }); qc.invalidateQueries({ queryKey: CATS_KEY }); };
  const cur = shop.org.currency;

  // sheet
  const sheetInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<File | null>(null);
  const [dry, setDry] = useState<DryResult | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const previewSheet = async (f: File) => {
    setSheet(f); setDry(null); setSheetBusy(true);
    try { setDry(await upload<DryResult>("/api/menu/import?dry=1", f)); }
    catch (e) { toast.error((e as Error).message); setSheet(null); }
    finally { setSheetBusy(false); }
  };
  const saveSheet = async () => {
    if (!sheet) return;
    setSheetBusy(true);
    try {
      const r = await upload<DryResult>("/api/menu/import", sheet);
      toast.success(`انضاف ${r.saved?.items ?? r.rows.length} ${shop.vocab.item[0]}${r.saved?.categories ? ` و${r.saved.categories} تصنيف جديد` : ""}`);
      setSheet(null); setDry(null); refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSheetBusy(false); }
  };
  const template = () => {
    const ex = shop.vocab.defaultCategories[0]?.[0] ?? "الرئيسية";
    const csv = "﻿التصنيف,الاسم,الاسم بالإنجليزي,السعر,الوصف\n" + `${ex},${shop.vocab.item[0]} 1,Item 1,25,وصف قصير\n${ex},${shop.vocab.item[0]} 2,Item 2,32,\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "menu-template.csv"; a.click();
  };

  // photo
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRows, setPhotoRows] = useState<Row[] | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const readPhoto = async (f: File) => {
    setPhotoBusy(true); setPhotoErr(null); setPhotoRows(null);
    try {
      const r = await upload<{ rows: Row[]; error: string | null }>("/api/menu/import-photo", f);
      if (r.error && !r.rows.length) setPhotoErr(r.error);
      setPhotoRows(r.rows); setKeep(r.rows.map(() => true));
    } catch (e) { setPhotoErr((e as Error).message); }
    finally { setPhotoBusy(false); }
  };
  const savePhoto = async () => {
    const rows = (photoRows ?? []).filter((r, i) => keep[i] && r.name.trim() && Number.isFinite(r.price));
    setPhotoBusy(true);
    try {
      const r = await post<{ saved: { items: number; categories: number } }>("/api/menu/import-rows", { rows });
      toast.success(`انضاف ${r.saved.items} ${shop.vocab.item[0]}`);
      setPhotoRows(null); refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setPhotoBusy(false); }
  };

  // translate
  const [trBusy, setTrBusy] = useState(false);
  const translate = async () => {
    setTrBusy(true);
    try {
      const r = await post<{ translated: number; error: string | null }>("/api/menu/translate", { onlyMissing: true });
      if (r.error) toast.error(r.error);
      else toast.success(r.translated ? `ترجمنا ${r.translated} ${shop.vocab.item[0]} للإنجليزي — راجعها من المحرر` : "كل شي مترجم من قبل");
      refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setTrBusy(false); }
  };

  const kept = keep.filter(Boolean).length;

  return (
    <div className="space-y-4">
      <Section title="صورة المنيو الورقي" sub="صوّر المنيو (أو ارفع PDF) ونقرأ منه الأسماء والأسعار. تراجعها وتعدّلها قبل ما تنحفظ.">
        <input ref={photoInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readPhoto(f); e.target.value = ""; }} />
        {!photoRows && (
          <button className={cn(btnGhost, "w-full py-8 border-dashed flex-col gap-2")} disabled={photoBusy} onClick={() => photoInput.current?.click()}>
            {photoBusy ? <><Loader2 className="w-6 h-6 animate-spin text-primary" /><span>نقرأ المنيو… قد تاخذ نص دقيقة</span></> : <><Camera className="w-6 h-6 text-primary" /><span>صوّر أو اختر صورة / PDF</span></>}
          </button>
        )}
        {photoErr && <div className="text-sm text-amber-400 mt-3">{photoErr}</div>}
        {photoRows && photoRows.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm">لقينا <b>{photoRows.length}</b> — شيل العلامة عن اللي ما تبيه، وصحّح أي اسم أو سعر.</div>
            <RowsTable rows={photoRows} editable keep={keep} currency={cur} onKeep={(i, v) => setKeep(keep.map((k, j) => (j === i ? v : k)))} onEdit={(i, r) => setPhotoRows(photoRows.map((x, j) => (j === i ? r : x)))} />
            <div className="flex justify-end gap-2">
              <button className={btnQuiet} onClick={() => setPhotoRows(null)}>إلغاء</button>
              <button className={btnPrimary} disabled={!kept || photoBusy} onClick={savePhoto}>{photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}احفظ {kept}</button>
            </div>
          </div>
        )}
      </Section>

      <Section title="ملف Excel أو CSV" sub="صف عناوين فيه «الاسم» و«السعر» على الأقل، و«التصنيف» و«الوصف» والإنجليزي لو عندك. كل ورقة باسم تصنيف تنفع بعد."
        actions={<button className={cn(btnQuiet, "text-xs")} onClick={template}><Download className="w-3.5 h-3.5" />نموذج جاهز</button>}>
        <input ref={sheetInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) previewSheet(f); e.target.value = ""; }} />
        {!dry && (
          <button className={cn(btnGhost, "w-full py-8 border-dashed flex-col gap-2")} disabled={sheetBusy} onClick={() => sheetInput.current?.click()}>
            {sheetBusy ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : <FileSpreadsheet className="w-6 h-6 text-primary" />}
            <span>{sheetBusy ? "نقرأ الملف…" : "اختر الملف"}</span>
          </button>
        )}
        {dry && (
          <div className="space-y-3">
            {dry.error ? <div className="text-sm text-amber-400">{dry.error}</div> : (
              <div className="text-sm"><span className="font-mono text-muted-foreground" dir="ltr">{sheet?.name}</span> — <b>{dry.rows.length}</b> صف جاهز{dry.skipped.length ? `، و${dry.skipped.length} انتركت` : ""}.</div>
            )}
            {dry.rows.length > 0 && <RowsTable rows={dry.rows} currency={cur} />}
            {dry.skipped.length > 0 && (
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">الصفوف اللي انتركت</summary>
                <ul className="mt-2 space-y-0.5">{dry.skipped.slice(0, 50).map((s) => <li key={s.row}>صف {s.row}: {s.why}</li>)}</ul>
              </details>
            )}
            <div className="flex justify-end gap-2">
              <button className={btnQuiet} onClick={() => { setDry(null); setSheet(null); }}>إلغاء</button>
              <button className={btnPrimary} disabled={!dry.rows.length || sheetBusy} onClick={saveSheet}>{sheetBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}احفظ {dry.rows.length}</button>
            </div>
          </div>
        )}
      </Section>

      <Section title="ترجم للإنجليزية" sub="نترجم الأسماء والوصف اللي ما لها إنجليزي. اللي كتبته بنفسك ما نلمسه.">
        <button className={btnGhost} disabled={trBusy} onClick={translate}>{trBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}ترجم للإنجليزية</button>
      </Section>
    </div>
  );
}
