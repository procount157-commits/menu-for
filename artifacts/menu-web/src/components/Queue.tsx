// ── «احجز دورك» on the menu ───────────────────────────────────────
// The button always shows the live line — how many are waiting and the
// wait — because that number is what decides whether someone stays.

import { useEffect, useState } from "react";
import { formatEta, type PublicMenu, type PublicQueue } from "@workspace/menu-shared";
import { Icon, Sheet, Spinner, Stepper, toast } from "./ui";
import { api, ApiError, forget, go, openWhatsApp, recall, remember, useLive } from "@/lib/api";
import { pick, t, type Lang } from "@/lib/i18n";

export function QueueFab({ menu, lang, onOpen, cartVisible }: { menu: PublicMenu; lang: Lang; onOpen: () => void; cartVisible: boolean }) {
  const q0 = menu.queues[0];
  const { data: q } = useLive<PublicQueue>(q0 ? `/api/public/queues/${q0.id}/stream` : null, q0 ? `/api/public/queues/${q0.id}` : null, q0 ?? null, 15_000);
  const [held, setHeld] = useState<string | null>(() => recall("ticket", menu.org.slug)[0] ?? null);
  // A remembered ticket that was served, left, or no longer exists is not "your ticket".
  useEffect(() => {
    if (!held) return;
    api<{ status: string }>(`/api/public/tickets/${held}`)
      .then((tk) => { if (!["waiting", "called", "serving"].includes(tk.status)) { forget("ticket", menu.org.slug, held); setHeld(null); } })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) { forget("ticket", menu.org.slug, held); setHeld(null); } });
  }, [held, menu.org.slug]);
  const [bump, setBump] = useState(0);
  const [prev, setPrev] = useState(q?.waiting);
  useEffect(() => { if (q && prev !== undefined && q.waiting !== prev) setBump((n) => n + 1); setPrev(q?.waiting); }, [q?.waiting]); // eslint-disable-line

  if (!q) return null;
  const blocked = !q.isOpen || q.isPaused;
  if (held) {
    return (
      <div className="fixed bottom-0 inset-x-0 z-40 px-4 no-print">
        <div className="max-w-xl mx-auto safe-bottom">
          <button onClick={() => go(`/t/${held}`)} className="w-full h-14 rounded-full flex items-center gap-3 px-5 font-semibold"
            style={{ background: "var(--surface-2)", color: "var(--text)", boxShadow: "var(--shadow)", border: "1px solid var(--line)" }}>
            <Icon name="ticket" className="w-5 h-5 text-brand" />
            <span className="flex-1 text-start">{t("yourTicket", lang)}</span>
            <Icon name="chevron" className="w-5 h-5 rtl:rotate-180" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 px-4 no-print pointer-events-none">
      <div className="max-w-xl mx-auto safe-bottom">
        <button onClick={onOpen} disabled={blocked}
          className={`pointer-events-auto relative isolate w-full h-[60px] rounded-full flex items-center gap-3 ps-2 pe-5 text-start transition-transform active:scale-[0.98] ${cartVisible ? "" : "pulse-ring"}`}
          style={{ background: blocked ? "var(--surface-2)" : "var(--text)", color: blocked ? "var(--muted)" : "var(--bg)", boxShadow: "var(--shadow)" }}>
          <span className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--brand)", color: "var(--brand-ink)" }}>
            <Icon name="users" className="w-5 h-5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-[15px] leading-tight">{blocked ? (q.isPaused ? t("queuePaused", lang) : t("queueClosed", lang)) : t("joinQueue", lang)}</span>
            {!blocked && (
              <span className="block text-[12.5px] opacity-75 tabular mt-0.5">
                <span key={bump} className="inline-block animate-pop">{q.waiting}</span> {t("inQueue", lang)} · {formatEta(q.eta, lang)}
              </span>
            )}
          </span>
          {!blocked && <Icon name="chevron" className="w-5 h-5 rtl:rotate-180 opacity-70" />}
        </button>
      </div>
    </div>
  );
}

export function JoinSheet({ menu, lang, open, onClose, joinKey, source }: { menu: PublicMenu; lang: Lang; open: boolean; onClose: () => void; joinKey: string | null; source: "qr" | "link" }) {
  const [qid, setQid] = useState(menu.queues[0]?.id ?? 0);
  const q = menu.queues.find((x) => x.id === qid) ?? menu.queues[0];
  const [name, setName] = useState(() => { try { return localStorage.getItem("mfy:name") ?? ""; } catch { return ""; } });
  const [party, setParty] = useState(2);
  const [service, setService] = useState<number | null>(null);
  const [phone, setPhone] = useState(() => { try { return localStorage.getItem("mfy:phone") ?? ""; } catch { return ""; } });
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState<"wa" | "plain" | null>(null);
  const services = menu.items.filter((i) => i.kind === "service" && i.available);
  if (!q) return null;
  const needKey = q.qrOnly && !joinKey;
  const hasWa = !!menu.branch.waPhone;

  const submit = async (withWa: boolean) => {
    if (!name.trim()) { toast(t("namePh", lang)); return; }
    setBusy(withWa ? "wa" : "plain");
    try { localStorage.setItem("mfy:name", name.trim()); if (phone.trim()) localStorage.setItem("mfy:phone", phone.trim()); } catch { /* ignore */ }
    try {
      const r = await api<{ token: string; waLink: string | null }>(`/api/public/queues/${q.id}/join`, {
        json: { name: name.trim(), partySize: q.askPartySize ? party : 1, serviceItemId: service, phone: phone.trim() || null, joinKey, marketingOptIn: optIn, source },
      });
      remember("ticket", menu.org.slug, r.token);
      onClose();
      go(`/t/${r.token}`);
      if (withWa && r.waLink) setTimeout(() => openWhatsApp(r.waLink!), 150);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <Sheet open={open} onClose={onClose} label={t("joinQueue", lang)}>
      <div data-scroll className="overflow-y-auto px-5 pb-4">
        <div className="flex items-center gap-4 py-2">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Icon name="ticket" className="w-7 h-7" /></div>
          <div>
            <h2 className="font-display text-2xl leading-tight">{t("joinQueue", lang)}</h2>
            <p className="text-muted text-sm tabular">{q.waiting} {t("inQueue", lang)} · {formatEta(q.eta, lang)}</p>
          </div>
        </div>

        {menu.queues.length > 1 && (
          <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
            {menu.queues.map((x) => <button key={x.id} className="chip flex-shrink-0" aria-pressed={x.id === q.id} onClick={() => setQid(x.id)}>{pick(lang, x.name, x.nameEn)}</button>)}
          </div>
        )}

        {needKey ? (
          <div className="mt-6 p-4 rounded-2xl text-sm leading-relaxed" style={{ background: "var(--surface-2)" }}>
            <Icon name="info" className="w-5 h-5 text-brand inline-block me-2" />{t("qrOnly", lang)}
          </div>
        ) : q.full ? (
          <div className="mt-6 p-4 rounded-2xl text-sm" style={{ background: "var(--surface-2)" }}>{t("queueFull", lang)}</div>
        ) : (
          <div className="mt-5 space-y-5">
            <label className="block"><span className="font-semibold text-sm">{t("name", lang)}</span>
              <input className="field mt-2" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("namePh", lang)} autoComplete="given-name" /></label>
            {q.askPartySize && (
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{t("partySize", lang)}</span>
                <Stepper value={party} onChange={setParty} max={30} />
              </div>
            )}
            {q.askService && services.length > 0 && (
              <div>
                <p className="font-semibold text-sm mb-2">{t("service", lang)}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="chip" aria-pressed={service === null} onClick={() => setService(null)}>{t("anyService", lang)}</button>
                  {services.map((s) => <button key={s.id} className="chip" aria-pressed={service === s.id} onClick={() => setService(s.id)}>{pick(lang, s.name, s.nameEn)}</button>)}
                </div>
              </div>
            )}
            {hasWa && (
              <label className="block"><span className="font-semibold text-sm flex items-center gap-1.5"><Icon name="wa" className="w-4 h-4" style={{ color: "#25D366" }} />{t("waNumber", lang)}</span>
                <input className="field mt-2 tabular" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("phonePh", lang)} autoComplete="tel" />
                <span className="block text-xs text-muted mt-1.5">{t("waNumberHintQueue", lang)}</span></label>
            )}
            <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="w-5 h-5 accent-[var(--brand)]" />
              {t("offersOptIn", lang)}
            </label>
          </div>
        )}
      </div>
      {!needKey && !q.full && (
        <div className="px-5 pt-3 safe-bottom border-t space-y-2" style={{ borderColor: "var(--line)" }}>
          {phone.trim() || !hasWa ? (
            // A number typed: the shop's WhatsApp writes to the customer, nothing for them to send.
            <button disabled={!!busy} onClick={() => submit(false)} className="btn-brand w-full h-14 flex items-center justify-center gap-2.5 text-[16px]">
              {busy ? <Spinner /> : <Icon name="ticket" className="w-5 h-5" />}{t("joinNow", lang)}
            </button>
          ) : (
            <>
              <button disabled={!!busy} onClick={() => submit(true)} className="btn-brand w-full h-14 flex items-center justify-center gap-2.5 text-[16px]" style={{ background: "#25D366", color: "#fff" }}>
                {busy === "wa" ? <Spinner /> : <Icon name="wa" className="w-5 h-5" />}{t("joinWa", lang)}
              </button>
              <button disabled={!!busy} onClick={() => submit(false)} className="btn-ghost w-full h-12 flex items-center justify-center gap-2 text-[15px] font-semibold">
                {busy === "plain" && <Spinner className="w-4 h-4" />}{t("joinNoWa", lang)}
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
