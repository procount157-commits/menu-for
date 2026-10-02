// ── The shop's TV ─────────────────────────────────────────────────
// Numbers only — never names — readable from across the room, with the
// in-store join QR (its key turns over every five minutes) and the offers.

import { useEffect, useRef, useState } from "react";
import { formatEta, type PublicDisplay } from "@workspace/menu-shared";
import { Icon, Spinner } from "@/components/ui";
import { api, useLive } from "@/lib/api";
import { pick, t, useLang } from "@/lib/i18n";
import { applyTheme } from "@/lib/theme";
import NotFound from "./NotFound";

export default function DisplayPage({ token, initial }: { token: string; initial: PublicDisplay | null }) {
  const lang = useLang();
  const { data, setData, gone } = useLive<PublicDisplay>(`/api/public/display/${token}/stream`, `/api/public/display/${token}`, initial);
  const [flash, setFlash] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const [offer, setOffer] = useState(0);

  useEffect(() => { if (data) applyTheme(data.org.theme); }, [data?.org.theme]);
  // The join key rotates; refresh the QR well before it expires.
  useEffect(() => { const iv = setInterval(() => api<PublicDisplay>(`/api/public/display/${token}`).then(setData).catch(() => {}), 60_000); return () => clearInterval(iv); }, [token, setData]);
  // Every line's current number, so a call on any chair rings — not just the first line's.
  const serving = data?.queues.map((x) => x.nowServing[0] ?? "").join("|") ?? null;
  useEffect(() => {
    if (serving && last.current !== null && serving !== last.current) {
      const prev = last.current.split("|");
      const called = data!.queues.find((x, i) => x.nowServing[0] && x.nowServing[0] !== prev[i])?.nowServing[0];
      if (called) { setFlash(called); chime(); setTimeout(() => setFlash(null), 6_000); }
    }
    last.current = serving;
  }, [serving]); // eslint-disable-line
  useEffect(() => { const iv = setInterval(() => setOffer((n) => n + 1), 9_000); return () => clearInterval(iv); }, []);
  // Keep the screen awake.
  useEffect(() => { let lock: any; (navigator as any).wakeLock?.request("screen").then((l: any) => (lock = l)).catch(() => {}); return () => lock?.release?.(); }, []);

  if (gone && !data) return <NotFound />;
  if (!data) return <div className="min-h-dvh flex items-center justify-center"><Spinner className="w-8 h-8 text-brand" /></div>;
  const q = data.queues[0];
  const o = data.offers.length ? data.offers[offer % data.offers.length] : null;
  // A barbershop's chairs: one card per barber instead of one big number.
  const chairs = data.queues.filter((x) => x.kind === "chair");

  return (
    <div className="h-dvh overflow-hidden flex flex-col p-[3vh] gap-[3vh] select-none" style={{ cursor: "none" }}>
      <header className="flex items-center gap-[2vh]">
        {data.org.logoUrl ? <img src={data.org.logoUrl} alt="" className="h-[8vh] w-[8vh] rounded-[2vh] object-cover" /> : null}
        <div className="flex-1">
          <p className="font-display" style={{ fontSize: "4.5vh" }}>{pick(lang, data.org.name, data.org.nameEn)}</p>
          <p className="text-muted" style={{ fontSize: "2.2vh" }}>{pick(lang, data.branch.name, data.branch.nameEn)}</p>
        </div>
        <Clock />
      </header>

      {chairs.length ? (
        <div className="flex-1 grid gap-[3vh] min-h-0" style={{ gridTemplateColumns: "1fr auto" }}>
          <section className="grid gap-[2.4vh] min-h-0" style={{ gridTemplateColumns: `repeat(${Math.min(chairs.length, chairs.length > 4 ? 3 : 2)}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
            {chairs.map((c) => {
              const hot = !!flash && c.nowServing[0] === flash;
              return (
                <div key={c.id} className="rounded-[3.4vh] p-[2.4vh] flex flex-col min-h-0" style={{ background: hot ? "var(--ok)" : "var(--surface)", color: hot ? "#04210f" : "var(--text)", transition: "background .6s" }}>
                  <div className="flex items-center gap-[1.6vh]">
                    {c.photoUrl
                      ? <img src={c.photoUrl} alt="" className="rounded-full object-cover" style={{ width: "7vh", height: "7vh" }} />
                      : <span className="rounded-full grid place-items-center font-display" style={{ width: "7vh", height: "7vh", fontSize: "3.4vh", background: "var(--brand)", color: "var(--brand-ink)" }}>{c.name.trim()[0]}</span>}
                    <div className="min-w-0">
                      <p className="font-display truncate" style={{ fontSize: "3.6vh" }}>{pick(lang, c.name, c.nameEn)}</p>
                      <p className="tabular opacity-70" style={{ fontSize: "2.2vh" }}>{c.isPaused ? t("queuePaused", lang) : `${c.waiting} ${t("waitingCount", lang)} · ${formatEta(c.eta, lang)}`}</p>
                    </div>
                  </div>
                  <p key={c.nowServing[0] ?? "-"} className="flex-1 grid place-items-center font-display tabular leading-none" style={{ fontSize: "13vh", animation: "flip-in .8s var(--ease-out) both" }}>{c.nowServing[0] ?? "—"}</p>
                  {c.next.length > 0 && (
                    <div className="flex gap-[1vh] justify-center">
                      {c.next.slice(0, 3).map((n) => <span key={n} className="tabular font-semibold rounded-full px-[1.6vh] py-[0.4vh]" style={{ fontSize: "2.4vh", background: hot ? "rgba(255,255,255,.3)" : "var(--surface-2)" }}>{n}</span>)}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          <section className="rounded-[4vh] p-[2.6vh] flex flex-col items-center justify-center gap-[2vh] text-center" style={{ background: "var(--brand)", color: "var(--brand-ink)", width: "30vh" }}>
            <img src={`/api/public/display/${token}/qr.png?k=${data.joinKey}`} alt="" className="rounded-[1.6vh] bg-white p-[0.8vh]" style={{ width: "22vh", height: "22vh" }} />
            <p className="font-display" style={{ fontSize: "3.2vh" }}>{t("scanToJoin", lang)}</p>
            <p style={{ fontSize: "2vh" }} className="opacity-80">{lang === "ar" ? "اختر حلاقك وخذ دورك — ونرسل لك على واتساب" : "Pick your barber, take your turn — we'll WhatsApp you"}</p>
          </section>
        </div>
      ) : q ? (
        <div className="flex-1 grid gap-[3vh]" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
          <section className="rounded-[4vh] flex flex-col items-center justify-center relative overflow-hidden" style={{ background: flash ? "var(--ok)" : "var(--surface)", transition: "background .6s", color: flash ? "#04210f" : "var(--text)" }}>
            <p style={{ fontSize: "3.4vh" }} className="opacity-80">{t("nowServing", lang)}</p>
            <p key={q.nowServing[0] ?? "-"} className="font-display tabular leading-none" style={{ fontSize: "26vh", animation: "flip-in .8s var(--ease-out) both" }}>{q.nowServing[0] ?? "—"}</p>
            {q.nowServing.length > 1 && (
              <div className="flex gap-[1.5vh] mt-[2vh]">
                {q.nowServing.slice(1).map((c) => <span key={c} className="tabular font-semibold rounded-full px-[2vh] py-[0.6vh]" style={{ fontSize: "3.4vh", background: flash ? "rgba(255,255,255,.3)" : "var(--surface-2)" }}>{c}</span>)}
              </div>
            )}
            {q.isPaused && <p className="absolute bottom-[3vh] text-muted" style={{ fontSize: "2.6vh" }}>{t("queuePaused", lang)}</p>}
          </section>
          <section className="flex flex-col gap-[3vh] min-h-0">
            <div className="rounded-[4vh] p-[3vh] flex-1 min-h-0" style={{ background: "var(--surface)" }}>
              <div className="flex items-baseline justify-between">
                <p style={{ fontSize: "3vh" }} className="font-semibold">{t("next", lang)}</p>
                <p className="text-muted tabular" style={{ fontSize: "2.4vh" }}>{q.waiting} {t("waitingCount", lang)} · {formatEta(q.eta, lang)}</p>
              </div>
              <div className="grid grid-cols-3 gap-[1.6vh] mt-[2.4vh]">
                {q.next.map((c, i) => (
                  <span key={c} className="tabular font-bold rounded-[2vh] flex items-center justify-center animate-rise" style={{ fontSize: "4.4vh", height: "10vh", background: "var(--surface-2)", animationDelay: `${i * 60}ms` }}>{c}</span>
                ))}
              </div>
            </div>
            <div className="rounded-[4vh] p-[2.6vh] flex items-center gap-[2.6vh]" style={{ background: "var(--brand)", color: "var(--brand-ink)" }}>
              <img src={`/api/public/display/${token}/qr.png?k=${data.joinKey}`} alt="" className="rounded-[1.6vh] bg-white p-[0.8vh]" style={{ width: "19vh", height: "19vh" }} />
              <div>
                <p className="font-display" style={{ fontSize: "3.6vh" }}>{t("scanToJoin", lang)}</p>
                <p style={{ fontSize: "2.2vh" }} className="opacity-80 mt-[0.6vh]">{lang === "ar" ? "بدون تطبيق وبدون تسجيل — ونرسل لك على واتساب لما يجي دورك" : "No app, no sign-up — we'll WhatsApp you when it's your turn"}</p>
              </div>
            </div>
          </section>
        </div>
      ) : <div className="flex-1" />}

      {o && (
        <footer key={o.id} className="rounded-[3vh] px-[3vh] py-[2vh] flex items-center gap-[2vh] animate-rise" style={{ background: "var(--surface)" }}>
          <Icon name="sparkle" className="text-brand" style={{ width: "4vh", height: "4vh" }} />
          <p className="font-semibold" style={{ fontSize: "3vh" }}>{pick(lang, o.title, o.titleEn)}</p>
          {o.body && <p className="text-muted truncate" style={{ fontSize: "2.4vh" }}>{pick(lang, o.body, o.bodyEn)}</p>}
        </footer>
      )}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(iv); }, []);
  return <p className="tabular font-semibold" style={{ fontSize: "4vh" }}>{now.toLocaleTimeString(document.documentElement.lang === "ar" ? "ar-AE" : "en-GB", { hour: "numeric", minute: "2-digit" })}</p>;
}

function chime() {
  try {
    const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
    [[660, 0], [990, 0.22]].forEach(([f, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f!; g.gain.setValueAtTime(0.0001, ctx.currentTime + at!);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at! + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at! + 1.2);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at!); o.stop(ctx.currentTime + at! + 1.3);
    });
  } catch { /* the TV may need one tap before it can play sound */ }
}
