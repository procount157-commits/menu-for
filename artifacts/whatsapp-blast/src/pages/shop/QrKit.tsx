// ── /qr — the print kit ───────────────────────────────────────────
// Every code the shop needs: the counter poster, a card per table, the queue
// and booking codes, and the TV link. The printable sheets live in a portal
// beside #root so print CSS can hide the whole dashboard with one rule, and
// they are mounted all the time so their QR images are loaded before the
// print dialog opens.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Download, ExternalLink, Loader2, Monitor, Printer, QrCode, Sparkles, Table2, Users, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { get, useShop, inputCls } from "@/lib/shop-api";
import { CopyButton, PageHeader, Section, Skel, btnGhost, btnPrimary, markQrDone } from "@/components/shop/setup/kit";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Kit {
  org: { name: string; nameEn: string | null; logoUrl: string | null; theme: { template: string; brand: string }; vertical: string; slug: string };
  branch: { id: number; name: string; nameEn: string | null; slug: string };
  menu: string; queue: string; book: string; display: string;
  tables: Array<{ label: string; url: string }>;
}

const qrSrc = (text: string, dark: string, size = 512, format: "svg" | "png" = "svg") =>
  `${BASE}/api/qr/image?text=${encodeURIComponent(text)}&size=${size}&format=${format}&dark=${encodeURIComponent(dark)}`;
const media = (u: string | null) => (u && u.startsWith("/") ? `${BASE}${u}` : u);
const short = (u: string) => u.replace(/^https?:\/\//, "");

/** Relative luminance: a light brand colour on white will not scan reliably. */
function luminance(hex: string) {
  const c = hex.replace("#", "").match(/../g)?.map((x) => parseInt(x, 16) / 255) ?? [0, 0, 0];
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

type PrintWhat = "poster" | "tables" | "both";

export default function QrKit() {
  const shop = useShop();
  const [tablesIn, setTablesIn] = useState(() => { try { return Number(localStorage.getItem("mfy:qr-tables")) || 8; } catch { return 8; } });
  const [tables, setTables] = useState(tablesIn);
  const [color, setColor] = useState<"black" | "brand">("black");
  const [posterTarget, setPosterTarget] = useState<"queue" | "menu">("queue");
  const [printWhat, setPrintWhat] = useState<PrintWhat>("poster");

  useEffect(() => {
    const h = setTimeout(() => { setTables(Math.max(0, Math.min(200, Math.floor(tablesIn) || 0))); try { localStorage.setItem("mfy:qr-tables", String(tablesIn)); } catch { /* */ } }, 400);
    return () => clearTimeout(h);
  }, [tablesIn]);

  const kit = useQuery<Kit>({ queryKey: ["/api/qr/kit", tables, shop.branch.id], queryFn: () => get(`/api/qr/kit?tables=${tables}`), placeholderData: (p) => p });
  const brand = kit.data?.org.theme.brand ?? shop.org.theme.brand;
  const brandScans = luminance(brand) < 0.32;
  const dark = color === "brand" && brandScans ? brand : "#111111";

  const download = async (text: string, name: string) => {
    try {
      const r = await fetch(qrSrc(text, dark, 1024, "png"), { credentials: "include" });
      if (!r.ok) throw new Error("ما قدرنا نجهّز الصورة");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = `${kit.data?.org.slug ?? "qr"}-${name}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      markQrDone(shop.org.id);
    } catch (e) { toast.error((e as Error).message); }
  };

  const print = (what: PrintWhat) => {
    setPrintWhat(what);
    markQrDone(shop.org.id);
    // The dialog snapshots the page as it is, so wait for every code on paper to finish loading.
    setTimeout(async () => {
      const pending = [...document.querySelectorAll<HTMLImageElement>(".mfy-print img")].filter((i) => !i.complete);
      await Promise.race([
        Promise.all(pending.map((i) => new Promise((ok) => { i.onload = i.onerror = ok; }))),
        new Promise((ok) => setTimeout(ok, 5000)),
      ]);
      window.print();
    }, 60);
  };

  const k = kit.data;
  const codes = k ? [
    { key: "menu", icon: <UtensilsCrossed className="w-4 h-4" />, title: "المنيو", sub: "للإنستغرام والواجهة والبزنس كارد", url: k.menu },
    { key: "queue", icon: <Users className="w-4 h-4" />, title: shop.vocab.queue[0], sub: "يفتح المنيو وورقة «احجز دورك» مباشرة — للكاونتر والباب", url: k.queue },
    { key: "book", icon: <CalendarCheck className="w-4 h-4" />, title: shop.vocab.booking[0], sub: "يفتح الحجز على طول", url: k.book },
  ] : [];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl" dir="rtl">
      <PageHeader
        icon={<QrCode className="w-6 h-6 text-primary" />}
        title="QR والمطبوعات"
        sub={<>أكواد {shop.branches.length > 1 ? `فرع ${shop.branch.name}` : shop.org.name} جاهزة للطباعة. اطبعها على ورق مقوّى، أو نزّل الصورة وأرسلها للمطبعة.</>}
        actions={<>
          <button className={btnGhost} disabled={!k} onClick={() => print("tables")}><Table2 className="w-4 h-4" />اطبع الطاولات</button>
          <button className={btnPrimary} disabled={!k} onClick={() => print("poster")}><Printer className="w-4 h-4" />اطبع الملصق</button>
        </>}
      />

      {/* options */}
      <Section>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1.5">لون الكود</div>
            <div className="flex gap-2">
              <button className={cn(btnGhost, "flex-1", color === "black" && "border-primary text-primary")} onClick={() => setColor("black")}>
                <span className="w-3 h-3 rounded-full bg-[#111] border border-white/30" />أسود
              </button>
              <button className={cn(btnGhost, "flex-1", color === "brand" && "border-primary text-primary")} onClick={() => setColor("brand")} disabled={!brandScans}
                title={brandScans ? "" : "لون هويتك فاتح — الكود يصعب مسحه"}>
                <span className="w-3 h-3 rounded-full" style={{ background: brand }} />لون الهوية
              </button>
            </div>
            {!brandScans && <div className="text-[11px] text-muted-foreground mt-1">لون هويتك فاتح على الورق الأبيض، فخلّيناه أسود عشان ينمسح بسهولة.</div>}
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1.5">كود ملصق الكاونتر</div>
            <select className={inputCls} value={posterTarget} onChange={(e) => setPosterTarget(e.target.value as "queue")}>
              <option value="queue">المنيو + احجز دورك</option>
              <option value="menu">المنيو فقط</option>
            </select>
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-1.5">عدد الطاولات</div>
            <input type="number" min={0} max={200} className={inputCls} value={tablesIn} onChange={(e) => setTablesIn(Number(e.target.value))} />
          </div>
        </div>
      </Section>

      {/* the three main codes */}
      <div className="grid sm:grid-cols-3 gap-4">
        {!k && [0, 1, 2].map((i) => <Skel key={i} className="h-80 rounded-2xl" />)}
        {codes.map((c) => (
          <div key={c.key} className="bg-card border border-card-border rounded-2xl p-4 flex flex-col">
            <div className="flex items-center gap-2 font-semibold">{c.icon}{c.title}</div>
            <div className="text-xs text-muted-foreground mt-1 min-h-[2rem] leading-relaxed">{c.sub}</div>
            <div className="bg-white rounded-xl p-3 my-3 aspect-square flex items-center justify-center">
              <img src={qrSrc(c.url, dark)} alt={c.title} className="w-full h-full" />
            </div>
            <div className="font-mono text-[11px] text-muted-foreground truncate mb-3" dir="ltr">{short(c.url)}</div>
            <div className="flex gap-2 mt-auto">
              <button className={cn(btnGhost, "flex-1 text-xs")} onClick={() => download(c.url, c.key)}><Download className="w-3.5 h-3.5" />PNG</button>
              <CopyButton text={c.url} className="flex-1" />
            </div>
          </div>
        ))}
      </div>

      {/* TV */}
      <Section title="شاشة العرض (TV)" sub="افتح هذا الرابط على تلفزيون أو تابلت معلّق — يعرض الأرقام اللي جاء دورها ويرن. لا تنشره للزبائن.">
        {k ? (
          <div className="flex flex-wrap items-center gap-2">
            <Monitor className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground truncate max-w-full" dir="ltr">{short(k.display)}</span>
            <div className="flex gap-2 ms-auto">
              <CopyButton text={k.display} />
              <a href={k.display} target="_blank" rel="noreferrer" className={cn(btnGhost, "text-xs px-3 py-1.5")}><ExternalLink className="w-3.5 h-3.5" />افتح</a>
            </div>
            {!shop.plan.features.display && (
              <div className="w-full flex items-center gap-2 text-xs text-primary mt-2"><Sparkles className="w-3.5 h-3.5" />شاشة العرض مو ضمن باقة {shop.plan.planName} — تحتاج باقة أعلى عشان تشتغل.</div>
            )}
          </div>
        ) : <Skel className="h-8" />}
      </Section>

      {/* tables */}
      <Section title="بطاقات الطاولات" sub="كل بطاقة تفتح المنيو ورقم الطاولة معروف، فالطلب يوصلك «طاولة 5» بدون ما يكتبها الزبون. 8 بطاقات في كل ورقة A4."
        actions={<button className={btnGhost} disabled={!k?.tables.length} onClick={() => print("tables")}><Printer className="w-4 h-4" />اطبع</button>}>
        {k && !k.tables.length && <div className="text-sm text-muted-foreground">حط عدد الطاولات فوق وتطلع البطاقات هنا.</div>}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {k?.tables.map((t) => (
            <button key={t.label} onClick={() => download(t.url, `table-${t.label}`)} title="نزّل PNG"
              className="group bg-white rounded-xl p-2 text-[#111] text-center hover:ring-2 hover:ring-primary transition-shadow">
              <img src={qrSrc(t.url, dark, 256)} alt="" className="w-full aspect-square" loading="lazy" />
              <div className="text-xs font-semibold mt-1">طاولة {t.label}</div>
            </button>
          ))}
        </div>
        {kit.isFetching && <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />يجهّز…</div>}
      </Section>

      {k && <PrintSheets kit={k} dark={dark} what={printWhat} posterUrl={posterTarget === "queue" ? k.queue : k.menu} ctaEn={posterTarget === "queue" ? "Scan for the menu & join the queue" : "Scan for the menu"} />}
    </div>
  );
}

// ── What goes on paper ────────────────────────────────────────────

const PRINT_CSS = `
.mfy-print { display: none; }
@media print {
  @page poster { size: A5 portrait; margin: 0; }
  @page cards { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; }
  body > *:not(.mfy-print) { display: none !important; }
  .mfy-print { display: block; color: #111; font-family: inherit; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mfy-poster { page: poster; width: 148mm; height: 210mm; break-after: page; }
  .mfy-cards { page: cards; width: 210mm; height: 297mm; break-after: page; }
  .mfy-poster:last-child, .mfy-cards:last-child { break-after: auto; }
  .mfy-print[data-what="poster"] .mfy-cards, .mfy-print[data-what="tables"] .mfy-poster { display: none !important; }
  .mfy-print[data-what="poster"] .mfy-poster { break-after: auto; }
}
`;

function PrintSheets({ kit, dark, what, posterUrl, ctaEn }: { kit: Kit; dark: string; what: PrintWhat; posterUrl: string; ctaEn: string }) {
  const brand = kit.org.theme.brand;
  const logo = media(kit.org.logoUrl);
  const pages = useMemo(() => {
    const out: Kit["tables"][] = [];
    for (let i = 0; i < kit.tables.length; i += 8) out.push(kit.tables.slice(i, i + 8));
    return out;
  }, [kit.tables]);
  const initial = kit.org.name.trim()[0] ?? "";

  const Logo = ({ size }: { size: string }) => logo
    ? <img src={logo} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: "50%" }} />
    : <div style={{ width: size, height: size, borderRadius: "50%", background: brand, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: `calc(${size} * 0.45)` }}>{initial}</div>;

  return createPortal(
    <div className="mfy-print" dir="rtl" data-what={what}>
      <style>{PRINT_CSS}</style>
      {/* Both sheets stay mounted (print CSS picks one) so their images are already loaded. */}
      <div className="mfy-poster" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "14mm 12mm 12mm", boxSizing: "border-box", borderTop: `6mm solid ${brand}` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3mm" }}>
          <Logo size="22mm" />
          <div style={{ fontSize: "22pt", fontWeight: 800, textAlign: "center", lineHeight: 1.2 }}>{kit.org.name}</div>
          {kit.org.nameEn && <div style={{ fontSize: "11pt", color: "#666", letterSpacing: "0.04em" }} dir="ltr">{kit.org.nameEn}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4mm" }}>
          <div style={{ fontSize: "17pt", fontWeight: 700, textAlign: "center" }}>امسح للمنيو واحجز دورك</div>
          <div style={{ padding: "4mm", border: `1.2mm solid ${brand}`, borderRadius: "6mm", background: "#fff" }}>
            <img src={qrSrc(posterUrl, dark)} alt="" style={{ width: "78mm", height: "78mm", display: "block" }} />
          </div>
          <div style={{ fontSize: "10pt", color: "#555" }} dir="ltr">{ctaEn}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5mm" }}>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "12pt", fontWeight: 600 }} dir="ltr">{short(kit.menu)}</div>
          <div style={{ fontSize: "8pt", color: "#888" }}>بدون تطبيق · بدون تسجيل</div>
        </div>
      </div>
      {pages.map((page, pi) => (
        <div key={pi} className="mfy-cards" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(4, 1fr)", boxSizing: "border-box" }}>
          {page.map((t) => (
            <div key={t.label} style={{ border: "0.2mm dashed #bbb", display: "flex", alignItems: "center", gap: "5mm", padding: "6mm 7mm", boxSizing: "border-box" }}>
              <img src={qrSrc(t.url, dark)} alt="" style={{ width: "46mm", height: "46mm", flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: "2mm", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
                  <Logo size="9mm" />
                  <div style={{ fontSize: "10pt", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kit.org.name}</div>
                </div>
                <div style={{ fontSize: "9pt", color: "#666" }}>طاولة</div>
                <div style={{ fontSize: "34pt", fontWeight: 800, lineHeight: 1, color: brand }}>{t.label}</div>
                <div style={{ fontSize: "9pt", fontWeight: 600 }}>امسح للمنيو واطلب</div>
                <div style={{ fontSize: "7pt", color: "#888" }} dir="ltr">Scan to see the menu & order</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
