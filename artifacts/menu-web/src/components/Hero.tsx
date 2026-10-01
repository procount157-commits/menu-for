// ── The top of the menu ───────────────────────────────────────────
// The cover drifts slower than the page (parallax, transform only), the
// logo sits over its edge, and the shop's state — open, closes at — is the
// first thing read after its name.

import { useEffect, useRef } from "react";
import { formatClock, type PublicMenu } from "@workspace/menu-shared";
import { monogram, Icon } from "./ui";
import { pick, setLang, t, type Lang } from "@/lib/i18n";
import { go } from "@/lib/api";

export function Hero({ menu, lang }: { menu: PublicMenu; lang: Lang }) {
  const { org, branch, branches } = menu;
  const cover = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, 600);
        if (cover.current) cover.current.style.transform = `translate3d(0, ${y * 0.38}px, 0) scale(${1.06 + y / 4000})`;
        if (shade.current) shade.current.style.opacity = String(Math.min(1, 0.25 + y / 420));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, []);

  const open = branch.open;
  const status = !open.known ? null : open.open
    ? `${t("open", lang)}${open.closesAt ? ` · ${t("closesAt", lang)} ${formatClock(new Date(open.closesAt), org.timezone, lang)}` : ""}`
    : `${t("closed", lang)}${open.opensAt ? ` · ${t("opensAt", lang)} ${formatClock(new Date(open.opensAt), org.timezone, lang)}` : ""}`;

  return (
    <header className="relative">
      <div className="relative h-[44vh] min-h-[260px] max-h-[460px] overflow-hidden">
        <div ref={cover} className="absolute inset-0 will-change-transform" style={{ transform: "scale(1.06)" }}>
          {org.coverUrl ? (
            <img src={org.coverUrl} alt="" className="w-full h-full object-cover animate-fade" fetchPriority="high" />
          ) : (
            <Pattern />
          )}
        </div>
        <div ref={shade} className="absolute inset-0" style={{ opacity: 0.25, background: "linear-gradient(to bottom, rgba(0,0,0,.35), rgba(0,0,0,.15) 40%, var(--bg) 100%)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 55%, var(--bg))" }} />

        <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between gap-2">
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar", org.slug)}
            className="h-10 px-3.5 rounded-full text-sm font-semibold flex items-center gap-1.5 backdrop-blur-md"
            style={{ background: "rgba(0,0,0,.35)", color: "#fff" }}>
            <Icon name="globe" className="w-4 h-4" />{lang === "ar" ? "EN" : "ع"}
          </button>
          {branches.length > 1 && (
            <label className="relative">
              <select value={branch.slug} aria-label={t("branches", lang)}
                onChange={(e) => go(e.target.value === branches[0]!.slug ? `/${org.slug}` : `/${org.slug}/${e.target.value}`)}
                className="h-10 appearance-none rounded-full ps-3.5 pe-9 text-sm font-semibold backdrop-blur-md outline-none"
                style={{ background: "rgba(0,0,0,.35)", color: "#fff" }}>
                {branches.map((b) => <option key={b.id} value={b.slug} style={{ color: "#111" }}>{pick(lang, b.name, b.nameEn)}</option>)}
              </select>
              <Icon name="pin" className="w-4 h-4 absolute top-3 end-3 pointer-events-none text-white" />
            </label>
          )}
        </div>
      </div>

      <div className="relative -mt-16 px-5 max-w-3xl mx-auto">
        <div className="flex items-end gap-4">
          <div className="w-[88px] h-[88px] rounded-[26px] overflow-hidden flex-shrink-0 animate-rise flex items-center justify-center"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow), 0 0 0 4px var(--bg)" }}>
            {org.logoUrl ? <img src={org.logoUrl} alt={org.name} className="w-full h-full object-cover" />
              : <span className="font-display text-4xl text-brand">{monogram(pick(lang, org.name, org.nameEn))}</span>}
          </div>
          <div className="pb-1 min-w-0 animate-rise" style={{ animationDelay: "80ms" }}>
            {status && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ background: open.open ? "color-mix(in srgb, var(--ok) 16%, transparent)" : "color-mix(in srgb, var(--danger) 16%, transparent)", color: open.open ? "var(--ok)" : "var(--danger)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />{status}
              </span>
            )}
          </div>
        </div>
        <h1 className="font-display text-[34px] leading-[1.15] mt-4 animate-rise" style={{ animationDelay: "120ms" }}>{pick(lang, org.name, org.nameEn)}</h1>
        {(org.tagline || org.taglineEn) && (
          <p className="text-muted mt-1.5 text-[15px] leading-relaxed animate-rise" style={{ animationDelay: "160ms" }}>{pick(lang, org.tagline, org.taglineEn)}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-4 animate-rise" style={{ animationDelay: "200ms" }}>
          {branch.mapUrl && (
            <a href={branch.mapUrl} target="_blank" rel="noreferrer" className="btn-ghost h-9 px-3.5 text-sm flex items-center gap-1.5">
              <Icon name="pin" className="w-4 h-4 text-brand" />{pick(lang, branch.name, branch.nameEn)}
            </a>
          )}
          {!branch.mapUrl && branches.length > 1 && (
            <span className="btn-ghost h-9 px-3.5 text-sm flex items-center gap-1.5"><Icon name="pin" className="w-4 h-4 text-brand" />{pick(lang, branch.name, branch.nameEn)}</span>
          )}
          {branch.displayPhone && (
            <a href={`tel:${branch.displayPhone.replace(/\s/g, "")}`} className="btn-ghost h-9 px-3.5 text-sm flex items-center gap-1.5">
              <Icon name="phone" className="w-4 h-4 text-brand" /><span dir="ltr">{branch.displayPhone}</span>
            </a>
          )}
          {Object.entries(org.socials ?? {}).slice(0, 3).map(([k, v]) => (
            <a key={k} href={v.startsWith("http") ? v : k === "instagram" ? `https://instagram.com/${v.replace(/^@/, "")}` : v} target="_blank" rel="noreferrer"
              className="btn-ghost h-9 px-3.5 text-sm flex items-center capitalize">{k}</a>
          ))}
        </div>
      </div>
    </header>
  );
}

/** When a shop has no cover photo: the brand colour, softly, and a quiet geometric pattern. */
function Pattern() {
  return (
    <div className="w-full h-full relative" style={{ background: "radial-gradient(90% 80% at 80% 10%, var(--brand-soft), transparent 60%), radial-gradient(70% 70% at 10% 90%, var(--brand-soft), transparent 55%), var(--surface)" }}>
      <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.12, color: "var(--brand)" }} aria-hidden>
        <defs>
          <pattern id="mfy-geo" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="14" y="14" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1" />
            <circle cx="28" cy="28" r="5" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#mfy-geo)" />
      </svg>
    </div>
  );
}
