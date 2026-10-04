// ── The stamp card on the ticket, order and booking pages ─────────

import { t, type Lang } from "@/lib/i18n";

export function StampCard({ lang, loyalty }: { lang: Lang; loyalty: { stamps: number; target: number; reward: string } }) {
  const left = Math.max(0, loyalty.target - loyalty.stamps);
  return (
    <section className="mt-4 rounded-[22px] p-5 animate-rise" style={{ background: "var(--surface)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">🎟️ {t("stampTitle", lang)}</p>
        <span className="text-sm tabular text-muted">{loyalty.stamps}/{loyalty.target}</span>
      </div>
      <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(loyalty.target, 10)}, minmax(0, 1fr))` }}>
        {Array.from({ length: loyalty.target }, (_, i) => (
          <div key={i} className="aspect-square rounded-full flex items-center justify-center text-xs font-bold"
            style={i < loyalty.stamps ? { background: "var(--brand)", color: "var(--brand-ink)" } : { border: "2px dashed var(--line)", color: "var(--muted)" }}>
            {i < loyalty.stamps ? "✓" : i === loyalty.target - 1 ? "🎁" : ""}
          </div>
        ))}
      </div>
      <p className="text-sm text-muted mt-3">
        {left === 0 ? t("stampFull", lang) : t("stampLeft", lang).replace("{n}", String(left))} <b style={{ color: "var(--text)" }}>{loyalty.reward}</b>
      </p>
    </section>
  );
}
