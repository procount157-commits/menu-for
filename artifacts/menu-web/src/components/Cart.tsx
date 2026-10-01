// ── The cart bar and the checkout sheet ───────────────────────────
// «أرسل الطلب على واتساب» creates the order on the server first (priced
// there), then opens WhatsApp with the order written out and its code. The
// order page the customer lands on shows whether the message arrived.

import { useEffect, useMemo, useState } from "react";
import { addDays, formatDayLabel, formatMoney, localDate, openWindow, zonedToUtc, type PublicMenu } from "@workspace/menu-shared";
import { Icon, Img, Sheet, Spinner, Stepper, toast } from "./ui";
import { clearCart, priced, setQty, useCart } from "@/lib/cart";
import { api, go, openWhatsApp, remember } from "@/lib/api";
import { pick, t, type Lang } from "@/lib/i18n";

export function CartBar({ menu, lang, onOpen, lifted }: { menu: PublicMenu; lang: Lang; onOpen: () => void; lifted: boolean }) {
  const cart = useCart();
  const p = useMemo(() => priced(cart, menu.items), [cart, menu.items]);
  const visible = p.count > 0;
  return (
    <div className={`fixed inset-x-0 z-40 px-4 transition-transform duration-500 no-print ${visible ? "translate-y-0" : "translate-y-[calc(100%+140px)]"}`}
      style={{ bottom: lifted ? 84 : 0, transitionTimingFunction: "var(--ease-spring)" }}>
      <div className="max-w-xl mx-auto safe-bottom">
        <button type="button" onClick={onOpen} className="btn-brand w-full h-14 px-5 flex items-center gap-3 text-[15px]" style={{ boxShadow: "var(--shadow)" }}>
          <span id="mfy-cart-target" className="relative w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,.14)" }}>
            <Icon name="cart" className="w-5 h-5" />
            <span className="absolute -top-1 -end-1 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center tabular" style={{ background: "var(--brand-ink)", color: "var(--brand)" }}>{p.count}</span>
          </span>
          <span className="flex-1 text-start">{t("viewCart", lang)}</span>
          <span className="tabular font-bold">{formatMoney(p.subtotal, menu.org.currency, lang)}</span>
        </button>
      </div>
    </div>
  );
}

type OrderType = "dine_in" | "pickup" | "delivery" | "preorder";

export function CartSheet({ menu, lang, open, onClose, table }: { menu: PublicMenu; lang: Lang; open: boolean; onClose: () => void; table: string | null }) {
  const cart = useCart();
  const p = useMemo(() => priced(cart, menu.items), [cart, menu.items]);
  const types = menu.ordering.types as OrderType[];
  const [type, setType] = useState<OrderType>(table && types.includes("dine_in") ? "dine_in" : types.includes("pickup") ? "pickup" : types[0]!);
  const [tableLabel, setTable] = useState(table ?? "");
  const [name, setName] = useState(() => { try { return localStorage.getItem("mfy:name") ?? ""; } catch { return ""; } });
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [day, setDay] = useState(() => addDays(localDate(menu.org.timezone), 1));
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const tz = menu.org.timezone;

  useEffect(() => { if (table) { setType("dine_in"); setTable(table); } }, [table]);

  // Pre-order times: every half hour inside the day's opening window.
  const times = useMemo(() => {
    const w = openWindow(menu.branch.hours ?? {}, tz, day);
    const out: string[] = [];
    const start = w?.start ?? zonedToUtc(tz, day, "10:00"), end = w?.end ?? zonedToUtc(tz, day, "22:00");
    for (let t0 = start.getTime(); t0 < end.getTime(); t0 += 30 * 60_000) if (t0 > Date.now() + 60 * 60_000) out.push(new Date(t0).toISOString());
    return out;
  }, [day, tz, menu.branch.hours]);
  useEffect(() => { if (time && !times.includes(time)) setTime(""); }, [times, time]);

  const ready = p.count > 0 && (type !== "delivery" || address.trim().length > 4) && (type !== "preorder" || !!time) && (type !== "dine_in" || true);
  const wa = !!menu.branch.waPhone;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try { localStorage.setItem("mfy:name", name.trim()); } catch { /* ignore */ }
    try {
      const r = await api<{ code: string; token: string; waLink: string | null }>("/api/public/orders", {
        json: {
          slug: menu.org.slug, branch: menu.branch.slug, lang, type,
          tableLabel: type === "dine_in" ? tableLabel : null, customerName: name.trim() || null,
          address: type === "delivery" ? address : null, notes: notes.trim() || null,
          scheduledFor: type === "preorder" ? time : null, marketingOptIn: optIn,
          lines: p.rows.map((row) => ({ itemId: row.line.itemId, qty: row.line.qty, selections: row.line.selections, note: row.line.note })),
        },
      });
      remember("order", menu.org.slug, r.token);
      clearCart();
      onClose();
      go(`/o/${r.token}`);
      if (r.waLink) setTimeout(() => openWhatsApp(r.waLink!), 120);
    } catch (e) {
      toast((e as Error).message);
    } finally { setBusy(false); }
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(localDate(tz), i));

  return (
    <Sheet open={open} onClose={onClose} label={t("cart", lang)}>
      <div className="px-5 pb-2 flex items-center justify-between">
        <h2 className="font-display text-2xl">{t("cart", lang)}</h2>
        <button onClick={onClose} aria-label={t("close", lang)} className="w-10 h-10 rounded-full btn-ghost flex items-center justify-center"><Icon name="x" className="w-5 h-5" /></button>
      </div>
      <div data-scroll className="overflow-y-auto px-5 pb-4">
        {p.rows.length === 0 && <p className="text-muted py-10 text-center">{t("emptyCart", lang)}</p>}
        <ul className="space-y-3">
          {p.rows.map(({ line, item, unit, total }) => (
            <li key={line.key} className="flex gap-3 items-center">
              {item.images[0] && <Img img={item.images[0]} alt="" sizes="sm" className="w-14 h-14 rounded-xl flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold leading-snug truncate">{pick(lang, item.name, item.nameEn)}</p>
                {line.selections.flatMap((s) => s.choices).length > 0 && (
                  <p className="text-xs text-muted truncate">{line.selections.flatMap((s) => s.choices).join(lang === "ar" ? "، " : ", ")}</p>
                )}
                {line.note && <p className="text-xs text-muted truncate">↳ {line.note}</p>}
                <p className="text-sm text-brand tabular mt-0.5">{formatMoney(total, menu.org.currency, lang)}{line.qty > 1 && <span className="text-muted text-xs"> · {formatMoney(unit, menu.org.currency, lang)}</span>}</p>
              </div>
              <Stepper size="sm" min={0} value={line.qty} onChange={(n) => setQty(line.key, n)} />
            </li>
          ))}
        </ul>

        {p.rows.length > 0 && (
          <div className="mt-6 space-y-5">
            {types.length > 1 && (
              <div>
                <p className="font-semibold text-sm mb-2">{t("orderType", lang)}</p>
                <div className="grid grid-cols-2 gap-2">
                  {types.map((x) => (
                    <button key={x} type="button" onClick={() => setType(x)} aria-pressed={type === x}
                      className="h-11 rounded-2xl text-sm font-semibold transition-colors"
                      style={{ background: type === x ? "var(--brand)" : "var(--surface-2)", color: type === x ? "var(--brand-ink)" : "var(--text)" }}>
                      {t(x, lang)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {type === "dine_in" && (
              <label className="block"><span className="font-semibold text-sm">{t("table", lang)}</span>
                <input className="field mt-2" inputMode="numeric" value={tableLabel} maxLength={10} onChange={(e) => setTable(e.target.value)} /></label>
            )}
            {type === "delivery" && (
              <label className="block"><span className="font-semibold text-sm">{t("address", lang)}</span>
                <textarea className="field mt-2" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("addressPh", lang)} /></label>
            )}
            {type === "preorder" && (
              <div>
                <p className="font-semibold text-sm mb-2">{t("when", lang)}</p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {days.map((d) => (
                    <button key={d} type="button" className="chip flex-shrink-0" aria-pressed={day === d} onClick={() => setDay(d)}>{formatDayLabel(d, tz, lang)}</button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2.5">
                  {times.map((x) => (
                    <button key={x} type="button" className="chip tabular" aria-pressed={time === x} onClick={() => setTime(x)}>
                      {new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(x))}
                    </button>
                  ))}
                  {times.length === 0 && <p className="col-span-4 text-sm text-muted">{t("noSlots", lang)}</p>}
                </div>
              </div>
            )}
            <label className="block"><span className="font-semibold text-sm">{t("name", lang)}</span>
              <input className="field mt-2" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("namePh", lang)} autoComplete="name" /></label>
            <label className="block"><span className="font-semibold text-sm">{t("notes", lang)}</span>
              <input className="field mt-2" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
            <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="w-5 h-5 accent-[var(--brand)]" />
              {t("offersOptIn", lang)}
            </label>
          </div>
        )}
      </div>
      {p.rows.length > 0 && (
        <div className="px-5 pt-3 safe-bottom border-t" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-center justify-between mb-3 text-[15px]">
            <span className="text-muted">{t("total", lang)}</span>
            <span className="font-bold tabular text-lg">{formatMoney(p.subtotal, menu.org.currency, lang)}</span>
          </div>
          <button type="button" disabled={!ready || busy} onClick={submit}
            className="btn-brand w-full h-14 flex items-center justify-center gap-2.5 text-[16px]"
            style={{ background: wa ? "#25D366" : undefined, color: wa ? "#fff" : undefined }}>
            {busy ? <Spinner /> : wa ? <Icon name="wa" className="w-5 h-5" /> : <Icon name="check" className="w-5 h-5" />}
            {wa ? t("sendOnWa", lang) : t("orderNoWa", lang)}
          </button>
        </div>
      )}
    </Sheet>
  );
}
