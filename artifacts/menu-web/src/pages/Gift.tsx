// ── /g/:token — a gift card, as the recipient opens it ────────────

import { useEffect } from "react";
import { formatMoney } from "@workspace/menu-shared";
import { pick, setLang, t, useLang } from "@/lib/i18n";
import { applyTheme } from "@/lib/theme";

export interface GiftView {
  code: string; amount: number; balance: number; status: string; problem: string | null;
  recipientName: string | null; buyerName: string | null; message: string | null; expiresAt: string | null;
  org: { name: string; nameEn: string | null; slug: string; logoUrl: string | null; coverUrl: string | null; theme: any; currency: string; defaultLang: string };
  menuUrl: string;
}

export default function GiftPage({ initial }: { initial: GiftView }) {
  const lang = useLang();
  const g = initial;
  useEffect(() => { applyTheme(g.org.theme); }, [g.org.theme]);
  const money = (v: number) => formatMoney(v, g.org.currency, lang);
  const used = g.balance < g.amount;

  return (
    <div className="min-h-dvh pb-16">
      <header className="px-5 pt-4 max-w-md mx-auto flex items-center gap-3">
        {g.org.logoUrl && <img src={g.org.logoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />}
        <p className="font-semibold flex-1 truncate">{pick(lang, g.org.name, g.org.nameEn)}</p>
        <button onClick={() => setLang(lang === "ar" ? "en" : "ar", g.org.slug)} className="btn-ghost h-10 px-3.5 text-sm font-semibold">{lang === "ar" ? "EN" : "ع"}</button>
      </header>
      <main className="px-5 max-w-md mx-auto">
        <section className="mt-5 rounded-[28px] p-6 text-center animate-rise relative overflow-hidden" style={{ background: "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, #000))", color: "var(--brand-ink)", boxShadow: "var(--shadow)" }}>
          <div className="text-5xl" aria-hidden>🎁</div>
          {g.recipientName && <p className="mt-3 text-lg font-semibold">{g.recipientName}</p>}
          {g.buyerName && <p className="text-sm opacity-80">{t("giftFrom", lang)} {g.buyerName}</p>}
          <p className="font-display text-5xl mt-4 tabular">{money(g.balance)}</p>
          {used && <p className="text-sm opacity-80 mt-1">{t("giftBalance", lang)} — {t("giftOf", lang)} {money(g.amount)}</p>}
          <div className="mt-5 inline-block rounded-2xl px-5 py-2.5 font-mono text-2xl tracking-[0.2em] tabular" dir="ltr" style={{ background: "rgba(0,0,0,.22)" }}>{g.code}</div>
          {g.expiresAt && <p className="text-xs opacity-75 mt-3">{t("giftValidUntil", lang)} {g.expiresAt.slice(0, 10)}</p>}
        </section>
        {g.message && <blockquote className="mt-4 rounded-[22px] p-5 text-center text-lg leading-relaxed animate-rise" style={{ background: "var(--surface)" }}>«{g.message}»</blockquote>}
        {g.problem
          ? <p className="mt-4 text-center text-sm p-4 rounded-2xl font-semibold" style={{ background: "var(--surface)", color: "var(--danger)" }}>{g.problem}</p>
          : <p className="mt-4 text-center text-sm text-muted p-4 rounded-2xl" style={{ background: "var(--surface)" }}>{t("giftUse", lang)}</p>}
        <a href={g.menuUrl} className="mt-4 w-full h-14 rounded-full btn-brand font-semibold flex items-center justify-center">{t("orderNow", lang)}</a>
      </main>
    </div>
  );
}
