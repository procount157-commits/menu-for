// ── Small pieces the operations screens share ─────────────────────
// Stat tiles, empty states, the plan notice, a soft chime and a few
// formatters. Kept here so the queue, orders and bookings feel like one
// instrument rather than three pages.

import type { ReactNode } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { formatEta, type EtaRange } from "@workspace/menu-shared";
import { ApiError } from "@/lib/shop-api";
import { cn } from "@/lib/utils";

/** Western digits everywhere, whatever the browser thinks ar-AE means. */
export const AR = "ar-AE-u-nu-latn";

export function clock(iso: string | Date | null | undefined, tz?: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(AR, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function dayLabel(date: string, tz?: string): string {
  return new Intl.DateTimeFormat(AR, { timeZone: tz ?? "UTC", weekday: "long", day: "numeric", month: "short" })
    .format(new Date(`${date}T12:00:00Z`));
}

export function shortDate(iso: string | Date | null | undefined, tz?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(AR, { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "منذ 3 د" / "الآن" — short enough for a card corner. */
export function ago(min: number | null | undefined): string {
  if (min === null || min === undefined) return "";
  if (min < 1) return "الآن";
  if (min < 60) return `${min} د`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} س ${min % 60 ? `${min % 60} د` : ""}`.trim() : `${Math.floor(h / 24)} يوم`;
}

export function n(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** A 402 with {plan:true} is the plan talking, not a failure. */
export function isPlanError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 402;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : "حدث خطأ غير متوقع";
}

/**
 * formatEta for an RTL line: "~10–15" would otherwise reorder to "15–10~"
 * next to Arabic text, so the range is isolated left-to-right.
 */
export function Eta({ r }: { r: EtaRange }) {
  if (r.soon || r.high >= 120) return <>{formatEta(r)}</>;
  return <><span dir="ltr" className="inline-block tabular-nums">~{r.low}–{r.high}</span> دقيقة</>;
}

export function Stat({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "gold" | "warn" | "ok"; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-card-border bg-card px-3 py-2.5 min-w-0", className)}>
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums leading-tight mt-0.5",
        tone === "gold" && "text-primary", tone === "warn" && "text-amber-400", tone === "ok" && "text-emerald-400")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, className }: { icon?: ReactNode; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-10 px-6 text-muted-foreground", className)}>
      {icon && <div className="mb-3 text-primary/60 [&_svg]:w-9 [&_svg]:h-9">{icon}</div>}
      <div className="text-foreground font-semibold">{title}</div>
      {children && <div className="text-sm mt-1.5 max-w-sm leading-relaxed">{children}</div>}
    </div>
  );
}

export function PlanNotice({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <div className="max-w-lg mx-auto mt-16 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
      <Sparkles className="w-8 h-8 mx-auto text-primary mb-3" />
      <h2 className="text-lg font-bold">{what} غير متاح في خطتك الحالية</h2>
      <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{children ?? "رقِّ خطتك لتفعيل هذه الميزة. المنيو يبقى ظاهراً لزبائنك في كل الأحوال."}</p>
      <Link href="/shop/settings" className="inline-block mt-4 text-sm text-primary underline underline-offset-4">إعدادات المحل والخطة</Link>
    </div>
  );
}

/** The green dot that says "this customer is reachable on WhatsApp". */
export function WaDot({ on, className }: { on: boolean; className?: string }) {
  if (!on) return null;
  return (
    <svg viewBox="0 0 24 24" className={cn("w-4 h-4 text-emerald-400 shrink-0", className)} aria-label="مربوط بواتساب" role="img">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

// ── A soft chime ──────────────────────────────────────────────────
// WebAudio, so there is no file to ship. Browsers only allow sound after the
// page has been touched once; on a counter tablet that happens within the
// first minute, and before that the chime simply stays quiet.

let ctx: AudioContext | null = null;
export function chime(kind: "join" | "order" = "join") {
  try {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const notes = kind === "order" ? [784, 988, 1175] : [880, 1320];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.13;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx!.destination);
      o.start(t); o.stop(t + 0.4);
    });
  } catch { /* sound is a nicety */ }
  try { navigator.vibrate?.(kind === "order" ? [60, 40, 60] : 40); } catch { /* ignore */ }
}

/** Big, calm button used on the staff screens. */
export function Btn({ children, tone = "plain", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "gold" | "plain" | "danger" | "ok" | "ghost" }) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none select-none",
        tone === "gold" && "bg-primary text-primary-foreground hover:brightness-110",
        tone === "plain" && "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border",
        tone === "danger" && "bg-destructive/15 text-red-300 border border-destructive/30 hover:bg-destructive/25",
        tone === "ok" && "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25",
        tone === "ghost" && "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
        className,
      )}
    >{children}</button>
  );
}
