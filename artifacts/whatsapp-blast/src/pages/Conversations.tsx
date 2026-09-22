import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare, Search, CheckSquare, Square,
  Import, Loader2, RefreshCw, Phone, Calendar,
  CheckCheck, Users, Download,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

interface ConvEntry {
  phone: string;
  name: string | null;
  lastText: string;
  lastAt: number;
  msgCount: number;
}

interface MsgEntry {
  phone: string;
  name: string | null;
  lastText: string;
  lastAt: number;
  count: number;
}

interface CombinedEntry {
  phone: string;
  name: string | null;
  lastText: string;
  lastAt: number;
  source: "conversation" | "incoming" | "both" | "contact";
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiFetch = (path: string) =>
  fetch(`${BASE}${path}`, { credentials: "include" }).then(r => {
    if (!r.ok) throw new Error();
    return r.json();
  });

function fmtDate(ts: number) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const t = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  if (d >= today) return `اليوم ${t}`;
  if (d >= yest)  return `أمس ${t}`;
  return d.toLocaleDateString("ar-SA", { day: "2-digit", month: "2-digit" });
}

const SOURCE_LABEL: Record<string, string> = {
  conversation: "محادثة",
  incoming: "رسالة واردة",
  both: "محادثة + وارد",
  contact: "جهة اتصال",
};

// Rows are rendered in slices. The full set still drives search, select-all and
// import — this only limits how much DOM exists at once, because the extractor
// routinely returns five figures of contacts.
const PAGE = 300;

export default function Conversations() {
  const [search, setSearch]       = useState("");
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [listName, setListName]   = useState("محادثات واتساب");
  const [importing, setImporting] = useState(false);

  const { data: convData, isLoading: convLoading, refetch: refetchConvs } =
    useQuery({ queryKey: ["conversations"], queryFn: () => apiFetch("/api/whatsapp/extractor/conversations") });

  const { data: msgData, isLoading: msgLoading, refetch: refetchMsgs } =
    useQuery({ queryKey: ["incoming-messages"], queryFn: () => apiFetch("/api/whatsapp/extractor/messages") });

  // wa_contacts: every number WhatsApp knows about, not just those with a
  // thread. This is by far the largest source and the page previously ignored it.
  const { data: contactData, isLoading: contactLoading, refetch: refetchContacts } =
    useQuery({ queryKey: ["wa-contacts"], queryFn: () => apiFetch("/api/whatsapp/extractor") });

  const loading = convLoading || msgLoading || contactLoading;
  const [visible, setVisible] = useState(PAGE);

  // دمج المحادثات والرسائل الواردة في قائمة موحدة
  const combined = useMemo<CombinedEntry[]>(() => {
    const map = new Map<string, CombinedEntry>();

    for (const c of (convData?.conversations ?? []) as ConvEntry[]) {
      map.set(c.phone, {
        phone: c.phone,
        name: c.name,
        lastText: c.lastText,
        lastAt: c.lastAt,
        source: "conversation",
      });
    }
    for (const m of (msgData?.messages ?? []) as MsgEntry[]) {
      const existing = map.get(m.phone);
      if (existing) {
        map.set(m.phone, {
          ...existing,
          source: "both",
          lastAt: Math.max(existing.lastAt, m.lastAt),
          name: existing.name ?? m.name,
        });
      } else {
        map.set(m.phone, {
          phone: m.phone,
          name: m.name,
          lastText: m.lastText,
          lastAt: m.lastAt,
          source: "incoming",
        });
      }
    }

    for (const k of (contactData?.contacts ?? []) as Array<{ phone: string; name: string | null; lastMessageAt?: number }>) {
      const existing = map.get(k.phone);
      if (existing) {
        // Keep the richer entry; only fill in a name it was missing.
        if (!existing.name && k.name) map.set(k.phone, { ...existing, name: k.name });
      } else {
        map.set(k.phone, {
          phone: k.phone,
          name: k.name ?? null,
          lastText: "",
          lastAt: k.lastMessageAt ?? 0,
          source: "contact",
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt);
  }, [convData, msgData, contactData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return combined;
    const q = search.toLowerCase();
    return combined.filter(c =>
      c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q) || c.lastText.toLowerCase().includes(q)
    );
  }, [combined, search]);

  useEffect(() => { setVisible(PAGE); }, [search]);

  const allSelected  = filtered.length > 0 && filtered.every(c => selected.has(c.phone));
  const someSelected = filtered.some(c => selected.has(c.phone));

  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      filtered.forEach(c => next.delete(c.phone));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach(c => next.add(c.phone));
      setSelected(next);
    }
  };

  const toggleOne = (phone: string) => {
    const next = new Set(selected);
    if (next.has(phone)) next.delete(phone);
    else next.add(phone);
    setSelected(next);
  };

  const handleImport = async () => {
    const phones = Array.from(selected);
    if (phones.length === 0) { toast.error("اختر محادثات أولاً"); return; }
    if (!listName.trim())    { toast.error("أدخل اسم القائمة"); return; }
    setImporting(true);
    try {
      const res = await fetch(`${BASE}/api/whatsapp/import-phones`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listName, phones }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "فشل الاستيراد"); return; }
      toast.success(`✅ تم استيراد ${data.count} رقم إلى قائمة "${data.listName}"`);
      setSelected(new Set());
    } catch {
      toast.error("حدث خطأ أثناء الاستيراد");
    } finally {
      setImporting(false);
    }
  };

  const handleImportAll = async () => {
    if (combined.length === 0) { toast.error("لا يوجد محادثات للاستيراد"); return; }
    if (!listName.trim()) { toast.error("أدخل اسم القائمة"); return; }
    setImporting(true);
    try {
      const phones = combined.map(c => c.phone);
      const res = await fetch(`${BASE}/api/whatsapp/import-phones`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listName, phones }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "فشل الاستيراد"); return; }
      toast.success(`✅ تم استيراد ${data.count} رقم إلى قائمة "${data.listName}"`);
    } catch {
      toast.error("حدث خطأ أثناء الاستيراد");
    } finally {
      setImporting(false);
    }
  };

  const handleExportExcel = () => {
    const rows = (selected.size > 0 ? filtered.filter(c => selected.has(c.phone)) : filtered).map(c => ({
      "الاسم":         c.name ?? "",
      "الرقم":         `+${c.phone}`,
      "المصدر":        SOURCE_LABEL[c.source],
      "آخر رسالة":    c.lastText,
      "آخر نشاط":     fmtDate(c.lastAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المحادثات");
    XLSX.writeFile(wb, `محادثات-${new Date().toLocaleDateString("ar-SA")}.xlsx`);
    toast.success(`تم تصدير ${rows.length} سجل`);
  };

  const handleRefresh = () => {
    refetchConvs();
    refetchMsgs();
    toast.info("جاري تحديث البيانات...");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المحادثات</h1>
          <p className="text-sm text-muted-foreground mt-1">
            كل من تحدثت معه أو أرسل لك رسالة — استورد الأرقام لقوائم الحملات
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          تحديث
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <MessageSquare className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{(convData?.total ?? 0).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">محادثات مزامَنة</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <Phone className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{(msgData?.total ?? 0).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">أرقام أرسلت لك</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 text-center">
          <Users className="w-5 h-5 text-green-400 mx-auto mb-1" />
          <p className="text-xl font-bold text-foreground">{combined.length.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">إجمالي فريد</p>
        </div>
      </div>

      {/* Import toolbar */}
      <div className="bg-card border border-card-border rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input
            value={listName}
            onChange={e => setListName(e.target.value)}
            placeholder="اسم القائمة..."
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2 flex-shrink-0">
            {selected.size > 0 && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Import className="w-4 h-4" />}
                استيراد المحدد ({selected.size})
              </button>
            )}
            <button
              onClick={handleImportAll}
              disabled={importing || combined.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
              استيراد الكل ({combined.length})
            </button>
            <button
              onClick={handleExportExcel}
              disabled={combined.length === 0}
              className="flex items-center gap-2 px-3 py-2 border border-border text-muted-foreground hover:text-foreground rounded-lg text-sm disabled:opacity-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              Excel
            </button>
          </div>
        </div>
      </div>

      {/* Conversation list */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {/* List header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border bg-muted/30">
          <button onClick={toggleAll} className="flex-shrink-0 text-muted-foreground hover:text-foreground">
            {allSelected
              ? <CheckSquare className="w-4 h-4 text-primary" />
              : someSelected
              ? <CheckSquare className="w-4 h-4 text-primary/50" />
              : <Square className="w-4 h-4" />}
          </button>
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث برقم أو اسم أو نص..."
              className="w-full bg-background border border-border rounded-lg pr-9 pl-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {selected.size > 0 && (
            <span className="text-xs text-primary font-medium flex-shrink-0">
              {selected.size} محدد
            </span>
          )}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">جاري التحميل...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <MessageSquare className="w-10 h-10 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">لا يوجد محادثات بعد</p>
              <p className="text-xs mt-1 max-w-xs">
                اذهب لـ "ربط الواتساب" واضغط "مزامنة كاملة" ثم امسح QR جديد
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/40 max-h-[520px] overflow-y-auto">
            {filtered.slice(0, visible).map(c => {
              const isSelected = selected.has(c.phone);
              return (
                <div
                  key={c.phone}
                  onClick={() => toggleOne(c.phone)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                    isSelected ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/30"
                  )}
                >
                  {/* Checkbox */}
                  <div className="flex-shrink-0 text-muted-foreground">
                    {isSelected
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4" />}
                  </div>

                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary">
                      {(c.name ?? c.phone).charAt(0)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {c.name ?? <span dir="ltr">+{c.phone}</span>}
                      </span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0",
                        c.source === "both"         ? "bg-green-500/10 text-green-400" :
                        c.source === "incoming"     ? "bg-blue-500/10 text-blue-400" :
                                                      "bg-primary/10 text-primary"
                      )}>
                        {SOURCE_LABEL[c.source]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5" dir="ltr">
                      {c.name ? `+${c.phone}` : ""}
                      {c.name && c.lastText ? " · " : ""}
                      {c.lastText || ""}
                    </p>
                  </div>

                  {/* Time */}
                  <div className="text-[11px] text-muted-foreground flex-shrink-0 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {fmtDate(c.lastAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer count */}
        {filtered.length > visible && (
          <div className="px-4 py-3 border-t border-card-border text-center">
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE)}
              className="px-4 py-2 rounded-lg text-sm border border-card-border hover:border-primary/50 transition-colors"
            >
              عرض {Math.min(PAGE, filtered.length - visible).toLocaleString()} إضافية
              <span className="opacity-60"> (ظاهر {visible.toLocaleString()} من {filtered.length.toLocaleString()})</span>
            </button>
            <p className="text-[11px] text-muted-foreground mt-2">
              البحث و«تحديد الكل» والاستيراد تعمل على القائمة كاملة — لا على الظاهر فقط
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-card-border bg-muted/20 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {filtered.length} محادثة
              {search ? ` (من أصل ${combined.length})` : ""}
            </span>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                إلغاء التحديد
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
