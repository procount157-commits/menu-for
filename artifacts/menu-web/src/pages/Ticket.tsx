// ── The customer's ticket ─────────────────────────────────────────
// Opened with no account, kept live by a stream. The moment that matters is
// the call: the whole screen turns, the phone vibrates and chimes, the tab
// title blinks — and WhatsApp says the same thing, for a phone in a pocket.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatEta, type PublicMenu, type PublicTicket } from "@workspace/menu-shared";
import { monogram, Icon, Img, Spinner, toast } from "@/components/ui";
import { api, forget, go, openWhatsApp, useLive } from "@/lib/api";
import { pick, setLang, t, useLang, type Lang } from "@/lib/i18n";
import { applyTheme } from "@/lib/theme";
import NotFound from "./NotFound";

export default function TicketPage({ token, initial }: { token: string; initial: PublicTicket | null }) {
  const lang = useLang();
  const { data: tk, setData, gone } = useLive<PublicTicket>(`/api/public/tickets/${token}/stream`, `/api/public/tickets/${token}`, initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const prevStatus = useRef(tk?.status);

  useEffect(() => { if (tk) applyTheme(tk.org.theme); }, [tk?.org.theme]);
  useEffect(() => {
    if (!tk) return;
    api<PublicMenu>(`/api/public/m/${tk.org.slug}${tk.branch.slug === "main" ? "" : `/${tk.branch.slug}`}`).then(setMenu).catch(() => {});
  }, [tk?.org.slug, tk?.branch.slug]);

  // Progress is measured from where they started on this phone.
  const startAhead = useMemo(() => {
    if (!tk) return 0;
    try {
      const k = `mfy:start:${token}`;
      const v = localStorage.getItem(k);
      if (v !== null) return Math.max(Number(v), tk.ahead);
      localStorage.setItem(k, String(tk.ahead));
    } catch { /* ignore */ }
    return tk.ahead;
  }, [token, tk?.token]); // eslint-disable-line

  // The call.
  useEffect(() => {
    if (!tk) return;
    const was = prevStatus.current;
    prevStatus.current = tk.status;
    if (tk.status === "called" && was && was !== "called") { setDismissed(false); ring(); notifyDevice(tk, lang); }
    if (["done", "no_show", "left", "cancelled"].includes(tk.status)) forget("ticket", tk.org.slug, token);
  }, [tk?.status]); // eslint-disable-line

  useEffect(() => {
    if (tk?.status !== "called") return;
    const base = document.title;
    let on = false;
    const iv = setInterval(() => { on = !on; document.title = on ? `🔔 ${t("yourTurn", lang)}` : base; }, 900);
    return () => { clearInterval(iv); document.title = base; };
  }, [tk?.status, lang]);

  if (gone && !tk) return <NotFound />;
  if (!tk) return <div className="min-h-dvh flex items-center justify-center"><Spinner className="w-7 h-7 text-brand" /></div>;

  const act = async (path: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(path);
    try { setData(await api<PublicTicket>(`/api/public/tickets/${token}/${path}`, { json: {} })); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };

  const menuPath = `/${tk.org.slug}${tk.branch.slug === "main" ? "" : `/${tk.branch.slug}`}`;
  const live = tk.status === "waiting" || tk.status === "called" || tk.status === "serving";
  const progress = tk.status === "waiting" ? (startAhead > 0 ? 1 - tk.ahead / startAhead : 1) : 1;

  return (
    <div className="min-h-dvh pb-16">
      <TopBar tk={tk} lang={lang} onMenu={() => go(menuPath)} />

      <main className="px-5 max-w-md mx-auto">
        <section className="mt-4 rounded-[28px] p-6 text-center relative overflow-hidden animate-rise" style={{ background: "var(--surface)", boxShadow: "var(--shadow)" }}>
          <div className="absolute inset-x-0 top-0 h-32 pointer-events-none" style={{ background: "radial-gradient(60% 100% at 50% 0%, var(--brand-soft), transparent)" }} />
          <p className="relative text-sm text-muted">{pick(lang, tk.queue.name, tk.queue.nameEn)} · {t("yourNumber", lang)}</p>
          <Ring progress={progress} active={tk.status === "waiting"}>
            <span key={tk.displayCode} className="font-display text-[64px] leading-none tabular inline-block" style={{ animation: "flip-in .7s var(--ease-out) both", transformOrigin: "50% 60%" }}>{tk.displayCode}</span>
            {tk.customerName && <span className="block text-sm text-muted mt-2">{tk.customerName}</span>}
          </Ring>

          {tk.status === "waiting" && (
            <div className="relative grid grid-cols-2 gap-3 mt-2">
              <Stat label={t("ahead", lang)} value={String(tk.ahead)} big />
              <Stat label={t("eta", lang)} value={formatEta(tk.eta, lang)} />
            </div>
          )}
          {tk.status === "waiting" && tk.ahead === 0 && <p className="relative mt-4 font-semibold text-brand animate-float">{t("youreNext", lang)}</p>}
          {tk.status === "waiting" && tk.queue.isPaused && <p className="relative mt-3 text-sm text-muted">{t("queuePaused", lang)}</p>}
          {(tk.status === "called" || tk.status === "serving") && (
            <p className="relative mt-3 text-xl font-bold" style={{ color: "var(--ok)" }}>{t("yourTurn", lang)}</p>
          )}
          {tk.status === "done" && <p className="relative mt-3 text-lg font-semibold">{t("served", lang)} 🙏</p>}
          {(tk.status === "no_show" || tk.status === "left" || tk.status === "cancelled") && (
            <div className="relative mt-3">
              <p className="text-lg font-semibold">{tk.status === "no_show" ? t("noShow", lang) : t("left", lang)}</p>
              <button onClick={() => go(`${menuPath}#queue`)} className="btn-brand h-12 px-6 mt-4">{t("rejoin", lang)}</button>
            </div>
          )}
          {tk.nowServing.length > 0 && live && (
            <div className="relative mt-5 flex items-center justify-center gap-2 text-sm">
              <span className="text-muted">{t("nowServing", lang)}</span>
              {tk.nowServing.map((c) => <span key={c} className="px-2.5 py-1 rounded-full font-semibold tabular" style={{ background: "var(--surface-2)" }}>{c}</span>)}
            </div>
          )}
        </section>

        {live && (
          <section className="mt-4 space-y-2.5 animate-rise" style={{ animationDelay: "120ms" }}>
            {tk.whatsappLinked ? (
              <div className="flex items-center gap-3 p-4 rounded-2xl text-sm" style={{ background: "color-mix(in srgb, #25D366 14%, var(--surface))" }}>
                <Icon name="wa" className="w-6 h-6 flex-shrink-0" style={{ color: "#25D366" }} />{t("waLinked", lang)}
              </div>
            ) : tk.waLink ? (
              <button onClick={() => openWhatsApp(tk.waLink!)} className="w-full flex items-center gap-3 p-4 rounded-2xl text-start text-sm font-medium" style={{ background: "#25D366", color: "#fff" }}>
                <Icon name="wa" className="w-6 h-6 flex-shrink-0" /><span className="flex-1">{t("waNotLinked", lang)}</span><Icon name="chevron" className="w-5 h-5 rtl:rotate-180" />
              </button>
            ) : null}
            <DeviceAlert lang={lang} />
            <div className="grid grid-cols-2 gap-2.5">
              {(tk.status === "waiting" || tk.status === "called") && !tk.onMyWay && (
                <button disabled={!!busy} onClick={() => act("on-my-way")} className="btn-ghost h-12 font-semibold text-sm flex items-center justify-center gap-2">
                  {busy === "on-my-way" ? <Spinner className="w-4 h-4" /> : <Icon name="pin" className="w-4 h-4 text-brand" />}{t("onMyWay", lang)}
                </button>
              )}
              {tk.onMyWay && <div className="h-12 rounded-full flex items-center justify-center text-xs text-muted gap-1.5" style={{ background: "var(--surface-2)" }}><Icon name="check" className="w-4 h-4" />{t("onMyWayDone", lang)}</div>}
              <button disabled={!!busy} onClick={() => act("leave", t("leaveConfirm", lang))} className="btn-ghost h-12 font-semibold text-sm text-danger">
                {busy === "leave" ? <Spinner className="w-4 h-4" /> : t("leave", lang)}
              </button>
            </div>
          </section>
        )}

        <Promo menu={menu} lang={lang} onMenu={() => go(menuPath)} waiting={tk.status === "waiting"} />
      </main>

      {tk.status === "called" && !dismissed && <CalledOverlay tk={tk} lang={lang} onClose={() => setDismissed(true)} onWay={() => act("on-my-way")} />}
    </div>
  );
}

function TopBar({ tk, lang, onMenu }: { tk: PublicTicket; lang: Lang; onMenu: () => void }) {
  return (
    <header className="px-5 pt-4 max-w-md mx-auto flex items-center gap-3">
      <button onClick={onMenu} className="flex items-center gap-3 min-w-0 flex-1 text-start">
        <span className="w-11 h-11 rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0" style={{ background: "var(--surface)" }}>
          {tk.org.logoUrl ? <img src={tk.org.logoUrl} alt="" className="w-full h-full object-cover" /> : <span className="font-display text-xl text-brand">{monogram(tk.org.name)}</span>}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold truncate">{pick(lang, tk.org.name, tk.org.nameEn)}</span>
          <span className="block text-xs text-muted truncate">{pick(lang, tk.branch.name, tk.branch.nameEn)}</span>
        </span>
      </button>
      <button onClick={() => setLang(lang === "ar" ? "en" : "ar", tk.org.slug)} className="btn-ghost h-10 px-3.5 text-sm font-semibold">{lang === "ar" ? "EN" : "ع"}</button>
    </header>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "var(--surface-2)" }}>
      <p className="text-xs text-muted">{label}</p>
      <p key={value} className={`font-bold tabular mt-1 animate-pop whitespace-nowrap ${big ? "text-3xl" : "text-[17px] leading-9"}`}>{value}</p>
    </div>
  );
}

/** A ring that closes as the line moves. */
function Ring({ progress, active, children }: { progress: number; active: boolean; children: React.ReactNode }) {
  const r = 92, c = 2 * Math.PI * r;
  const p = Math.max(0.02, Math.min(1, progress));
  return (
    <div className="relative mx-auto my-5 w-[220px] h-[220px] flex items-center justify-center">
      <svg viewBox="0 0 220 220" className="absolute inset-0 -rotate-90">
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--brand)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: "stroke-dashoffset 1.2s var(--ease-out)" }} />
      </svg>
      {active && <span className="absolute inset-6 rounded-full" style={{ boxShadow: "0 0 60px -10px var(--brand-soft) inset" }} />}
      <div className="relative" style={{ perspective: 600 }}>{children}</div>
    </div>
  );
}

function CalledOverlay({ tk, lang, onClose, onWay }: { tk: PublicTicket; lang: Lang; onClose: () => void; onWay: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center text-center px-8 animate-fade"
      style={{ animation: "fade .3s both, called-flash 1.6s ease-in-out 3", background: "var(--ok)", color: "#04210f" }} onClick={onClose}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center animate-float" style={{ background: "rgba(255,255,255,.3)" }}><Icon name="bell" className="w-10 h-10" strokeWidth={2.2} /></div>
      <p className="mt-6 text-3xl font-bold">{t("yourTurn", lang)}</p>
      <p className="font-display text-[96px] leading-none mt-4 tabular">{tk.displayCode}</p>
      <p className="mt-4 text-lg font-medium">{t("yourTurnSub", lang)} — {pick(lang, tk.branch.name, tk.branch.nameEn)}</p>
      <div className="mt-10 flex gap-3" onClick={(e) => e.stopPropagation()}>
        {!tk.onMyWay && <button onClick={() => { onWay(); onClose(); }} className="h-12 px-6 rounded-full font-semibold" style={{ background: "#04210f", color: "#fff" }}>{t("onMyWay", lang)}</button>}
        <button onClick={onClose} className="h-12 px-6 rounded-full font-semibold" style={{ background: "rgba(255,255,255,.35)" }}>{t("close", lang)}</button>
      </div>
    </div>
  );
}

/** Ask once to be alerted on this device too, for while the page is open in the background. */
function DeviceAlert({ lang }: { lang: Lang }) {
  const [state, setState] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  if (state !== "default") return null;
  return (
    <button onClick={() => Notification.requestPermission().then((p) => setState(p))} className="w-full flex items-center gap-3 p-4 rounded-2xl text-start text-sm" style={{ background: "var(--surface)" }}>
      <Icon name="bell" className="w-5 h-5 text-brand flex-shrink-0" />
      <span className="flex-1">{lang === "ar" ? "نبّهني على هذا الجهاز لما يجي دوري" : "Alert me on this device when it's my turn"}</span>
    </button>
  );
}

function notifyDevice(tk: PublicTicket, lang: Lang) {
  navigator.vibrate?.([400, 160, 400, 160, 600]);
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      new Notification(`${t("yourTurn", lang)} ${tk.displayCode}`, { body: pick(lang, tk.org.name, tk.org.nameEn), tag: tk.token, requireInteraction: true } as NotificationOptions);
    }
  } catch { /* some browsers only allow this from a service worker */ }
}

/** A soft two-note chime, synthesised — nothing to download. */
function ring() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const note = (f: number, at: number) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.9);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 1);
    };
    note(880, 0); note(1318.5, 0.18); note(880, 1.1); note(1318.5, 1.28);
  } catch { /* audio blocked until a tap — the vibration and the screen still carry it */ }
}

/** While they wait: the shop's offers and favourites — the ad space the queue creates. */
function Promo({ menu, lang, onMenu, waiting }: { menu: PublicMenu | null; lang: Lang; onMenu: () => void; waiting: boolean }) {
  if (!menu) return null;
  const picks = menu.items.filter((i) => i.available && (i.tags.includes("popular") || i.tags.includes("chef") || i.images.length)).slice(0, 6);
  return (
    <section className="mt-8 animate-rise" style={{ animationDelay: "200ms" }}>
      {menu.offers[0] && (
        <div className="rounded-[22px] p-5 mb-4" style={{ background: "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 55%, var(--bg)))", color: "var(--brand-ink)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{t("offers", lang)}</p>
          <p className="font-display text-xl mt-1">{pick(lang, menu.offers[0].title, menu.offers[0].titleEn)}</p>
          {menu.offers[0].body && <p className="text-sm mt-1 opacity-90">{pick(lang, menu.offers[0].body, menu.offers[0].bodyEn)}</p>}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-xl">{waiting && menu.ordering.enabled ? t("orderWhileWaiting", lang) : t("menu", lang)}</h2>
      </div>
      {picks.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {picks.map((i) => (
            <button key={i.id} onClick={onMenu} className="text-start rounded-2xl overflow-hidden" style={{ background: "var(--surface)" }}>
              <Img img={i.images[0]} alt="" sizes="sm" className="w-full aspect-[4/3]" fallback={i.name} />
              <p className="p-3 text-sm font-semibold truncate">{pick(lang, i.name, i.nameEn)}</p>
            </button>
          ))}
        </div>
      )}
      <button onClick={onMenu} className="btn-brand w-full h-12 mt-4 flex items-center justify-center gap-2">{t("browseMenu", lang)}<Icon name="chevron" className="w-4 h-4 rtl:rotate-180" /></button>
    </section>
  );
}
