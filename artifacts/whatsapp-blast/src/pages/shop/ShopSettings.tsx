// ── /shop/settings — the shop, its look, branches, queue, booking ─
// The shop and its look are org-wide; queue and booking settings belong to
// the branch the session is on, so those two tabs say which branch and let
// the owner switch without leaving the page.

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarCheck, Loader2, Palette, Plus, Settings2, Store, Users } from "lucide-react";
import { TEMPLATES, type Template, type Vertical } from "@workspace/menu-shared";
import { cn } from "@/lib/utils";
import { SHOP_KEY, get, patch, post, useShop, useSwitchBranch, inputCls } from "@/lib/shop-api";
import {
  Field, ImageDrop, PageHeader, Section, SegTabs, Skel, Toggle, ToggleRow, UpgradeNotice, btnGhost, btnPrimary, isPlanError,
} from "@/components/shop/setup/kit";
import BranchesTab from "@/components/shop/setup/BranchesTab";

type Tab = "shop" | "look" | "branches" | "queue" | "booking";
const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "shop", label: "المحل", icon: <Store className="w-3.5 h-3.5" /> },
  { id: "look", label: "الهوية", icon: <Palette className="w-3.5 h-3.5" /> },
  { id: "branches", label: "الفروع", icon: <Settings2 className="w-3.5 h-3.5" /> },
  { id: "queue", label: "الصف", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "booking", label: "الحجز", icon: <CalendarCheck className="w-3.5 h-3.5" /> },
];

const VERTICALS: Array<[Vertical, string]> = [["restaurant", "مطعم"], ["cafe", "كافيه"], ["sweets", "حلويات"], ["beauty", "تجميل"], ["barber", "حلاقة رجالي"]];
const CURRENCIES: Array<[string, string]> = [["AED", "درهم إماراتي"], ["SAR", "ريال سعودي"], ["KWD", "دينار كويتي"], ["QAR", "ريال قطري"], ["BHD", "دينار بحريني"], ["OMR", "ريال عماني"], ["EGP", "جنيه مصري"], ["USD", "دولار"]];
const TIMEZONES: Array<[string, string]> = [["Asia/Dubai", "الإمارات / عُمان"], ["Asia/Riyadh", "السعودية / الكويت / قطر / البحرين"], ["Africa/Cairo", "مصر"], ["Asia/Amman", "الأردن"], ["Europe/London", "لندن"]];
const SOCIALS: Array<[string, string, string]> = [
  ["instagram", "إنستغرام", "@bait.shami"], ["tiktok", "تيك توك", "@bait.shami"], ["snapchat", "سناب شات", "baitshami"],
  ["x", "X", "@baitshami"], ["facebook", "فيسبوك", "facebook.com/…"], ["google", "تقييم Google", "https://g.page/r/…"], ["website", "الموقع", "https://…"],
];

/** A stored image path, as the dashboard (which may live under a base path) loads it. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const media = (u: string | null) => (u && u.startsWith("/") ? `${BASE}${u}` : u);

function useTab(): [Tab, (t: Tab) => void] {
  const read = () => (TABS.some((t) => `#${t.id}` === location.hash) ? location.hash.slice(1) as Tab : "shop");
  const [tab, set] = useState<Tab>(read);
  return [tab, (t) => { set(t); history.replaceState(null, "", `#${t}`); }];
}

export default function ShopSettings() {
  const [tab, setTab] = useTab();
  const { plan, role } = useShop();
  // A switched-off queue or booking has no settings worth showing; a member
  // of staff with the settings permission sees only those two.
  const tabs = TABS.filter((t) => (t.id !== "queue" || plan.features.queue) && (t.id !== "booking" || plan.features.booking)
    && (role === "owner" || t.id === "queue" || t.id === "booking"));
  const shown: Tab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? "shop";
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl" dir="rtl">
      <PageHeader icon={<Settings2 className="w-6 h-6 text-primary" />} title="المحل والفروع" sub="اسم المحل وشكله، الفروع وساعاتها، وكيف يشتغل الصف والحجز." />
      <SegTabs tabs={tabs} value={shown} onChange={setTab} />
      {shown === "shop" && role === "owner" && <ShopTab />}
      {shown === "look" && role === "owner" && <LookTab />}
      {shown === "branches" && role === "owner" && <BranchesTab />}
      {shown === "queue" && <QueueTab />}
      {shown === "booking" && <BookingTab />}
    </div>
  );
}

function useSaveOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Record<string, unknown>) => patch("/api/org", p),
    onSuccess: () => qc.invalidateQueries({ queryKey: SHOP_KEY }),
    onError: (e) => toast.error((e as Error).message),
  });
}

// ── المحل ─────────────────────────────────────────────────────────

function ShopTab() {
  const { org, links } = useShop();
  // The public host can differ from the dashboard's, so take it from the menu link.
  const host = (() => { try { return new URL(links.menu).host; } catch { return location.host; } })();
  const save = useSaveOrg();
  const initial = () => ({
    name: org.name, nameEn: org.nameEn ?? "", tagline: org.tagline ?? "", taglineEn: org.taglineEn ?? "", about: org.about ?? "",
    slug: org.slug, vertical: org.vertical, defaultLang: org.defaultLang, currency: org.currency, timezone: org.timezone,
    socials: { ...(org.socials ?? {}) } as Record<string, string>,
  });
  const [f, setF] = useState(initial);
  useEffect(() => setF(initial()), [org.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const slugChanged = f.slug !== org.slug;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial());
  const tzs = TIMEZONES.some(([z]) => z === f.timezone) ? TIMEZONES : [[f.timezone, f.timezone] as [string, string], ...TIMEZONES];

  const submit = () => {
    if (slugChanged && !confirm(`تغيير الرابط من «${org.slug}» إلى «${f.slug}» يعطّل كل QR مطبوع وكل رابط أرسلته للزبائن. متأكد؟`)) return;
    save.mutate(f, { onSuccess: () => toast.success("انحفظ") });
  };

  return (
    <div className="space-y-4">
      <ModulesSection />
      <Section title="الاسم والتعريف">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="اسم المحل"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="بالإنجليزي"><input className={inputCls} dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
          <Field label="السطر التعريفي"><input className={inputCls} maxLength={200} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} placeholder="سطر واحد يعرّف بالمحل" /></Field>
          <Field label="بالإنجليزي"><input className={inputCls} dir="ltr" maxLength={200} value={f.taglineEn} onChange={(e) => setF({ ...f, taglineEn: e.target.value })} placeholder="One line about the shop" /></Field>
          <Field label="نبذة" className="sm:col-span-2" hint="تطلع تحت المنيو، والبوت يستخدمها لما يسأله زبون عن المحل.">
            <textarea className={cn(inputCls, "min-h-[90px]")} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="الرابط والنشاط">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="رابط المحل" className="sm:col-span-2"
            hint={slugChanged ? <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />أي QR مطبوع بالرابط القديم يتعطل — بتحتاج تطبع من جديد.</span> : "اللي ينطبع على الـ QR."}>
            <div className="flex items-stretch rounded-lg border border-border bg-input overflow-hidden focus-within:ring-2 focus-within:ring-ring" dir="ltr">
              <span className="px-3 flex items-center text-sm text-muted-foreground bg-muted/50 border-e border-border">{host}/</span>
              <input className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none" value={f.slug}
                onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
            </div>
          </Field>
          <Field label="نوع النشاط" hint="يغيّر الكلمات (طبق / منتج / خدمة) — ما يمس المنيو.">
            <select className={inputCls} value={f.vertical} onChange={(e) => setF({ ...f, vertical: e.target.value as Vertical })}>
              {VERTICALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="لغة المنيو الافتراضية">
            <select className={inputCls} value={f.defaultLang} onChange={(e) => setF({ ...f, defaultLang: e.target.value as "ar" })}>
              <option value="ar">العربية</option><option value="en">English</option>
            </select>
          </Field>
          <Field label="العملة">
            <select className={inputCls} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l} ({c})</option>)}
            </select>
          </Field>
          <Field label="المنطقة الزمنية" hint="عليها نحسب «اليوم» في التقارير ومواعيد الحجز.">
            <select className={inputCls} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {tzs.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="حسابات التواصل" sub="تطلع كأيقونات أسفل المنيو. اتركها فاضية لو ما عندك.">
        <div className="grid sm:grid-cols-2 gap-4">
          {SOCIALS.map(([k, l, ph]) => (
            <Field key={k} label={l}>
              <input className={inputCls} dir="ltr" value={f.socials[k] ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, socials: { ...f.socials, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </Section>

      <SaveBar dirty={dirty} busy={save.isPending} onSave={submit} onReset={() => setF(initial())} />
    </div>
  );
}

/**
 * The queue and bookings, on or off for the whole shop. Many restaurants want
 * neither: switched off, they leave the menu, the dashboard and the staff
 * screens. Saved the moment they are flipped.
 */
function ModulesSection() {
  const shop = useShop();
  const qc = useQueryClient();
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (p: Partial<Record<"queue" | "booking", boolean>>) => patch("/api/shop/modules", p),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: SHOP_KEY }); toast.success("انحفظ"); },
    onError: (e) => { if (isPlanError(e)) setUpgrade(e.message); else toast.error((e as Error).message); },
  });
  if (shop.role !== "owner") return null;
  const { modules, planFeatures } = shop.plan;
  return (
    <Section title="الخدمات المفعّلة" sub="شغّل اللي يحتاجه محلك بس. المطفأ يختفي من المنيو ومن لوحة التحكم وشاشة الموظفين.">
      {upgrade && <div className="mb-3"><UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} /></div>}
      <div className="divide-y divide-border">
        <ToggleRow title={`صف الانتظار — ${shop.vocab.queue[0]}`}
          hint={planFeatures.queue ? "الزبون ياخذ دوره من الرابط أو الـ QR ويشوف كم قدامه." : "غير متاح في خطتك."}
          checked={modules.queue && planFeatures.queue} disabled={save.isPending}
          onChange={(queue) => save.mutate({ queue })} />
        <ToggleRow title={shop.vocab.booking[0]}
          hint={planFeatures.booking ? `يطلع زر «${shop.vocab.bookCta[0]}» في المنيو. تفاصيل المواعيد من تبويب «الحجز».` : "غير متاح في خطتك."}
          checked={modules.booking && planFeatures.booking} disabled={save.isPending}
          onChange={(booking) => save.mutate({ booking })} />
      </div>
    </Section>
  );
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset?: () => void }) {
  return (
    <div className={cn("sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 bg-background/90 backdrop-blur flex items-center justify-end gap-2 transition-opacity", !dirty && "opacity-60")}>
      {dirty && <span className="text-xs text-muted-foreground me-auto">فيه تغييرات ما انحفظت</span>}
      {dirty && onReset && <button className="text-sm text-muted-foreground hover:text-foreground px-3" onClick={onReset}>تراجع</button>}
      <button className={btnPrimary} disabled={!dirty || busy} onClick={onSave}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}احفظ</button>
    </div>
  );
}

// ── الهوية ────────────────────────────────────────────────────────

const BRAND_SWATCHES = ["#22c55e", "#c9a24a", "#b5651d", "#7c5a3a", "#c2577a", "#8e3b46", "#2f6f5e", "#3b5b8e", "#111111"];

function LookTab() {
  const shop = useShop();
  const { org } = shop;
  const save = useSaveOrg();
  // Colour picks fire many events while dragging; send the last one.
  const [brand, setBrand] = useState(org.theme.brand);
  useEffect(() => setBrand(org.theme.brand), [org.theme.brand]);
  useEffect(() => {
    if (brand === org.theme.brand) return;
    const h = setTimeout(() => save.mutate({ theme: { ...org.theme, brand } }), 500);
    return () => clearTimeout(h);
  }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  const tpl = TEMPLATES[org.theme.template];

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
      <div className="space-y-4">
        <Section title="الشعار والغلاف" sub="الشعار مربّع؛ الغلاف عريض ويطلع أعلى المنيو. الصور تنحفظ على طول.">
          <div className="flex flex-wrap gap-4 items-start">
            <div>
              <ImageDrop kind="logo" round value={media(org.logoUrl)} className="w-24 h-24" label="الشعار"
                onChange={(img) => save.mutate({ logoUrl: img ? (img.md ?? img.url) : "" }, { onSuccess: () => toast.success(img ? "تم تحديث الشعار" : "انشال الشعار") })} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <ImageDrop kind="cover" value={media(org.coverUrl)} className="w-full aspect-[3/1]" label="صورة الغلاف"
                onChange={(img) => save.mutate({ coverUrl: img ? (img.md ?? img.url) : "" }, { onSuccess: () => toast.success(img ? "تم تحديث الغلاف" : "انشال الغلاف") })} />
            </div>
          </div>
        </Section>

        <Section title="القالب">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.keys(TEMPLATES) as Template[]).map((k) => {
              const t = TEMPLATES[k];
              const on = org.theme.template === k;
              return (
                <button key={k} type="button" onClick={() => !on && save.mutate({ theme: { ...org.theme, brand, template: k } })}
                  className={cn("rounded-xl border p-2 text-start transition-all", on ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary))]" : "border-card-border hover:border-primary/40")}>
                  <div className="h-20 rounded-lg p-2 flex flex-col gap-1.5" style={{ background: t.bg }}>
                    <div className="flex items-center gap-1.5"><span className="w-4 h-4 rounded-full" style={{ background: brand }} /><span className="h-1.5 w-12 rounded-full" style={{ background: t.text, opacity: 0.85 }} /></div>
                    <div className="flex-1 rounded-md" style={{ background: t.surface, border: `1px solid ${t.muted}33` }} />
                    <div className="h-2 w-2/3 rounded-full" style={{ background: t.muted, opacity: 0.6 }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    {[t.bg, t.surface, t.text, t.muted].map((c, i) => <span key={i} className="w-3 h-3 rounded-full border border-white/10" style={{ background: c }} />)}
                  </div>
                  <div className="text-xs mt-1.5">{t.label[0]}</div>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="لون الهوية" sub="للأزرار والأسعار والتذكرة.">
          <div className="flex flex-wrap items-center gap-2">
            {BRAND_SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => setBrand(c)} aria-label={c}
                className={cn("w-9 h-9 rounded-full border-2 transition-transform", brand.toLowerCase() === c ? "border-foreground scale-110" : "border-transparent ring-1 ring-white/15")} style={{ background: c }} />
            ))}
            <label className="flex items-center gap-2 ms-2 cursor-pointer">
              <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)} className="w-9 h-9 rounded-full bg-transparent border-0 p-0 cursor-pointer" />
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">{brand}</span>
            </label>
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </Section>
      </div>

      {/* phone-sized preview */}
      <div className="lg:sticky lg:top-4">
        <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
          <span>كذا يشوفه الزبون</span>
          <a href={shop.links.menu} target="_blank" rel="noreferrer" className="text-primary">افتح المنيو</a>
        </div>
        <div className="rounded-[28px] border-[6px] border-black/60 overflow-hidden shadow-2xl mx-auto max-w-[300px]" style={{ background: tpl.bg, color: tpl.text }}>
          <div className="h-24 bg-cover bg-center" style={{ backgroundImage: org.coverUrl ? `url(${media(org.coverUrl)})` : `linear-gradient(135deg, ${brand}55, ${tpl.surface})` }} />
          <div className="px-4 -mt-7">
            <div className="w-14 h-14 rounded-full overflow-hidden border-4 flex items-center justify-center font-bold text-white" style={{ borderColor: tpl.bg, background: brand }}>
              {org.logoUrl ? <img src={media(org.logoUrl)!} alt="" className="w-full h-full object-cover" /> : org.name.trim()[0]}
            </div>
            <div className="font-bold mt-2">{org.name}</div>
            <div className="text-xs" style={{ color: tpl.muted }}>{org.tagline || shop.vocab.label[0]}</div>
          </div>
          <div className="p-4 space-y-2">
            {["الأكثر طلباً", "جديد"].map((c, i) => (
              <div key={c} className="rounded-xl p-3 flex items-center gap-3" style={{ background: tpl.surface, border: `1px solid ${tpl.muted}22` }}>
                <div className="w-10 h-10 rounded-lg shrink-0" style={{ background: `${brand}33` }} />
                <div className="flex-1 min-w-0"><div className="text-sm font-medium">{shop.vocab.item[0]} {i + 1}</div><div className="text-[11px]" style={{ color: tpl.muted }}>{c}</div></div>
                <span className="text-sm font-semibold" style={{ color: brand }}>{i ? 28 : 45}</span>
              </div>
            ))}
            <div className="rounded-full py-2.5 text-center text-sm font-semibold mt-3 text-white" style={{ background: brand }}>احجز دورك · قدامك 3</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Branch-scoped tabs ────────────────────────────────────────────

function BranchPicker() {
  const shop = useShop();
  const switchBranch = useSwitchBranch();
  const [busy, setBusy] = useState(false);
  if (shop.branches.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">إعدادات فرع</span>
      <select className={cn(inputCls, "w-auto py-1.5")} value={shop.branch.id} disabled={busy}
        onChange={async (e) => { setBusy(true); try { await switchBranch(Number(e.target.value)); } finally { setBusy(false); } }}>
        {shop.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

function NumField({ label, hint, value, onChange, min, max, suffix }: { label: string; hint?: string; value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-stretch rounded-lg border border-border bg-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
        <input type="number" min={min} max={max} className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm focus:outline-none tabular-nums" value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
        {suffix && <span className="px-3 flex items-center text-xs text-muted-foreground bg-muted/50 border-s border-border">{suffix}</span>}
      </div>
    </Field>
  );
}

// ── الصف ──────────────────────────────────────────────────────────

interface Queue {
  id: number; name: string; nameEn: string | null; prefix: string; avgServiceMin: number; maxWaiting: number; notifyAhead: number;
  noShowMin: number; autoNoShow: boolean; remoteJoin: "anyone" | "qr_only"; askPartySize: boolean; askService: boolean; isActive: boolean; isOpen: boolean;
  kind: "line" | "chair"; photoUrl: string | null;
}

function QueueTab() {
  const shop = useShop();
  const qc = useQueryClient();
  const q = useQuery<Queue[]>({ queryKey: ["/api/queues", shop.branch.id], queryFn: () => get("/api/queues") });
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => post("/api/queues", { name: `صف ${(q.data?.length ?? 0) + 1}`, prefix: String.fromCharCode(65 + (q.data?.length ?? 0) % 26) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/queues"] }); toast.success("انضاف صف جديد"); },
    onError: (e) => { if (isPlanError(e)) setUpgrade(e.message); else toast.error((e as Error).message); },
  });
  // Chairs are a barbershop's alone: a line per barber, named after him.
  const barber = shop.org.vertical === "barber";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BranchPicker />
        <button className={cn(barber ? btnGhost : btnPrimary, "ms-auto")} disabled={add.isPending} onClick={() => add.mutate()}><Plus className="w-4 h-4" />صف إضافي</button>
      </div>
      {upgrade && <UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} />}
      {!shop.plan.features.queue && <UpgradeNotice message={`الصف الرقمي مو ضمن باقة ${shop.plan.planName}.`} />}
      {barber && <ChairsSection queues={q.data ?? []} onPlanError={setUpgrade} />}
      {q.isLoading && <Skel className="h-96 rounded-2xl" />}
      {q.data?.map((x) => <QueueCard key={x.id} queue={x} multi={(q.data?.length ?? 0) > 1} />)}
    </div>
  );
}

/**
 * A barbershop's chairs: one line per barber, under his name and photo. The
 * customer picks whose line to join and sees his wait; the staff screen and
 * the TV show each chair on its own.
 */
function ChairsSection({ queues, onPlanError }: { queues: Queue[]; onPlanError: (m: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const chairs = queues.filter((x) => x.kind === "chair");
  const add = useMutation({
    mutationFn: () => post("/api/queues", { kind: "chair", name: name.trim(), photoUrl: photo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/queues"] }); setName(""); setPhoto(null); toast.success("انضاف الكرسي"); },
    onError: (e) => { if (isPlanError(e)) onPlanError(e.message); else toast.error((e as Error).message); },
  });
  const toggle = useMutation({
    mutationFn: (x: Queue) => patch(`/api/queues/${x.id}`, { isActive: !x.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/queues"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Section title="الكراسي" sub="لكل حلاق دوره باسمه: الزبون يختار حلاقه ويشوف كم قدامه عنده. الكرسي الموقوف يختفي من المنيو.">
      {chairs.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          {chairs.map((x) => (
            <div key={x.id} className={cn("flex items-center gap-3 rounded-xl bg-muted/40 p-3", !x.isActive && "opacity-60")}>
              {x.photoUrl
                ? <img src={media(x.photoUrl)!} alt="" className="w-10 h-10 rounded-full object-cover" />
                : <div className="w-10 h-10 rounded-full bg-primary/15 text-primary grid place-items-center font-semibold">{x.name.trim()[0]}</div>}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{x.name}</div>
                <div className="text-xs text-muted-foreground font-mono" dir="ltr">{x.prefix}-1, {x.prefix}-2…</div>
              </div>
              <Toggle checked={x.isActive} label={`كرسي ${x.name}`} disabled={toggle.isPending} onChange={() => toggle.mutate(x)} />
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <ImageDrop value={media(photo)} onChange={(img) => setPhoto(img?.md ?? img?.url ?? null)} kind="logo" round label="صورته" className="w-16 h-16" />
        <Field label="اسم الحلاق" className="flex-1 min-w-[10rem]">
          <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: محفوظ" />
        </Field>
        <button className={btnPrimary} disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}أضف كرسي
        </button>
      </div>
    </Section>
  );
}

function QueueCard({ queue, multi }: { queue: Queue; multi: boolean }) {
  const shop = useShop();
  const qc = useQueryClient();
  const [f, setF] = useState(queue);
  useEffect(() => setF(queue), [queue]);
  const dirty = JSON.stringify(f) !== JSON.stringify(queue);
  const save = useMutation({
    mutationFn: () => patch(`/api/queues/${queue.id}`, f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/queues"] }); toast.success("انحفظت إعدادات الصف"); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Section title={multi ? f.name : undefined}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={f.kind === "chair" ? "اسم الحلاق" : "اسم الصف"} hint={f.kind === "chair" ? "الزبون يختار حلاقه بهذا الاسم" : "يشوفه الزبون فوق رقمه"}><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="حرف الأرقام" hint={`التذاكر تطلع ${f.prefix || "A"}-1، ${f.prefix || "A"}-2…`}>
          <input className={cn(inputCls, "font-mono uppercase")} dir="ltr" maxLength={3} value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase() })} />
        </Field>
        <NumField label="متوسط وقت الخدمة" hint="لكل زبون — منه نحسب الوقت التقريبي، ويتعدل مع الأيام" suffix="دقيقة" min={1} max={240} value={f.avgServiceMin} onChange={(avgServiceMin) => setF({ ...f, avgServiceMin })} />
        <NumField label="أقصى عدد في الانتظار" hint="بعده نقول للزبون «الصف مليان»" min={1} max={1000} value={f.maxWaiting} onChange={(maxWaiting) => setF({ ...f, maxWaiting })} />
        <NumField label="نبّهه لما يبقى قدامه" hint="رسالة «قرّب دورك» على الواتساب" suffix="زبائن" min={0} max={20} value={f.notifyAhead} onChange={(notifyAhead) => setF({ ...f, notifyAhead })} />
        <NumField label="مهلة الحضور بعد النداء" suffix="دقيقة" min={1} max={60} value={f.noShowMin} onChange={(noShowMin) => setF({ ...f, noShowMin })} />
      </div>
      <div className="divide-y divide-border mt-4 border-t border-border">
        <ToggleRow title="سجّل «ما حضر» تلقائياً" hint={`لو ما جاء خلال ${f.noShowMin || "…"} دقايق من النداء، ننتقل للي بعده.`} checked={f.autoNoShow} onChange={(autoNoShow) => setF({ ...f, autoNoShow })} />
        <ToggleRow title="اسأل عن عدد الأشخاص" checked={f.askPartySize} onChange={(askPartySize) => setF({ ...f, askPartySize })} />
        <ToggleRow title={`اسأل عن ${shop.vocab.item[0]}`} hint="مفيد للصالون: كل خدمة لها مدة، فالوقت التقريبي يصير أدق." checked={f.askService} onChange={(askService) => setF({ ...f, askService })} />
        {f.kind === "chair" && (
          <div className="py-3 flex items-center gap-3">
            <ImageDrop value={media(f.photoUrl)} onChange={(img) => setF({ ...f, photoUrl: img?.md ?? img?.url ?? null })} kind="logo" round label="صورته" className="w-14 h-14" />
            <div className="text-xs text-muted-foreground">صورة الحلاق — تطلع للزبون وهو يختار، وعلى شاشة العرض.</div>
          </div>
        )}
        <ToggleRow title={f.kind === "chair" ? "الكرسي مفعّل" : "الصف مفعّل"} hint={f.kind === "chair" ? "إيقافه يخفي هذا الحلاق من المنيو." : "إيقافه يخفي «احجز دورك» من المنيو."} checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
        <div className="py-3">
          <div className="text-sm font-medium mb-2">مين يقدر يدخل الصف؟</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {([["anyone", "أي أحد معه الرابط", "حتى من البيت — يحجز دوره ويجي."], ["qr_only", "بس اللي مسح الـ QR في المحل", "يمنع اللي يحجز من بعيد وما يجي."]] as const).map(([v, t, s]) => (
              <button key={v} type="button" onClick={() => setF({ ...f, remoteJoin: v })}
                className={cn("text-start rounded-xl border p-3", f.remoteJoin === v ? "border-primary bg-primary/10" : "border-card-border hover:border-primary/40")}>
                <div className="text-sm font-medium">{t}</div><div className="text-xs text-muted-foreground mt-0.5">{s}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        {dirty && <button className="text-sm text-muted-foreground px-3" onClick={() => setF(queue)}>تراجع</button>}
        <button className={btnPrimary} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}احفظ</button>
      </div>
    </Section>
  );
}

// ── الحجز ─────────────────────────────────────────────────────────

interface BookingSettings {
  enabled: boolean; slotMin: number; capacityPerSlot: number; leadTimeMin: number; maxDaysAhead: number;
  maxParty: number; reminderBeforeMin: number; autoConfirm: boolean;
}

function BookingTab() {
  const shop = useShop();
  const qc = useQueryClient();
  const key = ["/api/booking-settings", shop.branch.id];
  const q = useQuery<BookingSettings>({ queryKey: key, queryFn: () => get("/api/booking-settings") });
  const [f, setF] = useState<BookingSettings | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: (p: Partial<BookingSettings>) => patch<BookingSettings>("/api/booking-settings", p),
    onSuccess: (r) => { qc.setQueryData(key, r); toast.success("انحفظ"); },
    onError: (e) => { if (isPlanError(e)) { setUpgrade(e.message); if (q.data) setF(q.data); } else toast.error((e as Error).message); },
  });
  if (!f || !q.data) return <div className="space-y-4"><BranchPicker /><Skel className="h-96 rounded-2xl" /></div>;
  const pick = ({ enabled: _e, ...rest }: BookingSettings) => rest;
  const dirty = JSON.stringify(pick(f)) !== JSON.stringify(pick(q.data));
  const services = shop.vocab.services;
  // A sweets shop's «booking» is a pre-order for a pickup time, not a table.
  const preorder = shop.org.vertical === "sweets";

  return (
    <div className="space-y-4">
      <BranchPicker />
      {upgrade && <UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} />}
      <Section>
        <ToggleRow title={`${shop.vocab.booking[0]} من المنيو`} hint={`يطلع زر «${shop.vocab.bookCta[0]}» للزبون.`} checked={f.enabled}
          onChange={(enabled) => { setF({ ...f, enabled }); save.mutate({ enabled }); }} />
      </Section>
      <Section title="المواعيد" className={cn(!f.enabled && "opacity-70")}>
        <div className="grid sm:grid-cols-2 gap-4">
          <NumField label="طول الفترة" hint="المواعيد تنعرض كل كم دقيقة" suffix="دقيقة" min={5} max={240} value={f.slotMin} onChange={(slotMin) => setF({ ...f, slotMin })} />
          <NumField label={services ? "كم زبونة في نفس الوقت" : preorder ? "كم طلب في نفس الفترة" : "كم حجز في نفس الفترة"}
            hint={services ? "عدد الموظفات المتاحات" : preorder ? "كم طلب يقدر المطبخ يجهّز لنفس الموعد" : "عدد الطاولات المتاحة للحجز"}
            min={1} max={500} value={f.capacityPerSlot} onChange={(capacityPerSlot) => setF({ ...f, capacityPerSlot })} />
          <NumField label="أقل مدة قبل الموعد" hint={f.leadTimeMin >= 60 ? `يعني ${+(f.leadTimeMin / 60).toFixed(1)} ساعة` : "ما يحجز أحد الحين لبعد دقيقتين"} suffix="دقيقة" min={0} max={20160} value={f.leadTimeMin} onChange={(leadTimeMin) => setF({ ...f, leadTimeMin })} />
          <NumField label="أبعد موعد" suffix="يوم قدام" min={0} max={180} value={f.maxDaysAhead} onChange={(maxDaysAhead) => setF({ ...f, maxDaysAhead })} />
          {!services && !preorder && <NumField label="أكبر عدد أشخاص" min={1} max={100} value={f.maxParty} onChange={(maxParty) => setF({ ...f, maxParty })} />}
          <NumField label="ذكّره قبل الموعد" hint="رسالة واتساب فيها «جاي / ألغِ». صفر = بدون تذكير" suffix="دقيقة" min={0} max={2880} value={f.reminderBeforeMin} onChange={(reminderBeforeMin) => setF({ ...f, reminderBeforeMin })} />
        </div>
        <div className="border-t border-border mt-4">
          <ToggleRow title="أكّد الحجز تلقائياً" hint="لو طفّيته، كل حجز ينتظر موافقتك من صفحة الحجوزات." checked={f.autoConfirm} onChange={(autoConfirm) => setF({ ...f, autoConfirm })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {dirty && <button className="text-sm text-muted-foreground px-3" onClick={() => setF(q.data!)}>تراجع</button>}
          <button className={btnPrimary} disabled={!dirty || save.isPending} onClick={() => save.mutate(pick(f))}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}احفظ</button>
        </div>
      </Section>
    </div>
  );
}
