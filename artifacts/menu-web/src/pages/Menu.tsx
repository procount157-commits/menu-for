// ── The menu ──────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, vocab, type PublicItem, type PublicMenu, type Selection } from "@workspace/menu-shared";
import { Hero } from "@/components/Hero";
import { FeaturedRail, ItemRow, ItemSheet, flyToCart } from "@/components/Items";
import { CartBar, CartSheet } from "@/components/Cart";
import { QueueFab, JoinSheet } from "@/components/Queue";
import { BookingSheet } from "@/components/Booking";
import { Icon, Img, useReveal } from "@/components/ui";
import { addLine, initCart, priced, useCart } from "@/lib/cart";
import { pick, t, useLang, type Lang } from "@/lib/i18n";
import { api } from "@/lib/api";

const DAYS = { ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };

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
  const [searching, setSearching] = useState(false);

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

  const open = useCallback((it: PublicItem, el: HTMLElement | null) => { setFrom(el); setItem(it); }, []);
  const quickAdd = useCallback((it: PublicItem, el: HTMLElement) => { addLine(it.id, 1, []); flyToCart(el); navigator.vibrate?.(12); }, []);
  const addFromSheet = (it: PublicItem, qty: number, sel: Selection[], note: string | undefined, btn: HTMLElement) => {
    addLine(it.id, qty, sel, note);
    flyToCart(btn);
    navigator.vibrate?.(12);
    setItem(null);
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => `${i.name} ${i.nameEn ?? ""} ${i.description ?? ""} ${i.descriptionEn ?? ""}`.toLowerCase().includes(q)) : items;
  const sections = useMemo(() => {
    const out = menu.categories.map((c) => ({ id: c.id, title: pick(lang, c.name, c.nameEn), image: c.imageUrl, items: filtered.filter((i) => i.categoryId === c.id) }));
    const loose = filtered.filter((i) => !i.categoryId || !menu.categories.some((c) => c.id === i.categoryId));
    if (loose.length) out.push({ id: -1, title: t("menu", lang), image: null, items: loose });
    return out.filter((s) => s.items.length);
  }, [menu.categories, filtered, lang]);
  const featured = q ? [] : items.filter((i) => i.available && (i.tags.includes("popular") || i.tags.includes("chef"))).slice(0, 8);

  const bookingVisible = !!menu.booking && menu.org.vertical !== "sweets";
  const queueVisible = menu.queues.length > 0;

  return (
    <div className="min-h-dvh pb-40">
      <Hero menu={menu} lang={lang} />

      {(bookingVisible || (menu.queues.length > 0)) && (
        <div className="px-5 mt-5 max-w-3xl mx-auto grid gap-2.5" style={{ gridTemplateColumns: bookingVisible && queueVisible ? "1fr 1fr" : "1fr" }}>
          {queueVisible && (
            <button onClick={() => setJoinOpen(true)} className="h-12 rounded-2xl font-semibold flex items-center justify-center gap-2 animate-rise" style={{ background: "var(--brand-soft)", color: "var(--brand)", animationDelay: "240ms" }}>
              <Icon name="users" className="w-5 h-5" />{t("joinQueue", lang)}
            </button>
          )}
          {bookingVisible && (
            <button onClick={() => setBookOpen(true)} className="h-12 rounded-2xl font-semibold flex items-center justify-center gap-2 animate-rise" style={{ background: "var(--surface-2)", animationDelay: "280ms" }}>
              <Icon name="calendar" className="w-5 h-5 text-brand" />{v.bookCta[lang === "ar" ? 0 : 1]}
            </button>
          )}
        </div>
      )}

      <Offers menu={menu} lang={lang} onItem={(id) => { const it = items.find((x) => x.id === id); if (it) open(it, null); }} />
      <FeaturedRail items={featured} currency={menu.org.currency} lang={lang} onOpen={open} title={t("tag_popular", lang)} />

      <CategoryBar sections={sections} lang={lang} searching={searching} setSearching={setSearching} query={query} setQuery={setQuery} />

      <main className="px-4 max-w-3xl mx-auto">
        {sections.length === 0 && <p className="text-center text-muted py-16">{t("noResults", lang)}</p>}
        {sections.map((s) => <Section key={s.id} s={s} lang={lang} currency={menu.org.currency} onOpen={open} onQuickAdd={quickAdd} />)}
      </main>

      <Footer menu={menu} lang={lang} />

      <ItemSheet item={item} from={from} currency={menu.org.currency} lang={lang} onClose={() => setItem(null)} onAdd={addFromSheet} />
      <CartSheet menu={{ ...menu, items }} lang={lang} open={cartOpen} onClose={() => setCartOpen(false)} table={table} />
      {queueVisible && <JoinSheet menu={menu} lang={lang} open={joinOpen} onClose={() => { setJoinOpen(false); if (location.hash) history.replaceState(null, "", location.pathname + location.search); }} joinKey={joinKey} source={source} />}
      {bookingVisible && <BookingSheet menu={menu} lang={lang} open={bookOpen} onClose={() => setBookOpen(false)} />}

      <CartBar menu={{ ...menu, items }} lang={lang} onOpen={() => setCartOpen(true)} lifted={queueVisible} />
      {queueVisible && <QueueFab menu={menu} lang={lang} onOpen={() => setJoinOpen(true)} cartVisible={cartCount > 0} />}
    </div>
  );
}

function Section({ s, lang, currency, onOpen, onQuickAdd }: {
  s: { id: number; title: string; image: string | null; items: PublicItem[] }; lang: Lang; currency: string;
  onOpen: (it: PublicItem, el: HTMLElement | null) => void; onQuickAdd: (it: PublicItem, el: HTMLElement) => void;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} id={`cat-${s.id}`} data-cat={s.id} className="pt-7 scroll-mt-[72px]">
      <h2 className="font-display text-[22px] px-1 mb-3 reveal flex items-center gap-3">
        {s.title}
        <span className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="text-xs text-muted font-sans tabular">{s.items.length}</span>
      </h2>
      <div className="grid gap-2.5 md:grid-cols-2">
        {s.items.map((it, i) => <ItemRow key={it.id} item={it} i={i} currency={currency} lang={lang} onOpen={onOpen} onQuickAdd={onQuickAdd} />)}
      </div>
    </section>
  );
}

/** Sticky categories that follow the scroll, with a pill that slides to the active one. */
function CategoryBar({ sections, lang, searching, setSearching, query, setQuery }: {
  sections: Array<{ id: number; title: string }>; lang: Lang;
  searching: boolean; setSearching: (b: boolean) => void; query: string; setQuery: (s: string) => void;
}) {
  const [active, setActive] = useState<number | null>(sections[0]?.id ?? null);
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const lock = useRef(0);
  const input = useRef<HTMLInputElement>(null);

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
    const target = btn.offsetLeft - b.clientWidth / 2 + btn.offsetWidth / 2;
    b.scrollTo({ left: target, behavior: "smooth" });
  }, [active, sections, lang]);

  useEffect(() => { if (searching) input.current?.focus(); }, [searching]);

  const jump = (id: number) => {
    setActive(id);
    lock.current = Date.now() + 900;
    const el = document.getElementById(`cat-${id}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
  };

  return (
    <div className="sticky top-0 z-30 mt-6 no-print" style={{ background: "color-mix(in srgb, var(--bg) 86%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: "1px solid var(--line)" }}>
      <div className="max-w-3xl mx-auto flex items-center gap-2 px-3 h-[60px]">
        {searching ? (
          <div className="flex-1 flex items-center gap-2 animate-fade">
            <Icon name="search" className="w-5 h-5 text-muted flex-shrink-0" />
            <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search", lang)}
              className="flex-1 bg-transparent outline-none text-[16px] placeholder:text-[var(--muted)]" />
            <button onClick={() => { setQuery(""); setSearching(false); }} className="w-9 h-9 rounded-full btn-ghost flex items-center justify-center" aria-label={t("close", lang)}><Icon name="x" className="w-4 h-4" /></button>
          </div>
        ) : (
          <>
            <button onClick={() => setSearching(true)} className="w-10 h-10 rounded-full btn-ghost flex items-center justify-center flex-shrink-0" aria-label={t("search", lang)}><Icon name="search" className="w-[18px] h-[18px]" /></button>
            <div ref={bar} className="relative flex-1 overflow-x-auto no-scrollbar" dir="ltr">
              <div className="relative inline-flex min-w-full gap-1 py-1" dir={lang === "ar" ? "rtl" : "ltr"}>
                <span ref={pill} aria-hidden className="absolute top-1 bottom-1 left-0 rounded-full transition-all duration-300" style={{ background: "var(--brand)", transitionTimingFunction: "var(--ease-out)" }} />
                {sections.map((s) => (
                  <button key={s.id} data-id={s.id} onClick={() => jump(s.id)}
                    className="relative z-10 h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition-colors duration-300"
                    style={{ color: active === s.id ? "var(--brand-ink)" : "var(--muted)" }}>{s.title}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Offers({ menu, lang, onItem }: { menu: PublicMenu; lang: Lang; onItem: (id: number) => void }) {
  if (!menu.offers.length) return null;
  return (
    <section className="mt-7">
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 snap-x snap-mandatory scroll-px-5 max-w-3xl mx-auto">
        {menu.offers.map((o, i) => (
          <button key={o.id} onClick={() => o.itemId && onItem(o.itemId)} disabled={!o.itemId}
            className="snap-start flex-shrink-0 w-[82%] max-w-[380px] text-start rounded-[22px] overflow-hidden relative animate-rise"
            style={{ animationDelay: `${200 + i * 80}ms`, background: o.imageUrl ? "var(--surface)" : "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, var(--bg)))", minHeight: 132 }}>
            {o.imageUrl && <><img src={o.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" /><div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.75), rgba(0,0,0,.1))" }} /></>}
            <div className="relative p-5 h-full flex flex-col justify-end" style={{ color: o.imageUrl ? "#fff" : "var(--brand-ink)", minHeight: 132 }}>
              <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">{t("offers", lang)}</span>
              <h3 className="font-display text-xl leading-tight mt-1">{pick(lang, o.title, o.titleEn)}</h3>
              {(o.body || o.bodyEn) && <p className="text-sm mt-1 opacity-90 line-clamp-2">{pick(lang, o.body, o.bodyEn)}</p>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function Footer({ menu, lang }: { menu: PublicMenu; lang: Lang }) {
  const h = menu.branch.hours ?? {};
  const days = ["6", "0", "1", "2", "3", "4", "5"] as const;
  const has = days.some((d) => h[d]);
  return (
    <footer className="mt-14 px-5 max-w-3xl mx-auto">
      <div className="rounded-[var(--radius)] p-5 space-y-4" style={{ background: "var(--surface)" }}>
        <div className="flex items-center gap-3">
          {menu.org.logoUrl ? <Img img={{ url: menu.org.logoUrl }} alt="" className="w-11 h-11 rounded-xl" /> : null}
          <div>
            <p className="font-semibold">{pick(lang, menu.org.name, menu.org.nameEn)}</p>
            <p className="text-sm text-muted">{pick(lang, menu.branch.name, menu.branch.nameEn)}{menu.branch.address ? ` · ${menu.branch.address}` : ""}</p>
          </div>
        </div>
        {menu.org.about && lang === "ar" && <p className="text-sm text-muted leading-relaxed">{menu.org.about}</p>}
        {has && (
          <div>
            <p className="text-sm font-semibold mb-2 flex items-center gap-2"><Icon name="clock" className="w-4 h-4 text-brand" />{t("hours", lang)}</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {days.filter((d) => h[d]).map((d) => (
                <div key={d} className="flex justify-between gap-2"><dt className="text-muted">{DAYS[lang][Number(d)]}</dt>
                  <dd className="tabular" dir="ltr">{h[d]!.closed ? (lang === "ar" ? "مغلق" : "Closed") : `${h[d]!.open} – ${h[d]!.close}`}</dd></div>
              ))}
            </dl>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          {menu.branch.mapUrl && <a href={menu.branch.mapUrl} target="_blank" rel="noreferrer" className="btn-ghost h-10 px-4 text-sm flex items-center gap-2"><Icon name="map" className="w-4 h-4" />{t("directions", lang)}</a>}
          {menu.branch.displayPhone && <a href={`tel:${menu.branch.displayPhone.replace(/\s/g, "")}`} className="btn-ghost h-10 px-4 text-sm flex items-center gap-2"><Icon name="phone" className="w-4 h-4" />{t("call", lang)}</a>}
          {menu.branch.waPhone && <a href={`https://wa.me/${menu.branch.waPhone}`} target="_blank" rel="noreferrer" className="btn-ghost h-10 px-4 text-sm flex items-center gap-2"><Icon name="wa" className="w-4 h-4" />WhatsApp</a>}
        </div>
      </div>
      <p className="text-center text-xs text-muted mt-6 mb-4 opacity-70">{t("poweredBy", lang)}</p>
      <span className="hidden">{formatMoney(0, menu.org.currency)}</span>
    </footer>
  );
}
