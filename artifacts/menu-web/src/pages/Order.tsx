// ── After «أرسل الطلب على واتساب» ─────────────────────────────────
// If the message never left the phone the order is still `pending`: the page
// says so plainly and offers to send it again, or shows the code to give the
// staff instead.

import { useEffect } from "react";
import { formatClock, formatDayLabel, formatMoney, localDate, type PublicOrderView } from "@workspace/menu-shared";
import { Icon, Spinner } from "@/components/ui";
import { go, openWhatsApp, useLive } from "@/lib/api";
import { pick, setLang, t, useLang, type Key } from "@/lib/i18n";
import { applyTheme } from "@/lib/theme";
import NotFound from "./NotFound";

const STEPS = ["received", "preparing", "ready", "completed"] as const;

export default function OrderPage({ token, initial }: { token: string; initial: PublicOrderView | null }) {
  const lang = useLang();
  const { data: o, gone } = useLive<PublicOrderView>(`/api/public/orders/${token}/stream`, `/api/public/orders/${token}`, initial);
  useEffect(() => { if (o) applyTheme(o.org.theme); }, [o?.org.theme]);
  if (gone && !o) return <NotFound />;
  if (!o) return <div className="min-h-dvh flex items-center justify-center"><Spinner className="w-7 h-7 text-brand" /></div>;
  const step = STEPS.indexOf(o.status as typeof STEPS[number]);
  const menuPath = `/${o.org.slug}${o.branch.slug === "main" ? "" : `/${o.branch.slug}`}`;
  const tz = (o.org as any).timezone ?? "Asia/Dubai";

  return (
    <div className="min-h-dvh pb-16">
      <header className="px-5 pt-4 max-w-md mx-auto flex items-center gap-3">
        <button onClick={() => go(menuPath)} className="w-10 h-10 rounded-full btn-ghost flex items-center justify-center" aria-label={t("back", lang)}><Icon name="arrow" className="w-5 h-5 ltr:rotate-180" /></button>
        <p className="font-semibold flex-1 truncate">{pick(lang, o.org.name, o.org.nameEn)}</p>
        <button onClick={() => setLang(lang === "ar" ? "en" : "ar", o.org.slug)} className="btn-ghost h-10 px-3.5 text-sm font-semibold">{lang === "ar" ? "EN" : "ع"}</button>
      </header>
      <main className="px-5 max-w-md mx-auto">
        <section className="mt-4 rounded-[28px] p-6 text-center animate-rise" style={{ background: "var(--surface)", boxShadow: "var(--shadow)" }}>
          <p className="text-sm text-muted">{t("orderCode", lang)}</p>
          <p className="font-display text-6xl mt-2 tabular">#{o.code}</p>
          <p className="mt-3 text-lg font-semibold" style={{ color: o.status === "cancelled" ? "var(--danger)" : o.status === "ready" ? "var(--ok)" : "var(--text)" }}>{t(`st_${o.status}` as Key, lang)}</p>
          {o.scheduledFor && (
            <p className="text-sm text-muted mt-1">{formatDayLabel(localDate(tz, new Date(o.scheduledFor)), tz, lang)} {formatClock(new Date(o.scheduledFor), tz, lang)}</p>
          )}
          {o.status !== "pending" && o.status !== "cancelled" && (
            <ol className="mt-6 flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <li key={s} className="flex-1">
                  <div className="h-1.5 rounded-full transition-colors duration-700" style={{ background: i <= step ? "var(--brand)" : "var(--surface-2)" }} />
                  <p className="text-[11px] mt-1.5" style={{ color: i <= step ? "var(--text)" : "var(--muted)" }}>{t(`st_${s}` as Key, lang)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {o.status === "pending" && (
          <section className="mt-4 animate-rise">
            {o.waLink ? (
              <button onClick={() => openWhatsApp(o.waLink!)} className="w-full h-14 rounded-full font-semibold flex items-center justify-center gap-2.5" style={{ background: "#25D366", color: "#fff" }}>
                <Icon name="wa" className="w-5 h-5" />{t("sendNow", lang)}
              </button>
            ) : (
              <p className="text-center text-sm text-muted p-4 rounded-2xl" style={{ background: "var(--surface)" }}>{t("showCode", lang)}</p>
            )}
          </section>
        )}

        <section className="mt-4 rounded-[22px] p-5 animate-rise" style={{ background: "var(--surface)", animationDelay: "100ms" }}>
          <div className="flex items-center justify-between text-sm text-muted mb-3">
            <span>{t(o.type as Key, lang)}{o.tableLabel ? ` · ${t("table", lang)} ${o.tableLabel}` : ""}</span>
          </div>
          <ul className="space-y-2.5">
            {o.items.map((l, i) => (
              <li key={i} className="flex gap-3">
                <span className="tabular text-muted w-7">{l.qty}×</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{pick(lang, l.name, l.nameEn)}</p>
                  {l.options.length > 0 && <p className="text-xs text-muted">{l.options.map((x) => x.choice).join(lang === "ar" ? "، " : ", ")}</p>}
                  {l.note && <p className="text-xs text-muted">↳ {l.note}</p>}
                </div>
                <span className="tabular text-sm">{formatMoney(l.lineTotal, o.org.currency, lang)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t flex justify-between font-bold" style={{ borderColor: "var(--line)" }}>
            <span>{t("total", lang)}</span><span className="tabular">{formatMoney(o.subtotal, o.org.currency, lang)}</span>
          </div>
        </section>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {o.branch.mapUrl && <a href={o.branch.mapUrl} target="_blank" rel="noreferrer" className="btn-ghost h-12 flex items-center justify-center gap-2 text-sm font-semibold"><Icon name="map" className="w-4 h-4" />{t("directions", lang)}</a>}
          <button onClick={() => go(menuPath)} className="btn-ghost h-12 text-sm font-semibold">{t("browseMenu", lang)}</button>
        </div>
      </main>
    </div>
  );
}
