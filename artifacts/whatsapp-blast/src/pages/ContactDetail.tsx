import { useState, useRef, useCallback } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetContactGroup,
  useAddNumbers,
  getGetContactGroupQueryKey,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Upload, ClipboardPaste, Users, Copy,
  Loader2, CheckCircle2, Layers, ArrowLeft, UserCheck, PhoneOff,
  FileSpreadsheet, AlertTriangle, Info, Download,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface ImportResult {
  added: number;
  duplicates: number;
  invalid: number;
  skippedLandline?: number;
  total: number;
  autoSplit: boolean;
  groups: { id: number; name: string; count: number }[];
}

// ── Country codes for mobile detection ───────────────────────────
const COUNTRY_CODES = [971, 966, 974, 965, 973, 968, 967, 962, 963, 964, 961, 249, 212, 213, 216, 20];

function cleanPhone(raw: string): string {
  let p = raw.replace(/[\s\-\+\(\)\.]/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  return p;
}

/**
 * Smart normalization: converts local/short numbers to international format.
 * E.g. "0588899999" → "971588899999"  (UAE default)
 *       "588899999"  → "971588899999"  (9-digit mobile without CC)
 */
function normalizePhone(raw: string, defaultCC = "971"): string {
  let p = cleanPhone(raw);
  // Already has a known country code prefix → keep as-is
  for (const cc of COUNTRY_CODES) {
    if (p.startsWith(String(cc))) return p;
  }
  // Starts with 0 followed by 8-9 digits → remove 0, prepend default CC
  if (/^0\d{8,10}$/.test(p)) return defaultCC + p.slice(1);
  // 9-digit starting with 5/6/7 (typical Gulf mobile without CC)
  if (/^[5-7]\d{8}$/.test(p)) return defaultCC + p;
  // 8-digit (Bahrain/Kuwait short format)
  if (/^[3-9]\d{7}$/.test(p)) return defaultCC + p;
  return p;
}

function isMobile(raw: string): boolean {
  const phone = normalizePhone(raw);
  if (!/^\d{7,15}$/.test(phone)) return false;
  for (const cc of COUNTRY_CODES) {
    const ccStr = String(cc);
    if (phone.startsWith(ccStr)) {
      const local = phone.slice(ccStr.length);
      return /^[5671]/.test(local) && local.length >= 7;
    }
  }
  return phone.length >= 10;
}

// ── Smart Excel/CSV row parser ────────────────────────────────────
type Entry = { name: string; phone: string };

const NAME_HEADERS  = /^(name|اسم|الاسم|اسم\s*الشركة|اسم\s*المقاول|اسم\s*العميل|اسم\s*المؤسسة|nom|nombre|isim|ad|client|عميل|العميل|company|شركة|مؤسسة|مقاول|establishment|business|firm|organization)$/i;
const PHONE_HEADERS = /^(phone|mobile|رقم|رقم\s*الجوال|رقم\s*الهاتف|رقم\s*التواصل|هاتف|جوال|موبايل|tel|número|numéro|gsm|whatsapp|واتساب)$/i;

function parseExcelSheet(rows: any[][]): { entries: Entry[]; hasNames: boolean } {
  if (!rows.length) return { entries: [], hasNames: false };

  const firstRow = rows[0].map((c: any) => String(c ?? "").trim());
  let nameCol = -1, phoneCol = -1;

  firstRow.forEach((cell, idx) => {
    if (NAME_HEADERS.test(cell))  nameCol  = idx;
    if (PHONE_HEADERS.test(cell)) phoneCol = idx;
  });

  if (phoneCol >= 0) {
    const entries = rows.slice(1)
      .map((row) => ({
        name:  nameCol >= 0 ? String(row[nameCol]  ?? "").trim() : "",
        phone: String(row[phoneCol] ?? "").trim(),
      }))
      .filter((e) => e.phone.length > 0);
    return { entries, hasNames: nameCol >= 0 };
  }

  const sampleRow = rows[1] ?? rows[0];
  const col0 = String(sampleRow?.[0] ?? "").trim();
  const col1 = String(sampleRow?.[1] ?? "").trim();

  const col0IsText  = col0.length > 0 && isNaN(Number(col0.replace(/[\s\-\+\(\)\.]/g, "")));
  const col1IsPhone = /^\+?[\d][\d\s\-\+\(\)\.]{5,}$/.test(col1);

  if (col0IsText && col1IsPhone) {
    const startIdx = (PHONE_HEADERS.test(firstRow[1] ?? "") || NAME_HEADERS.test(firstRow[0] ?? "")) ? 1 : 0;
    const entries = rows.slice(startIdx)
      .map((row) => ({
        name:  String(row[0] ?? "").trim(),
        phone: String(row[1] ?? "").trim(),
      }))
      .filter((e) => e.phone.length > 0);
    return { entries, hasNames: true };
  }

  // Fallback: every non-empty cell is a phone
  const entries = rows.flat()
    .map((v: any) => String(v ?? "").trim())
    .filter((v) => v.length > 0 && v !== "undefined" && /\d/.test(v))
    .map((phone) => ({ name: "", phone }));
  return { entries, hasNames: false };
}

/**
 * Smart paste parser — detects "Name,Phone" format automatically.
 * Also handles tab-separated (Excel paste), comma, semicolon.
 */
function parsePasteText(text: string): { entries: Entry[]; hasNames: boolean } {
  const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  let hasNames = false;
  const entries: Entry[] = lines.map((line) => {
    // Try tab-separated
    const tabParts = line.split("\t");
    if (tabParts.length >= 2) {
      const last = tabParts[tabParts.length - 1].trim();
      if (/^\+?[\d][\d\s\-\(\)\.]{5,}$/.test(last)) {
        hasNames = true;
        return { name: tabParts.slice(0, -1).join(" ").trim(), phone: last };
      }
    }
    // Try comma or semicolon
    const sep = line.includes(";") ? ";" : ",";
    const parts = line.split(sep);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1].trim();
      if (/^\+?[\d][\d\s\-\(\)\.]{5,}$/.test(last)) {
        hasNames = true;
        return { name: parts.slice(0, -1).join(sep).trim(), phone: last };
      }
      // First part might be the phone (Ahmed,0588899999 — but phone first: 0588,Ahmed unlikely)
    }
    // Plain phone
    return { name: "", phone: line };
  });
  return { entries, hasNames };
}

// ── Preview table before import ───────────────────────────────────
function ImportPreview({ entries, mobileOnly, onConfirm, onCancel, isPending }: {
  entries: Entry[];
  mobileOnly: boolean;
  onConfirm: (entries: Entry[]) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const normalized = entries.map((e) => ({ ...e, phone: normalizePhone(e.phone) }));
  const valid   = mobileOnly ? normalized.filter((e) => isMobile(e.phone)) : normalized.filter((e) => /^\d{7,15}$/.test(e.phone));
  const skipped = normalized.length - valid.length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-green-400">{valid.length.toLocaleString("ar-SA")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">سيتم استيراده</p>
        </div>
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-orange-400">{skipped.toLocaleString("ar-SA")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{mobileOnly ? "أرضي / غير صالح" : "غير صالح"}</p>
        </div>
        <div className="bg-muted/30 rounded-xl p-3 text-center">
          <p className="text-xl font-bold">{normalized.length.toLocaleString("ar-SA")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">الإجمالي</p>
        </div>
      </div>

      {/* Preview rows */}
      <div className="border border-card-border rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-muted/20 border-b border-card-border flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">معاينة أول 5 سجلات</span>
        </div>
        <table className="w-full">
          <tbody className="divide-y divide-card-border">
            {valid.slice(0, 5).map((e, i) => (
              <tr key={i} className="hover:bg-muted/10">
                {e.name && <td className="px-4 py-2 text-sm text-foreground">{e.name}</td>}
                <td className="px-4 py-2 text-sm font-mono text-primary" dir="ltr">{e.phone}</td>
                <td className="px-4 py-2">
                  <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded-full">✓</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {valid.length > 5 && (
          <div className="px-4 py-2 text-xs text-center text-muted-foreground border-t border-card-border">
            + {(valid.length - 5).toLocaleString("ar-SA")} سجل آخر
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={onCancel} disabled={isPending}
          className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors">
          إلغاء
        </button>
        <button onClick={() => onConfirm(valid)} disabled={isPending || valid.length === 0}
          className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
          {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الاستيراد...</> : `استيراد ${valid.length.toLocaleString("ar-SA")} رقم`}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function ContactDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: group, isLoading } = useGetContactGroup(id, { query: { enabled: !!id } as any });

  const [pasteText, setPasteText]       = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [tab, setTab]                   = useState<"paste" | "excel">("paste");
  const [mobileOnly, setMobileOnly]     = useState(true);
  const [dragging, setDragging]         = useState(false);

  // Preview state before confirming import
  const [previewEntries, setPreviewEntries] = useState<Entry[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addMutation = useAddNumbers({
    mutation: {
      onSuccess: (result: any) => {
        const r = result as ImportResult;
        setImportResult(r);
        setPasteText("");
        setPreviewEntries(null);

        if (r.autoSplit) {
          toast.success(`تم التقسيم إلى ${r.groups.length} قائمة — ${r.added.toLocaleString("ar-SA")} رقم`);
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        } else {
          let msg = `تمت الإضافة: ${r.added} رقم جديد`;
          if (r.skippedLandline) msg += ` · تجاهل ${r.skippedLandline} أرضي`;
          toast.success(msg);
        }
        queryClient.invalidateQueries({ queryKey: getGetContactGroupQueryKey(id) });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || "حدث خطأ أثناء الاستيراد";
        toast.error(msg);
      },
    },
  });

  // ── Confirm import (after preview) ────────────────────────────

  const doImport = (entries: Entry[]) => {
    addMutation.mutate({
      id,
      data: { contacts: entries, mobileOnly: false } as any, // already filtered in preview
    });
  };

  // ── Paste tab ─────────────────────────────────────────────────

  const handlePastePreview = () => {
    if (!pasteText.trim()) return;
    const { entries } = parsePasteText(pasteText);
    // Normalize all phones
    const normalized = entries.map((e) => ({ ...e, phone: normalizePhone(e.phone) }));
    setPreviewEntries(normalized);
    setImportResult(null);
  };

  // ── Excel/CSV processing ───────────────────────────────────────

  const processExcelFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data     = evt.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];
        const rows     = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 }) as any[][];
        const { entries, hasNames } = parseExcelSheet(rows);

        if (!entries.length) { toast.error("لم يُعثر على أرقام في الملف"); return; }

        // Normalize phones
        const normalized = entries.map((e) => ({ ...e, phone: normalizePhone(e.phone) }));
        setPreviewEntries(normalized);
        setImportResult(null);

        toast.info(
          hasNames
            ? `جاري معالجة ${normalized.length.toLocaleString("ar-SA")} سجل (اسم + رقم)...`
            : `تم اكتشاف ${normalized.length.toLocaleString("ar-SA")} رقم — راجع المعاينة`
        );
      } catch {
        toast.error("خطأ في قراءة الملف. تأكد أنه ملف Excel أو CSV صالح");
      }
    };
    reader.readAsBinaryString(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processExcelFile(file);
  }, [processExcelFile]);

  // ── Paste live stats ──────────────────────────────────────────

  const pasteLines   = pasteText.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean);
  const pasteMobiles = mobileOnly ? pasteLines.filter((l) => isMobile(l)).length : pasteLines.length;
  const pasteSkipped = pasteLines.length - pasteMobiles;

  const inputCls =
    "w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!group) {
    return <div className="p-6 text-center text-muted-foreground">القائمة غير موجودة</div>;
  }

  const hasNames = group.contacts?.some((c: any) => c.name);

  // ── Excel Export (server-side) ─────────────────────────────────
  // We hit /api/contacts/:id/export which fetches from DB and streams
  // the Excel file — no dependency on client-side cache state.
  const exportToExcel = () => {
    if (!group.count) { toast.error("لا توجد أرقام للتصدير"); return; }
    window.open(`/api/contacts/${id}/export`, "_blank");
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/contacts" className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
          <ArrowRight className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{group.name}</h1>
          {group.description && <p className="text-sm text-muted-foreground mt-0.5">{group.description}</p>}
        </div>
        <div className="mr-auto flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm">
          <Users className="w-4 h-4" />
          <span className="font-medium">{group.count.toLocaleString("ar-SA")} رقم</span>
        </div>
      </div>

      {/* Import Section */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-card-border">
          {(["paste", "excel"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setImportResult(null); setPreviewEntries(null); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
                tab === t ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
              )}>
              {t === "paste" ? <><ClipboardPaste className="w-4 h-4" /> لصق وكتابة</> : <><FileSpreadsheet className="w-4 h-4" /> Excel / CSV</>}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* Mobile-only toggle */}
          <button onClick={() => setMobileOnly((v) => !v)}
            className={cn(
              "mb-4 w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors",
              mobileOnly ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/30 border-border text-muted-foreground"
            )}>
            <div className="flex items-center gap-2">
              {mobileOnly ? <UserCheck className="w-4 h-4" /> : <PhoneOff className="w-4 h-4" />}
              <span className="font-medium">
                {mobileOnly ? "تجاهل الأرقام الأرضية (موصى به)" : "استيراد الكل (موبايل + أرضي)"}
              </span>
            </div>
            <div className={cn("w-9 h-5 rounded-full transition-colors relative", mobileOnly ? "bg-primary" : "bg-muted")}>
              <div className={cn("absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all", mobileOnly ? "right-0.5" : "left-0.5")} />
            </div>
          </button>

          {/* ── Preview state ── */}
          {previewEntries !== null ? (
            <ImportPreview
              entries={previewEntries}
              mobileOnly={mobileOnly}
              onConfirm={doImport}
              onCancel={() => setPreviewEntries(null)}
              isPending={addMutation.isPending}
            />
          ) : tab === "paste" ? (
            /* ── Paste tab ── */
            <div className="space-y-3">
              <div className="px-3 py-2 bg-muted/30 rounded-lg text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">تنسيقات مدعومة:</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[
                    { label: "رقم فقط",      ex: "971588123456" },
                    { label: "محلي (يُحوّل)", ex: "0588123456" },
                    { label: "اسم + رقم",    ex: "أحمد،971588123456" },
                    { label: "CSV",          ex: "Ahmed,0588123456" },
                  ].map(({ label, ex }) => (
                    <div key={label} className="bg-card border border-card-border rounded-lg px-2.5 py-1.5">
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p dir="ltr" className="font-mono text-[10px] text-foreground mt-0.5">{ex}</p>
                    </div>
                  ))}
                </div>
              </div>

              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                placeholder={"971501234567\nأحمد,0551234567\nSarah,0521234567"}
                rows={7} dir="ltr" className={inputCls + " resize-none font-mono"} />

              {/* Live stats */}
              {pasteText.trim() && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-400 font-medium">✓ {pasteMobiles.toLocaleString("ar-SA")} رقم صالح</span>
                  {mobileOnly && pasteSkipped > 0 && (
                    <span className="text-orange-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {pasteSkipped} سيُتجاهل
                    </span>
                  )}
                </div>
              )}

              <button onClick={handlePastePreview} disabled={!pasteText.trim() || addMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                <Copy className="w-4 h-4" />
                معاينة قبل الاستيراد
              </button>
            </div>
          ) : (
            /* ── Excel tab ── */
            <div className="space-y-3">
              {/* Format hint */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-1">
                  <p className="text-muted-foreground font-medium">عمود واحد</p>
                  <p dir="ltr" className="font-mono text-foreground/80">971501234567</p>
                  <p dir="ltr" className="font-mono text-foreground/80">0551234567 ← يُحوّل تلقائياً</p>
                </div>
                <div className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5 space-y-1">
                  <p className="text-primary font-medium">عمودين (اسم + رقم) ✓</p>
                  <p dir="ltr" className="font-mono text-foreground/80">Ahmed | 971501234567</p>
                  <p dir="ltr" className="font-mono text-foreground/80">Sara  | 0551234567</p>
                </div>
              </div>

              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processExcelFile(f); e.target.value = ""; }}
                className="hidden" />

              {/* Drag-and-drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 w-full px-4 py-12 border-2 border-dashed rounded-xl cursor-pointer transition-all",
                  dragging
                    ? "border-primary bg-primary/10 scale-[1.01]"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                )}
              >
                {addMutation.isPending ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-sm text-primary font-medium">جاري المعالجة...</span>
                  </div>
                ) : dragging ? (
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <FileSpreadsheet className="w-10 h-10" />
                    <span className="text-sm font-semibold">أفلت الملف هنا</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet className="w-10 h-10" />
                    <span className="text-sm font-medium">اضغط أو اسحب ملف Excel / CSV</span>
                    <span className="text-xs opacity-60">xlsx · xls · csv — حتى 100,000 سجل</span>
                    <span className="text-xs opacity-40">الأرقام المحلية تُحوّل تلقائياً للصيغة الدولية</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Import Result ── */}
          {importResult && !addMutation.isPending && (
            <div className="mt-5 space-y-4">
              <div className={cn("grid gap-3", importResult.skippedLandline ? "grid-cols-5" : "grid-cols-4")}>
                {[
                  { label: "مُضاف",        value: importResult.added,             color: "text-green-400" },
                  { label: "مكرر",         value: importResult.duplicates,        color: "text-yellow-400" },
                  { label: "غير صالح",     value: importResult.invalid,           color: "text-red-400" },
                  ...(importResult.skippedLandline
                    ? [{ label: "أرضي متجاهل", value: importResult.skippedLandline, color: "text-orange-400" }]
                    : []),
                  { label: "الإجمالي",     value: importResult.total,             color: "text-foreground" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-muted/50 rounded-xl p-3 text-center">
                    <p className={cn("text-xl font-bold", color)}>{value.toLocaleString("ar-SA")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {importResult.autoSplit && importResult.groups.length > 1 && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">تم التقسيم التلقائي إلى {importResult.groups.length} قائمة</span>
                    <CheckCircle2 className="w-4 h-4 text-green-400 mr-auto" />
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-52 overflow-y-auto">
                    {importResult.groups.map((g, i) => (
                      <button key={g.id} onClick={() => navigate(`/contacts/${g.id}`)}
                        className="flex items-center justify-between px-3 py-2 bg-card border border-card-border rounded-lg hover:border-primary/30 transition-colors group">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">{i + 1}</span>
                          <span className="text-sm">{g.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-primary font-medium">{g.count.toLocaleString("ar-SA")} رقم</span>
                          <ArrowLeft className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contacts Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
          <h2 className="font-semibold text-sm">الأرقام ({group.count.toLocaleString("ar-SA")})</h2>
          <div className="flex items-center gap-3">
            {group.count > 100 && <span className="text-xs text-muted-foreground">يُعرض أول 100</span>}
            {group.count > 0 && (
              <button
                onClick={exportToExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/10 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                تصدير Excel
              </button>
            )}
          </div>
        </div>

        {!group.contacts?.length ? (
          <div className="py-12 text-center text-muted-foreground text-sm">لا توجد أرقام في هذه القائمة بعد</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border bg-muted/20">
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium w-12">#</th>
                  {hasNames && <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">الاسم</th>}
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">رقم الهاتف</th>
                  <th className="text-right px-5 py-3 text-xs text-muted-foreground font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {group.contacts.slice(0, 100).map((contact: any, i: number) => (
                  <tr key={contact.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                    {hasNames && (
                      <td className="px-5 py-2.5 text-sm">
                        {contact.name || <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                    )}
                    <td className="px-5 py-2.5 text-sm font-mono text-foreground" dir="ltr">{contact.phone}</td>
                    <td className="px-5 py-2.5">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">نشط</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
