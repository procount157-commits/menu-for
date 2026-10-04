// ── «متى عيد ميلادك؟» — asked once, after a visit ──────────────────

import { useState } from "react";
import { api } from "@/lib/api";
import { t, type Lang } from "@/lib/i18n";
import { toast } from "./ui";

export function BirthdayAsk({ lang, kind, token, shop }: { lang: Lang; kind: "order" | "ticket" | "booking"; token: string; shop: string }) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [state, setState] = useState<"ask" | "busy" | "done" | "hidden">(() => { try { return localStorage.getItem(`mfy:bday:${token}`) ? "hidden" : "ask"; } catch { return "ask"; } });
  if (state === "hidden") return null;
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, i, 1))));
  const save = async () => {
    setState("busy");
    try { await api("/api/public/birthday", { json: { kind, token, month: Number(month), day: Number(day) } }); setState("done"); try { localStorage.setItem(`mfy:bday:${token}`, "1"); } catch { /* ignore */ } }
    catch (e) { toast((e as Error).message); setState("ask"); }
  };
  if (state === "done") return <p className="mt-4 text-center text-sm p-4 rounded-2xl animate-rise" style={{ background: "var(--surface)" }}>🎂 {t("bdayThanks", lang)}</p>;
  return (
    <section className="mt-4 rounded-[22px] p-5 animate-rise" style={{ background: "var(--surface)" }}>
      <p className="font-semibold">🎂 {t("bdayAsk", lang)}</p>
      <p className="text-xs text-muted mt-1">{t("bdaySub", lang).replace("{shop}", shop)}</p>
      <div className="mt-3 flex gap-2">
        <select className="field flex-1 h-11" value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="">{t("bdayDay", lang)}</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <select className="field flex-[2] h-11" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">{t("bdayMonth", lang)}</option>
          {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <button className="btn-brand h-11 px-4 text-sm font-semibold" disabled={!month || !day || state === "busy"} onClick={save}>{t("save", lang)}</button>
      </div>
      <button className="text-xs text-muted mt-2 underline" onClick={() => { setState("hidden"); try { localStorage.setItem(`mfy:bday:${token}`, "1"); } catch { /* ignore */ } }}>{t("bdaySkip", lang)}</button>
    </section>
  );
}
