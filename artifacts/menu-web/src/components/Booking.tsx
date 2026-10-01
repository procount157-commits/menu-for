// ── Booking a table or an appointment ─────────────────────────────

import { useEffect, useState } from "react";
import { addDays, formatDayLabel, localDate, vocab, type PublicMenu, type Slot } from "@workspace/menu-shared";
import { Icon, Sheet, Spinner, Stepper, toast } from "./ui";
import { api, go, openWhatsApp, remember } from "@/lib/api";
import { pick, t, type Lang } from "@/lib/i18n";

export function BookingSheet({ menu, lang, open, onClose }: { menu: PublicMenu; lang: Lang; open: boolean; onClose: () => void }) {
  const b = menu.booking!;
  const tz = menu.org.timezone;
  const v = vocab(menu.org.vertical);
  const services = menu.items.filter((i) => i.kind === "service" && i.available);
  const [day, setDay] = useState(() => localDate(tz));
  const [party, setParty] = useState(2);
  const [service, setService] = useState<number | null>(services[0]?.id ?? null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState(() => { try { return localStorage.getItem("mfy:name") ?? ""; } catch { return ""; } });
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState<"wa" | "plain" | null>(null);

  useEffect(() => {
    if (!open) return;
    let off = false;
    setSlots(null); setSlot(null);
    const qs = new URLSearchParams({ slug: menu.org.slug, branch: menu.branch.slug, date: day, party: String(party), ...(b.services && service ? { item: String(service) } : {}) });
    api<{ slots: Slot[] }>(`/api/public/bookings/slots?${qs}`).then((r) => !off && setSlots(r.slots)).catch(() => !off && setSlots([]));
    return () => { off = true; };
  }, [open, day, party, service, menu.org.slug, menu.branch.slug, b.services]);

  const days = Array.from({ length: Math.min(14, b.maxDaysAhead + 1) }, (_, i) => addDays(localDate(tz), i));
  const fmt = (iso: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const hasWa = !!menu.branch.waPhone;

  const submit = async (withWa: boolean) => {
    if (!slot || !name.trim()) { toast(!slot ? t("time", lang) : t("namePh", lang)); return; }
    setBusy(withWa ? "wa" : "plain");
    try { localStorage.setItem("mfy:name", name.trim()); } catch { /* ignore */ }
    try {
      const r = await api<{ token: string; waLink: string | null }>("/api/public/bookings", {
        json: { slug: menu.org.slug, branch: menu.branch.slug, startsAt: slot, customerName: name.trim(), phone: phone.trim() || null, partySize: party, itemId: b.services ? service : null, notes: notes.trim() || null, marketingOptIn: optIn },
      });
      remember("booking", menu.org.slug, r.token);
      onClose();
      go(`/b/${r.token}`);
      if (withWa && r.waLink) setTimeout(() => openWhatsApp(r.waLink!), 150);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <Sheet open={open} onClose={onClose} label={v.booking[lang === "ar" ? 0 : 1]}>
      <div data-scroll className="overflow-y-auto px-5 pb-4">
        <div className="flex items-center gap-4 py-2">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Icon name="calendar" className="w-7 h-7" /></div>
          <h2 className="font-display text-2xl">{v.bookCta[lang === "ar" ? 0 : 1]}</h2>
        </div>

        {b.services && services.length > 0 && (
          <div className="mt-4">
            <p className="font-semibold text-sm mb-2">{t("service", lang)}</p>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => <button key={s.id} className="chip" aria-pressed={service === s.id} onClick={() => setService(s.id)}>{pick(lang, s.name, s.nameEn)}{s.durationMin ? ` · ${s.durationMin}′` : ""}</button>)}
            </div>
          </div>
        )}
        {!b.services && (
          <div className="mt-4 flex items-center justify-between">
            <span className="font-semibold text-sm">{t("partySize", lang)}</span>
            <Stepper value={party} onChange={setParty} max={b.maxParty} />
          </div>
        )}
        <div className="mt-5">
          <p className="font-semibold text-sm mb-2">{t("date", lang)}</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
            {days.map((d) => <button key={d} className="chip flex-shrink-0" aria-pressed={day === d} onClick={() => setDay(d)}>{formatDayLabel(d, tz, lang)}</button>)}
          </div>
        </div>
        <div className="mt-4">
          <p className="font-semibold text-sm mb-2">{t("time", lang)}</p>
          {slots === null ? (
            <div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 rounded-full skeleton" />)}</div>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted py-2">{t("noSlots", lang)}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => <button key={s.start} className="chip tabular" aria-pressed={slot === s.start} onClick={() => setSlot(s.start)}>{fmt(s.start)}</button>)}
            </div>
          )}
        </div>
        {slot && (
          <div className="mt-5 space-y-4 animate-rise">
            <label className="block"><span className="font-semibold text-sm">{t("name", lang)}</span>
              <input className="field mt-2" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("namePh", lang)} autoComplete="name" /></label>
            <label className="block"><span className="font-semibold text-sm">{t("phone", lang)}</span>
              <input className="field mt-2 tabular" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("phonePh", lang)} autoComplete="tel" /></label>
            <label className="block"><span className="font-semibold text-sm">{t("notes", lang)}</span>
              <input className="field mt-2" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
            <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="w-5 h-5 accent-[var(--brand)]" />
              {t("offersOptIn", lang)}
            </label>
          </div>
        )}
      </div>
      {slot && (
        <div className="px-5 pt-3 safe-bottom border-t space-y-2" style={{ borderColor: "var(--line)" }}>
          {hasWa && (
            <button disabled={!!busy} onClick={() => submit(true)} className="btn-brand w-full h-14 flex items-center justify-center gap-2.5 text-[16px]" style={{ background: "#25D366", color: "#fff" }}>
              {busy === "wa" ? <Spinner /> : <Icon name="wa" className="w-5 h-5" />}{t("confirmOnWa", lang)}
            </button>
          )}
          <button disabled={!!busy} onClick={() => submit(false)} className={`${hasWa ? "btn-ghost" : "btn-brand"} w-full h-12 flex items-center justify-center gap-2 font-semibold`}>
            {busy === "plain" && <Spinner className="w-4 h-4" />}{t("confirmBooking", lang)}
          </button>
        </div>
      )}
    </Sheet>
  );
}
