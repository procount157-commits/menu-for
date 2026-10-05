// ── The menu ──────────────────────────────────────────────────────
// Laid out the way a real digital menu reads on a phone: the shop, a search
// box, the sections as photo tiles, the offers, what sells most, then each
// section under its own banner as a grid of photo cards — and the shop's
// hours, location and contacts at the end.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localParts, sectionOpen, vocab, type MenuView, type PublicImage, type PublicItem, type PublicMenu, type PublicOrderView, type Selection } from "@workspace/menu-shared";
import { Hero } from "@/components/Hero";
import { FeaturedRail, ItemCard, ItemLine, ItemRow, ItemSheet, flyToCart } from "@/components/Items";
import { designOf } from "@/lib/theme";
import { CartBar, CartSheet } from "@/components/Cart";
import { QueueFab, JoinSheet } from "@/components/Queue";
import { BookingSheet } from "@/components/Booking";
import { Icon, Img, toast, useReveal } from "@/components/ui";
import { addLine, initCart, priced, useCart } from "@/lib/cart";
import { pick, t, useLang, type Lang } from "@/lib/i18n";
import { api } from "@/lib/api";
import { initTrack, track } from "@/lib/track";

const DAYS = { ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"], en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] };

interface SectionData { id: number; title: string; image: PublicImage | null; items: PublicItem[]; hours: string | null; closed: boolean }
type View = MenuView;
const VIEW_ORDER: View[] = ["grid", "list", "text"];

/** «7:00 ص – 11:30 ص» in the diner's language. */
function clock(hhmm: string, lang: Lang) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { hour: "numeric", minute: m ? "2-digit" : undefined, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h, m)));
}

export default function MenuPage({ initial }: { initial: PublicMenu }) {
  const lang = useLang();
  const menu = initial;
  useMemo(() => initCart(menu.org.slug), [menu.org.slug]);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const table = params.get("t");
  const joinKey = params.get("k");
  const source = params.get("src") === "qr" || !!joinKey ? "qr" : "link";

  const [item, setItem] = useState<PublicItem | null>(null);
  const [from, setFrom] = useState<HTMLElement | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(() => location.hash === "#queue" && menu.queues.length > 0);
  const [bookOpen, setBookOpen] = useState(() => params.get("book") === "1" && !!menu.booking && menu.org.vertical !== "sweets");
  const [query, setQuery] = useState("");
  const design = designOf(menu.org.theme);
  const closedRef = useRef(new Map<number, string>());
  // The owner picks how the menu opens; a diner who switched keeps their own choice.
  // ?preview=1 is the owner's designer: no counting, and the owner's view, not a remembered one.
  const preview = params.get("preview") === "1";
  const [view, setView] = useState<View>(() => { if (preview) return design.view; try { const v = localStorage.getItem("mfy:view") as View | null; return v && VIEW_ORDER.includes(v) ? v : design.view; } catch { return design.view; } });
  const changeView = (v: View) => { setView(v); if (!preview) try { localStorage.setItem("mfy:view", v); } catch { /* ignore */ } };

  const cart = useCart();
  const cartCount = useMemo(() => priced(cart, menu.items).count, [cart, menu.items]);
  const v = vocab(menu.org.vertical);

  // A «خلص» pressed by the staff reaches open pages within a minute, and at
  // once when the phone wakes — without a stream per diner.
  const [items, setItems] = useState(menu.items);
  useEffect(() => {
    const url = `/api/public/m/${menu.org.slug}${menu.branch.slug === menu.branches[0]?.slug ? "" : `/${menu.branch.slug}`}`;
    const refresh = () => api<PublicMenu>(url).then((m) => setItems(m.items)).catch(() => {});
    const iv = setInterval(refresh, 60_000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [menu.org.slug, menu.branch.slug, menu.branches]);

  // «ادعُ صديقاً»: ?ref=<code> is kept for checkout, on this phone, for this shop.
  const [refCode] = useState(() => {
    const r = params.get("ref")?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
    try {
      if (r) { localStorage.setItem(`mfy:${menu.org.slug}:ref`, r); history.replaceState(null, "", location.pathname + location.hash); }
      return r || localStorage.getItem(`mfy:${menu.org.slug}:ref`) || "";
    } catch { return r; }
  });

  // The banner only promises a gift the code really gives; a stale code is forgotten.
  const [refOk, setRefOk] = useState(false);
  useEffect(() => {
    if (!refCode || !menu.referral) return;
    api<{ ok: boolean }>(`/api/public/referral/${menu.org.slug}/${refCode}`).then((r) => {
      setRefOk(r.ok);
      if (!r.ok) { try { localStorage.removeItem(`mfy:${menu.org.slug}:ref`); } catch { /* ignore */ } }
    }).catch(() => {});
  }, [refCode, menu.referral, menu.org.slug]);

  // «اطلب نفس الطلب»: ?reorder=<order token> puts that order back in the cart,
  // at today's prices, leaving out anything no longer available.
  useEffect(() => {
    const tok = params.get("reorder");
    if (!tok) return;
    history.replaceState(null, "", location.pathname + location.hash);
    api<PublicOrderView>(`/api/public/orders/${encodeURIComponent(tok)}`).then((o) => {
      if (o.org.slug !== menu.org.slug) return;
      const byId = new Map(menu.items.map((i) => [i.id, i]));
      let added = 0, missing = 0;
      for (const l of o.reorder ?? []) {
        if (byId.get(l.itemId)?.available) { addLine(l.itemId, l.qty, l.selections, l.note); added++; } else missing++;
      }
      if (added) setCartOpen(true);
      toast(added ? (missing ? t("reorderSome", lang) : t("reorderDone", lang)) : t("reorderNone", lang));
    }).catch(() => toast(t("reorderNone", lang)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!preview) initTrack(menu.org.slug, menu.branch.slug); }, [menu.org.slug, menu.branch.slug, preview]);
  useEffect(() => { if (cartOpen) track({ k: "cart" }); }, [cartOpen]);
  const open = useCallback((it: PublicItem, el: HTMLElement | null) => { setFrom(el); setItem(it); track({ k: "item", id: it.id }); }, []);
  const quickAdd = useCallback((it: PublicItem, el: HTMLElement) => { const why = closedRef.current.get(it.id); if (why) { toast(why); return; } addLine(it.id, 1, []); track({ k: "add", id: it.id }); flyToCart(el); navigator.vibrate?.(12); }, []);
  const addFromSheet = (it: PublicItem, qty: number, sel: Selection[], note: string | undefined, btn: HTMLElement) => {
    const why = closedRef.current.get(it.id); if (why) { toast(why); return; }
    addLine(it.id, qty, sel, note);
    track({ k: "add", id: it.id });
    flyToCart(btn);
    navigator.vibrate?.(12);
    setItem(null);
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => `${i.name} ${i.nameEn ?? ""} ${i.description ?? ""} ${i.descriptionEn ?? ""}`.toLowerCase().includes(q)) : items;
  // A section's picture: the one the owner set, or its first dish's photo.
  const imageOf = useCallback((catId: number, own: string | null): PublicImage | null => {
    if (own) return { url: own, sm: own, md: own };
    return items.find((i) => i.categoryId === catId && i.images[0])?.images[0] ?? null;
  }, [items]);
  // Sections with hours (breakfast, lunch) are read in the shop's own clock;
  // one not served now moves to the end and cannot be added to the cart.
  const [tick, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick((x) => x + 1), 60_000); return () => clearInterval(iv); }, []);
  const sections: SectionData[] = useMemo(() => {
    const now = localParts(menu.org.timezone);
    const out: SectionData[] = menu.categories.map((c) => {
      const h = c.hours ?? null;
      const hours = h?.from && h.to ? `${clock(h.from, lang)} – ${clock(h.to, lang)}` : null;
      return { id: c.id, title: pick(lang, c.name, c.nameEn), image: imageOf(c.id, c.imageUrl), items: filtered.filter((i) => i.categoryId === c.id), hours, closed: !sectionOpen(h, now.weekday, now.hour * 60 + now.minute) };
    });
    const loose = filtered.filter((i) => !i.categoryId || !menu.categories.some((c) => c.id === i.categoryId));
    if (loose.length) out.push({ id: -1, title: t("menu", lang), image: loose.find((i) => i.images[0])?.images[0] ?? null, items: loose, hours: null, closed: false });
    return out.filter((s) => s.items.length).sort((a, b) => Number(a.closed) - Number(b.closed));
  }, [menu.categories, menu.org.timezone, filtered, lang, imageOf, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const closedWhy = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sections) if (s.closed) for (const it of s.items) m.set(it.id, s.hours ? t("servedAt", lang).replace("{h}", s.hours) : t("notServedNow", lang));
    return m;
  }, [sections, lang]);
  closedRef.current = closedWhy;
  const blocked = useCallback((it: PublicItem) => closedWhy.get(it.id) ?? null, [closedWhy]);
  const featured = q ? [] : items.filter((i) => i.available && (i.tags.includes("popular") || i.tags.includes("chef"))).slice(0, 8);

  const bookingVisible = !!menu.booking && menu.org.vertical !== "sweets";
  const queueVisible = menu.queues.length > 0;
  const jump = (id: number) => {
    const el = document.getElementById(`cat-${id}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
  };

  return (
    <div className="min-h-dvh pb-44">
      {design.announcement && <Announcement a={design.announcement} lang={lang} />}
      <Hero menu={menu} lang={lang} style={design.hero} />

      <div className="px-4 mt-5 max-w-3xl mx-auto animate-rise" style={{ animationDelay: "220ms" }}>
        <label className="flex items-center gap-3 h-12 px-4 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          <Icon name="search" className="w-5 h-5 text-muted flex-shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search", lang)} enterKeyHint="search"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-[var(--muted)] min-w-0" />
          {query && <button onClick={() => setQuery("")} aria-label={t("close", lang)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}><Icon name="x" className="w-3.5 h-3.5" /></button>}
        </label>
      </div>

      {!q && (bookingVisible || queueVisible) && (
        <div className="px-4 mt-3 max-w-3xl mx-auto grid gap-2.5" style={{ gridTemplateColumns: bookingVisible && queueVisible ? "1fr 1fr" : "1fr" }}>
          {queueVisible && (
            <button onClick={() => setJoinOpen(true)} className="h-12 rounded-2xl font-bold flex items-center justify-center gap-2 animate-rise" style={{ background: "var(--brand-soft)", color: "var(--brand)", animationDelay: "260ms" }}>
              <Icon name="users" className="w-5 h-5" />{t("joinQueue", lang)}
            </button>
          )}
          {bookingVisible && (
            <button onClick={() => setBookOpen(true)} className="h-12 rounded-2xl font-bold flex items-center justify-center gap-2 animate-rise" style={{ background: "var(--surface)", border: "1px solid var(--line)", animationDelay: "300ms" }}>
              <Icon name="calendar" className="w-5 h-5 text-brand" />{v.bookCta[lang === "ar" ? 0 : 1]}
            </button>
          )}
        </div>
      )}

      {!q && menu.referral && refOk && (
        <div className="px-4 mt-4"><div className="rounded-2xl px-4 py-3 text-sm font-semibold animate-rise" style={{ background: "var(--brand-soft)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" }}>
          {t("refBanner", lang).replace("{pct}", String(menu.referral.friendPct))}
        </div></div>
      )}
      {!q && <Deals menu={menu} lang={lang} />}
      {!q && menu.gifts && <GiveGift menu={menu} lang={lang} />}
      {!q && <Offers menu={menu} lang={lang} onItem={(id) => { const it = items.find((x) => x.id === id); if (it) open(it, null); }} />}
      {!q && <CategoryTiles sections={sections} lang={lang} onPick={jump} />}
      <FeaturedRail items={featured} currency={menu.org.currency} lang={lang} onOpen={open} title={t("tag_popular", lang)} />

      <CategoryBar sections={sections} lang={lang} view={view} setView={changeView} />

      <main className="px-4 max-w-3xl mx-auto">
        {sections.length === 0 && <p className="text-center text-muted py-16">{t("noResults", lang)}</p>}
        {sections.map((s) => <Section key={s.id} s={s} lang={lang} view={view} currency={menu.org.currency} onOpen={open} onQuickAdd={quickAdd} />)}
      </main>

      <About menu={menu} lang={lang} />

      <ItemSheet item={item} from={from} currency={menu.org.currency} lang={lang} onClose={() => setItem(null)} onAdd={addFromSheet} blocked={blocked} />
      <CartSheet menu={{ ...menu, items }} lang={lang} open={cartOpen} onClose={() => setCartOpen(false)} table={table} />
      {queueVisible && <JoinSheet menu={menu} lang={lang} open={joinOpen} onClose={() => { setJoinOpen(false); if (location.hash) history.replaceState(null, "", location.pathname + location.search); }} joinKey={joinKey} source={source} />}
      {bookingVisible && <BookingSheet menu={menu} lang={lang} open={bookOpen} onClose={() => setBookOpen(false)} />}

      <CartBar menu={{ ...menu, items }} lang={lang} onOpen={() => setCartOpen(true)} lifted={queueVisible} />
      {queueVisible && <QueueFab menu={menu} lang={lang} onOpen={() => setJoinOpen(true)} cartVisible={cartCount > 0} />}
    </div>
  );
}

function Heading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="font-display text-[20px] flex items-center gap-2.5 mb-3">
      <span className="w-1.5 h-5 rounded-full" style={{ background: "var(--brand)" }} />
      {children}
      {count !== undefined && <span className="text-xs font-sans font-semibold text-muted tabular">({count})</span>}
    </h2>
  );
}

/** The sections as photo tiles: the first thing a diner reaches for. */
function CategoryTiles({ sections, lang, onPick }: { sections: SectionData[]; lang: Lang; onPick: (id: number) => void }) {
  if (sections.length < 2) return null;
  return (
    <section className="mt-7 max-w-3xl mx-auto">
      <div className="px-4"><Heading>{t("sections", lang)}</Heading></div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 pb-1">
        {sections.map((s, i) => (
          <button key={s.id} onClick={() => onPick(s.id)} className="flex-shrink-0 w-[104px] text-center animate-rise active:scale-95 transition-transform" style={{ animationDelay: `${160 + i * 50}ms` }}>
            <div className="relative w-[104px] h-[104px] rounded-[var(--radius)] overflow-hidden" style={{ border: "1px solid var(--line)" }}>
              <Img img={s.image} alt="" sizes="sm" className="w-full h-full" fallback={s.title} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.55), transparent 55%)" }} />
              <span className="absolute bottom-1.5 inset-x-0 text-[10px] font-bold tabular" style={{ color: "#fff" }}>{s.items.length}</span>
            </div>
            <span className="block mt-2 text-[13px] font-bold leading-tight line-clamp-1">{s.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Section({ s, lang, view, currency, onOpen, onQuickAdd }: {
  s: SectionData; lang: Lang; view: View; currency: string;
  onOpen: (it: PublicItem, el: HTMLElement | null) => void; onQuickAdd: (it: PublicItem, el: HTMLElement) => void;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id={`cat-${s.id}`} data-cat={s.id} className="pt-7 scroll-mt-[64px]">
      <div className="reveal relative h-[92px] rounded-[var(--radius)] overflow-hidden mb-3.5 flex items-end" style={{ border: "1px solid var(--line)" }}>
        {s.image ? <div className="absolute inset-0"><Img img={s.image} alt="" sizes="md" className="w-full h-full" /></div> : <div className="absolute inset-0" style={{ background: "radial-gradient(90% 140% at 85% 0%, var(--brand-soft), transparent 60%), var(--surface)" }} />}
        {s.image && <div className="absolute inset-0" style={{ background: `linear-gradient(to ${lang === "ar" ? "left" : "right"}, rgba(0,0,0,.85) 10%, rgba(0,0,0,.45) 60%, rgba(0,0,0,.15))` }} />}
        <div className="relative w-full px-4 pb-3 flex items-end justify-between" style={{ color: s.image ? "#fff" : "var(--text)" }}>
          <div className="min-w-0">
            <h2 className="font-display text-[24px] leading-none">{s.title}</h2>
            {s.hours && <p className="text-[12px] font-semibold mt-1.5 opacity-90 flex items-center gap-1"><Icon name="clock" className="w-3.5 h-3.5" />{s.hours}</p>}
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full tabular" style={{ background: "var(--brand)", color: "var(--brand-ink)" }}>{s.items.length}</span>
        </div>
      </div>
      {s.closed && (
        <p className="mb-3 px-4 py-2.5 rounded-2xl text-sm font-semibold flex items-center gap-2" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
          <Icon name="clock" className="w-4 h-4 flex-shrink-0" />{s.hours ? t("servedAt", lang).replace("{h}", s.hours) : t("notServedNow", lang)}
        </p>
      )}
      <div className={s.closed ? "opacity-60" : ""}>
      {view === "text" ? (
        <div className="rounded-[var(--radius)] px-4" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          {s.items.map((it, i) => <ItemLine key={it.id} item={it} i={i} currency={currency} lang={lang} onOpen={onOpen} onQuickAdd={onQuickAdd} />)}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {s.items.map((it, i) => <ItemCard key={it.id} item={it} i={i} currency={currency} lang={lang} onOpen={onOpen} onQuickAdd={onQuickAdd} />)}
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {s.items.map((it, i) => <ItemRow key={it.id} item={it} i={i} currency={currency} lang={lang} onOpen={onOpen} onQuickAdd={onQuickAdd} />)}
        </div>
      )}
      </div>
    </section>
  );
}

/** Sticky sections bar that follows the scroll, with a pill that slides to the one in view. */
function CategoryBar({ sections, lang, view, setView }: { sections: SectionData[]; lang: Lang; view: View; setView: (v: View) => void }) {
  const [active, setActive] = useState<number | null>(sections[0]?.id ?? null);
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const lock = useRef(0);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(`cat-${s.id}`)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver((es) => {
      if (Date.now() < lock.current) return;
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(Number((vis[0].target as HTMLElement).dataset.cat));
    }, { rootMargin: "-80px 0px -60% 0px", threshold: 0 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);

  useEffect(() => {
    const b = bar.current, p = pill.current;
    const btn = b?.querySelector<HTMLButtonElement>(`[data-id="${active}"]`);
    if (!b || !p || !btn) return;
    p.style.width = `${btn.offsetWidth}px`;
    p.style.transform = `translateX(${btn.offsetLeft}px)`;
    b.scrollTo({ left: btn.offsetLeft - b.clientWidth / 2 + btn.offsetWidth / 2, behavior: "smooth" });
  }, [active, sections, lang]);

  const jump = (id: number) => {
    setActive(id);
    lock.current = Date.now() + 900;
    const el = document.getElementById(`cat-${id}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
  };

  return (
    <div className="sticky top-0 z-30 mt-7 no-print" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: "1px solid var(--line)" }}>
      <div className="max-w-3xl mx-auto flex items-center gap-2 px-3 h-[58px]">
        <div ref={bar} className="relative flex-1 overflow-x-auto no-scrollbar" dir="ltr">
          <div className="relative inline-flex min-w-full gap-1 py-1" dir={lang === "ar" ? "rtl" : "ltr"}>
            <span ref={pill} aria-hidden className="absolute top-1 bottom-1 left-0 rounded-full transition-all duration-300" style={{ background: "var(--brand)", transitionTimingFunction: "var(--ease-out)" }} />
            {sections.map((s) => (
              <button key={s.id} data-id={s.id} onClick={() => jump(s.id)}
                className="relative z-10 h-9 px-4 rounded-full text-sm font-bold whitespace-nowrap transition-colors duration-300"
                style={{ color: active === s.id ? "var(--brand-ink)" : "var(--muted)" }}>{s.title}</button>
            ))}
          </div>
        </div>
        {(() => { const next = VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length]!; return (
        <button onClick={() => setView(next)} aria-label={t(next === "grid" ? "gridView" : next === "list" ? "listView" : "textView", lang)}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          <Icon name={next === "grid" ? "grid" : next === "list" ? "list" : "info"} className="w-[18px] h-[18px]" />
        </button>); })()}
      </div>
    </div>
  );
}

/** The owner's line of news at the very top: «مغلق يوم الجمعة للصيانة», «جديد: قهوة مختصة». */
function Announcement({ a, lang }: { a: { text: string; textEn: string | null; tone: "brand" | "warn" | "info" }; lang: Lang }) {
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem("mfy:ann") === a.text; } catch { return false; } });
  if (hidden) return null;
  const tone = a.tone === "warn" ? { background: "#f59e0b", color: "#1a1204" } : a.tone === "info" ? { background: "var(--surface-2)", color: "var(--text)" } : { background: "var(--brand)", color: "var(--brand-ink)" };
  return (
    <div className="relative z-40 px-4 py-2.5 text-center text-[13px] font-bold flex items-center justify-center gap-2" style={tone}>
      <span className="flex-1 leading-snug">{pick(lang, a.text, a.textEn)}</span>
      <button aria-label={t("close", lang)} onClick={() => { setHidden(true); try { sessionStorage.setItem("mfy:ann", a.text); } catch { /* ignore */ } }}
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,0,0,.12)" }}><Icon name="x" className="w-3 h-3" /></button>
    </div>
  );
}

/** «أهدِ بطاقة»: the customer asks the shop on WhatsApp; the shop takes payment and sends the card. */
function GiveGift({ menu, lang }: { menu: PublicMenu; lang: Lang }) {
  const phone = String(menu.branch.waPhone ?? "").replace(/\D/g, "");
  if (phone.length < 8) return null;
  const text = lang === "ar" ? "مرحباً، أبي بطاقة هدية من محلكم 🎁\nالقيمة: \nلـ (الاسم ورقم الواتساب): \nرسالتي له: " : "Hi, I'd like a gift card 🎁\nAmount: \nFor (name and WhatsApp number): \nMy message: ";
  return (
    <div className="px-4 mt-3">
      <a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
        className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
        <span className="text-2xl" aria-hidden>🎁</span>
        <div className="flex-1 min-w-0"><p className="font-bold">{t("giveGift", lang)}</p><p className="text-xs text-muted mt-0.5">{t("giveGiftSub", lang)}</p></div>
        <Icon name="wa" className="w-5 h-5" style={{ color: "#25D366" }} />
      </a>
    </div>
  );
}

/** Timed deals running now — «ساعة سعيدة: خصم 15% حتى 6 م». They apply by themselves in the cart. */
function Deals({ menu, lang }: { menu: PublicMenu; lang: Lang }) {
  if (!menu.deals?.length) return null;
  const fmtTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { hour: "numeric", minute: m ? "2-digit" : undefined, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h, m)));
  };
  return (
    <div className="px-4 mt-4 space-y-2">
      {menu.deals.map((d) => (
        <div key={d.id} className="rounded-2xl px-4 py-3 flex items-center gap-3 animate-rise" style={{ background: "var(--brand-soft)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" }}>
          <span className="text-2xl" aria-hidden>⏰</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold">{d.title} — <span style={{ color: "var(--brand)" }}>{d.label}</span></p>
            <p className="text-xs text-muted mt-0.5">
              {d.minSubtotal > 0 ? `${t("dealOver", lang)} ${d.minSubtotal} · ` : ""}{d.toTime ? `${t("dealUntil", lang)} ${fmtTime(d.toTime)} · ` : ""}{t("dealAuto", lang)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Offers({ menu, lang, onItem }: { menu: PublicMenu; lang: Lang; onItem: (id: number) => void }) {
  if (!menu.offers.length) return null;
  return (
    <section className="mt-7 max-w-3xl mx-auto">
      <div className="px-4"><Heading>{t("offers", lang)}</Heading></div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4 snap-x snap-mandatory scroll-px-4">
        {menu.offers.map((o, i) => {
          const linked = o.itemId ? menu.items.find((x) => x.id === o.itemId) : null;
          const img = o.imageUrl ?? linked?.images[0]?.md ?? linked?.images[0]?.url ?? null;
          return (
            <button key={o.id} onClick={() => o.itemId && onItem(o.itemId)} disabled={!o.itemId}
              className="snap-start flex-shrink-0 w-[86%] max-w-[400px] text-start rounded-[var(--radius)] overflow-hidden relative animate-rise"
              style={{ animationDelay: `${200 + i * 80}ms`, minHeight: 168, background: "var(--surface)", border: "1px solid var(--line)" }}>
              {img ? <><img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" /><div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.86) 12%, rgba(0,0,0,.25) 60%, rgba(0,0,0,.1))" }} /></>
                : <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 45%, var(--bg)))" }} />}
              <div className="relative p-4 flex flex-col justify-end" style={{ color: img ? "#fff" : "var(--brand-ink)", minHeight: 168 }}>
                <span className="self-start text-[11px] font-extrabold px-2.5 py-1 rounded-full mb-auto" style={{ background: "var(--brand)", color: "var(--brand-ink)" }}>{t("tag_offer", lang)}</span>
                <h3 className="font-display text-[21px] leading-tight mt-8">{pick(lang, o.title, o.titleEn)}</h3>
                {(o.body || o.bodyEn) && <p className="text-[13px] mt-1 opacity-90 line-clamp-2">{pick(lang, o.body, o.bodyEn)}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The shop itself: who they are, when they open, where they are, how to reach them. */
function About({ menu, lang }: { menu: PublicMenu; lang: Lang }) {
  const h = menu.branch.hours ?? {};
  const days = ["6", "0", "1", "2", "3", "4", "5"] as const;
  const has = days.some((d) => h[d]);
  const today = String(new Date().getDay());
  const socials = Object.entries(menu.org.socials ?? {});
  const card = { background: "var(--surface)", border: "1px solid var(--line)" };
  return (
    <footer className="mt-12 px-4 max-w-3xl mx-auto">
      <Heading>{t("about", lang)}</Heading>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[var(--radius)] p-5 md:col-span-2" style={card}>
          <div className="flex items-center gap-3.5">
            {menu.org.logoUrl ? <img src={menu.org.logoUrl} alt="" className="w-14 h-14 rounded-2xl object-cover" /> : null}
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight">{pick(lang, menu.org.name, menu.org.nameEn)}</p>
              {(menu.org.tagline || menu.org.taglineEn) && <p className="text-sm text-muted mt-0.5">{pick(lang, menu.org.tagline, menu.org.taglineEn)}</p>}
            </div>
          </div>
          {menu.org.about && lang === "ar" && <p className="text-sm text-muted leading-relaxed mt-3.5">{menu.org.about}</p>}
        </div>

        {has && (
          <div className="rounded-[var(--radius)] p-5" style={card}>
            <p className="font-bold mb-3 flex items-center gap-2"><Icon name="clock" className="w-[18px] h-[18px] text-brand" />{t("hours", lang)}</p>
            <dl className="space-y-1.5 text-sm">
              {days.filter((d) => h[d]).map((d) => (
                <div key={d} className="flex justify-between gap-2 px-2.5 py-1 rounded-lg" style={d === today ? { background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 700 } : undefined}>
                  <dt className={d === today ? "" : "text-muted"}>{DAYS[lang][Number(d)]}</dt>
                  <dd className="tabular" dir="ltr">{h[d]!.closed ? (lang === "ar" ? "مغلق" : "Closed") : `${h[d]!.open} – ${h[d]!.close}`}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="rounded-[var(--radius)] p-5 space-y-4" style={card}>
          <div>
            <p className="font-bold mb-2 flex items-center gap-2"><Icon name="pin" className="w-[18px] h-[18px] text-brand" />{t("location", lang)}</p>
            <p className="text-sm text-muted leading-relaxed">{pick(lang, menu.branch.name, menu.branch.nameEn)}{menu.branch.address ? ` — ${menu.branch.address}` : ""}</p>
            {menu.branches.length > 1 && <p className="text-xs text-muted mt-1">{t("branches", lang)}: {menu.branches.map((b) => pick(lang, b.name, b.nameEn)).join(lang === "ar" ? "، " : ", ")}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {menu.branch.mapUrl && <a href={menu.branch.mapUrl} target="_blank" rel="noreferrer" className="btn-brand h-10 px-4 text-sm flex items-center gap-2"><Icon name="map" className="w-4 h-4" />{t("directions", lang)}</a>}
            {menu.branch.displayPhone && <a href={`tel:${menu.branch.displayPhone.replace(/\s/g, "")}`} className="btn-ghost h-10 px-4 text-sm flex items-center gap-2"><Icon name="phone" className="w-4 h-4" />{t("call", lang)}</a>}
            {menu.branch.waPhone && <a href={`https://wa.me/${menu.branch.waPhone}`} target="_blank" rel="noreferrer" className="h-10 px-4 text-sm flex items-center gap-2 rounded-full font-semibold" style={{ background: "#25D366", color: "#fff" }}><Icon name="wa" className="w-4 h-4" />WhatsApp</a>}
          </div>
          {socials.length > 0 && (
            <div>
              <p className="text-xs text-muted mb-2">{t("follow", lang)}</p>
              <div className="flex gap-2 flex-wrap">
                {socials.map(([k, val]) => (
                  <a key={k} href={val.startsWith("http") ? val : k === "instagram" ? `https://instagram.com/${val.replace(/^@/, "")}` : k === "tiktok" ? `https://tiktok.com/@${val.replace(/^@/, "")}` : val}
                    target="_blank" rel="noreferrer" className="btn-ghost h-9 px-3.5 text-sm flex items-center capitalize">{k}</a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {menu.branding !== false && <a href="/" className="block text-center text-xs text-muted mt-7 mb-4 opacity-70">{lang === "ar" ? "مدعوم من" : "Powered by"} {t("poweredBy", lang)}</a>}
    </footer>
  );
}
