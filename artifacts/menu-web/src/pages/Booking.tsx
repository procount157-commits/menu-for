// ── A booking, after it is made ───────────────────────────────────

import { useEffect, useState } from "react";
import { formatClock, formatDayLabel, localDate, type PublicBookingView } from "@workspace/menu-shared";
import { Icon, Spinner, toast } from "@/components/ui";
import { api, go, openWhatsApp } from "@/lib/api";
import { pick, setLang, t, useLang } from "@/lib/i18n";
import { applyTheme } from "@/lib/theme";
import NotFound from "./NotFound";

export default function BookingPage({ token, initial }: { token: string; initial: PublicBookingView | null }) {
  const lang = useLang();
  const [b, setB] = useState<PublicBookingView | null>(initial);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => api<PublicBookingView>(`/api/public/bookings/${token}`).then(setB).catch(() => setGone(true));
    if (!initial) load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [token, initial]);
  useEffect(() => { if (b) applyTheme(b.org.theme); }, [b?.org.theme]);
  if (gone && !b) return <NotFound />;
  if (!b) return <div className="min-h-dvh flex items-center justify-center"><Spinner className="w-7 h-7 text-brand" /></div>;

  const tz = b.org.timezone;
  const start = new Date(b.startsAt);
  const day = formatDayLabel(localDate(tz, start), tz, lang);
  const time = formatClock(start, tz, lang);
  const menuPath = `/${b.org.slug}${b.branch.slug === "main" ? "" : `/${b.branch.slug}`}`;
  const live = b.status === "confirmed" || b.status === "pending";

  const cancel = async () => {
    if (!confirm(t("cancelConfirm", lang))) return;
    setBusy(true);
    try { setB(await api<PublicBookingView>(`/api/public/bookings/${token}/cancel`, { json: {} })); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };

  const ics = () => {
    const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const body = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MenuForYou//AR", "BEGIN:VEVENT",
      `UID:${b.token}@menuforyou`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(new Date(b.endsAt))}`,
      `SUMMARY:${pick(lang, b.org.name, b.org.nameEn)}${b.service ? ` — ${b.service}` : ""}`,
      `LOCATION:${[b.branch.name, b.branch.address].filter(Boolean).join(" — ")}`,
      `DESCRIPTION:${location.href}`, "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([body], { type: "text/calendar" })), download: `booking-${b.code}.ics` });
    a.click();
  };

  return (
    <div className="min-h-dvh pb-16">
      <header className="px-5 pt-4 max-w-md mx-auto flex items-center gap-3">
        <button onClick={() => go(menuPath)} className="w-10 h-10 rounded-full btn-ghost flex items-center justify-center" aria-label={t("back", lang)}><Icon name="arrow" className="w-5 h-5 ltr:rotate-180" /></button>
        <p className="font-semibold flex-1 truncate">{pick(lang, b.org.name, b.org.nameEn)}</p>
        <button onClick={() => setLang(lang === "ar" ? "en" : "ar", b.org.slug)} className="btn-ghost h-10 px-3.5 text-sm font-semibold">{lang === "ar" ? "EN" : "ع"}</button>
      </header>
      <main className="px-5 max-w-md mx-auto">
        <section className="mt-4 rounded-[28px] p-6 text-center animate-rise" style={{ background: "var(--surface)", boxShadow: "var(--shadow)" }}>
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: b.status === "cancelled" ? "var(--surface-2)" : "var(--brand-soft)", color: b.status === "cancelled" ? "var(--muted)" : "var(--brand)" }}>
            <Icon name={b.status === "cancelled" ? "x" : "calendar"} className="w-8 h-8" />
          </div>
          <p className="mt-4 text-lg font-semibold">{b.status === "cancelled" ? t("bookingCancelled", lang) : b.status === "pending" ? t("bookingPending", lang) : t("bookingConfirmed", lang)}</p>
          <p className="font-display text-4xl mt-3">{day}</p>
          <p className="text-2xl mt-1 tabular">{time}</p>
          <p className="text-muted mt-3 text-sm">{b.customerName} · {b.service ?? `${b.partySize} ${t("people", lang)}`}</p>
          <p className="text-xs text-muted mt-1 tabular">#{b.code}</p>
        </section>
        {live && !b.whatsappLinked && b.waLink && (
          <button onClick={() => openWhatsApp(b.waLink!)} className="mt-4 w-full h-14 rounded-full font-semibold flex items-center justify-center gap-2.5" style={{ background: "#25D366", color: "#fff" }}>
            <Icon name="wa" className="w-5 h-5" />{t("confirmOnWa", lang)}
          </button>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {live && <button onClick={ics} className="btn-ghost h-12 text-sm font-semibold flex items-center justify-center gap-2"><Icon name="calendar" className="w-4 h-4" />{t("addToCalendar", lang)}</button>}
          {b.branch.mapUrl && <a href={b.branch.mapUrl} target="_blank" rel="noreferrer" className="btn-ghost h-12 text-sm font-semibold flex items-center justify-center gap-2"><Icon name="map" className="w-4 h-4" />{t("directions", lang)}</a>}
          <button onClick={() => go(menuPath)} className="btn-ghost h-12 text-sm font-semibold">{t("browseMenu", lang)}</button>
          {live && <button disabled={busy} onClick={cancel} className="btn-ghost h-12 text-sm font-semibold text-danger">{busy ? <Spinner className="w-4 h-4" /> : t("cancelBooking", lang)}</button>}
        </div>
      </main>
    </div>
  );
}
