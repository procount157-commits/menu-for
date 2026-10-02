// ── Items: the cards, the featured rail, and the item sheet ───────

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, priceLine, type PublicItem, type Selection } from "@workspace/menu-shared";
import { Icon, Img, Sheet, Stepper } from "./ui";
import { pick, t, type Key, type Lang } from "@/lib/i18n";

const TAG_ICON: Record<string, "flame" | "leaf" | "star" | "sparkle" | undefined> = { spicy: "flame", vegetarian: "leaf", vegan: "leaf", chef: "star", new: "sparkle", popular: "star" };

export function Tags({ tags, lang, max = 3, solid = false }: { tags: string[]; lang: Lang; max?: number; solid?: boolean }) {
  const shown = tags.filter((x) => `tag_${x}` as Key).slice(0, max);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={solid
            ? { background: tag === "spicy" ? "var(--danger)" : "var(--brand)", color: tag === "spicy" ? "#fff" : "var(--brand-ink)" }
            : { background: tag === "spicy" ? "color-mix(in srgb, var(--danger) 15%, transparent)" : "var(--brand-soft)", color: tag === "spicy" ? "var(--danger)" : "var(--brand)" }}>
          {TAG_ICON[tag] && <Icon name={TAG_ICON[tag]!} className="w-3 h-3" strokeWidth={2} />}
          {t(`tag_${tag}` as Key, lang)}
        </span>
      ))}
    </div>
  );
}

function Price({ item, currency, lang, className = "" }: { item: PublicItem; currency: string; lang: Lang; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-2 tabular ${className}`}>
      <span className="font-extrabold">{formatMoney(item.price, currency, lang)}</span>
      {item.compareAtPrice && item.compareAtPrice > item.price && (
        <span className="text-xs text-muted line-through">{formatMoney(item.compareAtPrice, currency, lang)}</span>
      )}
    </span>
  );
}

/** A card in the grid: the photo first, the way a diner chooses. */
export function ItemCard({ item, i, currency, lang, onOpen, onQuickAdd }: {
  item: PublicItem; i: number; currency: string; lang: Lang;
  onOpen: (item: PublicItem, from: HTMLElement | null) => void;
  onQuickAdd: (item: PublicItem, from: HTMLElement) => void;
}) {
  const photo = useRef<HTMLDivElement>(null);
  const quick = item.options.length === 0 && item.available;
  const save = item.compareAtPrice && item.compareAtPrice > item.price ? Math.round((1 - item.price / item.compareAtPrice) * 100) : 0;
  return (
    <article className="reveal h-full" style={{ ["--i" as string]: i % 6 }}>
      <button type="button" onClick={() => onOpen(item, photo.current)}
        className={`w-full h-full text-start flex flex-col rounded-[20px] overflow-hidden transition-transform active:scale-[0.98] ${item.available ? "" : "opacity-60"}`}
        style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
        <div className="relative w-full">
          <Img img={item.images[0]} alt={pick(lang, item.name, item.nameEn)} sizes="md" imgRef={photo} className="w-full aspect-[4/3]" fallback={item.name} />
          <div className="absolute top-2 start-2"><Tags tags={item.tags} lang={lang} max={1} solid /></div>
          {save > 0 && <span className="absolute top-2 end-2 text-[11px] font-bold px-2 py-0.5 rounded-full tabular" style={{ background: "var(--danger)", color: "#fff" }}>-{save}%</span>}
          {!item.available && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,.55)" }}>
              <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: "var(--surface)", color: "var(--danger)" }}>{t("soldOut", lang)}</span>
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <h3 className="font-bold text-[15px] leading-snug line-clamp-1">{pick(lang, item.name, item.nameEn)}</h3>
          {(item.description || item.descriptionEn) && (
            <p className="text-[12px] text-muted mt-1 leading-relaxed line-clamp-2">{pick(lang, item.description, item.descriptionEn)}</p>
          )}
          {(item.calories || item.durationMin) ? (
            <p className="text-[11px] text-muted mt-1.5 flex items-center gap-2.5">
              {item.calories ? <span className="inline-flex items-center gap-1"><Icon name="flame" className="w-3 h-3" />{item.calories} {t("kcal", lang)}</span> : null}
              {item.durationMin ? <span className="inline-flex items-center gap-1"><Icon name="clock" className="w-3 h-3" />{item.durationMin} {t("minutes", lang)}</span> : null}
            </p>
          ) : null}
          <div className="mt-auto pt-2.5 flex items-center justify-between gap-2">
            <Price item={item} currency={currency} lang={lang} className="text-[15px] text-brand" />
            {item.available && <AddDot quick={quick} item={item} lang={lang} photo={photo} onOpen={onOpen} onQuickAdd={onQuickAdd} />}
          </div>
        </div>
      </button>
    </article>
  );
}

/** A row in a category: words on one side, the photo on the other. */
export function ItemRow({ item, i, currency, lang, onOpen, onQuickAdd }: {
  item: PublicItem; i: number; currency: string; lang: Lang;
  onOpen: (item: PublicItem, from: HTMLElement | null) => void;
  onQuickAdd: (item: PublicItem, from: HTMLElement) => void;
}) {
  const photo = useRef<HTMLDivElement>(null);
  const quick = item.options.length === 0 && item.available;
  return (
    <article className="reveal" style={{ ["--i" as string]: i % 8 }}>
      <button type="button" onClick={() => onOpen(item, photo.current)}
        className={`w-full text-start flex gap-4 p-3.5 rounded-[var(--radius)] transition-colors active:scale-[0.99] ${item.available ? "" : "opacity-55"}`}
        style={{ background: "var(--surface)" }}>
        <div className="flex-1 min-w-0 py-0.5">
          <h3 className="font-semibold text-[16px] leading-snug">{pick(lang, item.name, item.nameEn)}</h3>
          {(item.description || item.descriptionEn) && (
            <p className="text-[13px] text-muted mt-1 leading-relaxed line-clamp-2">{pick(lang, item.description, item.descriptionEn)}</p>
          )}
          <div className="mt-2"><Tags tags={item.tags} lang={lang} max={2} /></div>
          <div className="mt-2.5 flex items-center gap-2">
            {item.available ? <Price item={item} currency={currency} lang={lang} className="text-[15px] text-brand" />
              : <span className="text-xs font-semibold text-danger">{t("soldOut", lang)}</span>}
            {item.durationMin ? <span className="text-xs text-muted flex items-center gap-1"><Icon name="clock" className="w-3.5 h-3.5" />{item.durationMin} {t("minutes", lang)}</span> : null}
          </div>
        </div>
        <div className="relative flex-shrink-0">
          <Img img={item.images[0]} alt={pick(lang, item.name, item.nameEn)} sizes="sm" imgRef={photo}
            className="w-[108px] h-[108px] rounded-2xl" fallback={item.name} />
          {item.available && <AddDot quick={quick} item={item} lang={lang} photo={photo} onOpen={onOpen} onQuickAdd={onQuickAdd} className="absolute -bottom-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2" />}
        </div>
      </button>
    </article>
  );
}

function AddDot({ quick, item, lang, photo, onOpen, onQuickAdd, className = "" }: {
  quick: boolean; item: PublicItem; lang: Lang; photo: React.RefObject<HTMLDivElement | null>; className?: string;
  onOpen: (item: PublicItem, from: HTMLElement | null) => void; onQuickAdd: (item: PublicItem, from: HTMLElement) => void;
}) {
  return (
    <span role="button" tabIndex={0} aria-label={t("add", lang)}
      onClick={(e) => { e.stopPropagation(); quick ? onQuickAdd(item, e.currentTarget as HTMLElement) : onOpen(item, photo.current); }}
      className={`w-9 h-9 rounded-full flex items-center justify-center btn-brand ${className}`}
      style={{ boxShadow: "0 6px 16px -6px rgba(0,0,0,.5), 0 0 0 3px var(--surface)" }}>
      <Icon name="plus" className="w-[18px] h-[18px]" strokeWidth={2.4} />
    </span>
  );
}

/** Big cards in a horizontal rail, for what the shop is proudest of. */
export function FeaturedRail({ items, currency, lang, onOpen, title }: {
  items: PublicItem[]; currency: string; lang: Lang; title: string;
  onOpen: (item: PublicItem, from: HTMLElement | null) => void;
}) {
  if (items.length < 2) return null;
  return (
    <section className="mt-8">
      <h2 className="px-5 font-display text-xl mb-3 max-w-3xl mx-auto">{title}</h2>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 pb-2 snap-x snap-mandatory scroll-px-5 max-w-3xl mx-auto">
        {items.map((it, i) => <FeaturedCard key={it.id} item={it} i={i} currency={currency} lang={lang} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function FeaturedCard({ item, i, currency, lang, onOpen }: { item: PublicItem; i: number; currency: string; lang: Lang; onOpen: (item: PublicItem, from: HTMLElement | null) => void }) {
  const photo = useRef<HTMLDivElement>(null);
  return (
    <button type="button" onClick={() => onOpen(item, photo.current)}
      className="snap-start flex-shrink-0 w-[240px] text-start rounded-[22px] overflow-hidden animate-rise active:scale-[0.98] transition-transform"
      style={{ background: "var(--surface)", animationDelay: `${120 + i * 60}ms` }}>
      <div className="relative">
        <Img img={item.images[0]} alt={pick(lang, item.name, item.nameEn)} imgRef={photo} className="w-full aspect-[4/3]" fallback={item.name} />
        <div className="absolute top-2.5 start-2.5"><Tags tags={item.tags} lang={lang} max={1} solid /></div>
      </div>
      <div className="p-3.5">
        <h3 className="font-semibold leading-snug line-clamp-1">{pick(lang, item.name, item.nameEn)}</h3>
        <div className="mt-1.5 text-brand"><Price item={item} currency={currency} lang={lang} /></div>
      </div>
    </button>
  );
}

// ── The item sheet ────────────────────────────────────────────────

export function ItemSheet({ item, from, currency, lang, onClose, onAdd }: {
  item: PublicItem | null; from: HTMLElement | null; currency: string; lang: Lang;
  onClose: () => void;
  onAdd: (item: PublicItem, qty: number, selections: Selection[], note: string | undefined, button: HTMLElement) => void;
}) {
  const [qty, setQty] = useState(1);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const [shown, setShown] = useState<PublicItem | null>(item);
  const hero = useRef<HTMLDivElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!item) return;
    setShown(item); setQty(1); setNote("");
    // Preselect the first choice of every required single-choice group.
    const init: Record<string, string[]> = {};
    for (const g of item.options) if (g.required && g.max === 1 && g.choices[0]) init[g.name] = [g.choices[0].name];
    setPicked(init);
  }, [item]);

  // The photo grows out of the card it was tapped on (FLIP).
  useEffect(() => {
    if (!item || !from || !hero.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = from.getBoundingClientRect();
    const el = hero.current;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const b = el.getBoundingClientRect();
      if (!b.width || !a.width) return;
      el.animate([
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, borderRadius: "16px", opacity: 0.6 },
        { transform: "none", borderRadius: "20px", opacity: 1 },
      ], { duration: 460, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }));
  }, [item, from]);

  const it = shown;
  const selections: Selection[] = useMemo(() => Object.entries(picked).map(([group, choices]) => ({ group, choices })), [picked]);
  const r = it ? priceLine({ id: it.id, name: it.name, price: it.price, options: it.options }, { itemId: it.id, qty, selections }) : null;
  const missing = it?.options.find((g) => {
    const n = (picked[g.name] ?? []).length;
    return n < Math.max(g.required ? 1 : 0, g.min || 0);
  });

  const toggle = (group: string, choice: string, max: number) => {
    setPicked((p) => {
      const cur = p[group] ?? [];
      if (max === 1) return { ...p, [group]: cur[0] === choice ? (it!.options.find((g) => g.name === group)!.required ? cur : []) : [choice] };
      if (cur.includes(choice)) return { ...p, [group]: cur.filter((c) => c !== choice) };
      if (max > 0 && cur.length >= max) return p;
      return { ...p, [group]: [...cur, choice] };
    });
  };

  return (
    <Sheet open={!!item} onClose={onClose} label={it ? pick(lang, it.name, it.nameEn) : ""}>
      {it && (
        <>
          <div data-scroll className="overflow-y-auto px-5 pb-4">
            {it.images[0] && (
              <div ref={hero} className="origin-top-left">
                <Img img={it.images[0]} alt={pick(lang, it.name, it.nameEn)} sizes="lg" eager className="w-full aspect-[4/3] rounded-[20px]" />
              </div>
            )}
            {it.images.length > 1 && (
              <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">
                {it.images.slice(1).map((im, n) => <Img key={n} img={im} alt="" sizes="sm" className="w-16 h-16 rounded-xl flex-shrink-0" />)}
              </div>
            )}
            <div className={`${it.images[0] ? "mt-4" : "mt-2"} flex items-start justify-between gap-3`}>
              <h2 className="font-display text-2xl leading-tight">{pick(lang, it.name, it.nameEn)}</h2>
              <Price item={it} currency={currency} lang={lang} className="text-lg text-brand pt-1 flex-shrink-0" />
            </div>
            <div className="mt-2"><Tags tags={it.tags} lang={lang} max={4} /></div>
            {(it.description || it.descriptionEn) && <p className="text-muted mt-3 leading-relaxed">{pick(lang, it.description, it.descriptionEn)}</p>}
            {(it.calories || it.durationMin || it.allergens.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
                {it.calories ? (
                  <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full" style={{ background: "var(--surface-2)" }}>
                    <Icon name="flame" className="w-4 h-4 text-brand" /><b className="tabular">{it.calories}</b><span className="text-muted">{t("kcal", lang)}</span>
                  </span>
                ) : null}
                {it.durationMin ? (
                  <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full" style={{ background: "var(--surface-2)" }}>
                    <Icon name="clock" className="w-4 h-4 text-brand" /><b className="tabular">{it.durationMin}</b><span className="text-muted">{t("minutes", lang)}</span>
                  </span>
                ) : null}
                {it.allergens.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 min-h-9 px-3 py-1.5 rounded-full" style={{ background: "var(--surface-2)" }}>
                    <Icon name="info" className="w-4 h-4 text-brand flex-shrink-0" /><span className="text-muted">{t("contains", lang)}:</span><b>{it.allergens.join(lang === "ar" ? "، " : ", ")}</b>
                  </span>
                )}
              </div>
            )}

            {it.options.map((g) => {
              const max = g.max > 0 ? g.max : g.choices.length;
              const cur = picked[g.name] ?? [];
              return (
                <fieldset key={g.name} className="mt-6">
                  <legend className="w-full flex items-center justify-between mb-2.5">
                    <span className="font-semibold">{pick(lang, g.name, g.nameEn)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: g.required ? "var(--brand-soft)" : "var(--surface-2)", color: g.required ? "var(--brand)" : "var(--muted)" }}>
                      {g.required ? t("required", lang) : max > 1 ? `${t("chooseUpTo", lang)} ${max}` : t("optional", lang)}
                    </span>
                  </legend>
                  <div className="space-y-2">
                    {g.choices.map((c) => {
                      const on = cur.includes(c.name);
                      return (
                        <button key={c.name} type="button" onClick={() => toggle(g.name, c.name, max)}
                          className="w-full flex items-center gap-3 p-3.5 rounded-2xl transition-colors text-start"
                          style={{ background: on ? "var(--brand-soft)" : "var(--surface-2)", outline: on ? "1.5px solid var(--brand)" : "1px solid transparent" }}>
                          <span className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${max === 1 ? "rounded-full" : "rounded-md"}`}
                            style={{ border: `2px solid ${on ? "var(--brand)" : "var(--muted)"}`, background: on ? "var(--brand)" : "transparent", color: "var(--brand-ink)" }}>
                            {on && <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />}
                          </span>
                          <span className="flex-1">{pick(lang, c.name, c.nameEn)}</span>
                          {c.priceDelta !== 0 && <span className="text-sm text-muted tabular">{c.priceDelta > 0 ? "+" : ""}{formatMoney(c.priceDelta, currency, lang)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}

            {it.available && it.kind === "product" && (
              <label className="block mt-6">
                <span className="font-semibold text-sm">{t("note", lang)}</span>
                <input className="field mt-2" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t("notePh", lang)} />
              </label>
            )}
          </div>

          {it.available ? (
            <div className="px-5 pt-3 safe-bottom border-t flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
              <Stepper value={qty} onChange={setQty} />
              <button ref={addBtn} type="button" disabled={!!missing || !r?.ok}
                onClick={() => onAdd(it, qty, selections, note.trim() || undefined, addBtn.current!)}
                className="btn-brand flex-1 h-12 px-5 flex items-center justify-between text-[15px]">
                <span>{missing ? `${t("required", lang)}: ${pick(lang, missing.name, missing.nameEn)}` : t("addToCart", lang)}</span>
                {r?.ok && !missing && <span className="tabular">{formatMoney(r.line.lineTotal, currency, lang)}</span>}
              </button>
            </div>
          ) : (
            <div className="px-5 pt-3 safe-bottom"><div className="h-12 rounded-full flex items-center justify-center text-danger font-semibold" style={{ background: "var(--surface-2)" }}>{t("soldOut", lang)}</div></div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** A dot that flies from the button to the cart, with a little arc. */
export function flyToCart(from: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = document.getElementById("mfy-cart-target");
  const a = from.getBoundingClientRect();
  const b = target?.getBoundingClientRect() ?? { left: window.innerWidth / 2, top: window.innerHeight - 40, width: 0, height: 0 } as DOMRect;
  const dot = document.createElement("div");
  dot.className = "fly-dot";
  document.body.appendChild(dot);
  const x0 = a.left + a.width / 2 - 9, y0 = a.top + a.height / 2 - 9;
  const x1 = b.left + b.width / 2 - 9, y1 = b.top + b.height / 2 - 9;
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 120;
  dot.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(1)` },
    { transform: `translate(${mx}px, ${my}px) scale(1.15)`, offset: 0.45 },
    { transform: `translate(${x1}px, ${y1}px) scale(0.5)`, opacity: 0.6 },
  ], { duration: 650, easing: "cubic-bezier(0.5, 0, 0.3, 1)" }).onfinish = () => {
    dot.remove();
    target?.classList.remove("animate-pop");
    void (target as HTMLElement | undefined)?.offsetWidth;
    target?.classList.add("animate-pop");
  };
}
