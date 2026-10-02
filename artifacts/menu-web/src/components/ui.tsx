// ── Small building blocks: icons, images, sheets, reveal ──────────
// Hand-written rather than a component library: the whole public app has to
// stay small enough to open quickly on weak 4G at a restaurant door.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PublicImage } from "@workspace/menu-shared";

type IconName =
  | "cart" | "plus" | "minus" | "x" | "clock" | "users" | "pin" | "phone" | "wa" | "search" | "globe" | "chevron"
  | "check" | "bell" | "calendar" | "ticket" | "flame" | "leaf" | "star" | "sparkle" | "trash" | "map" | "arrow" | "info" | "dish" | "grid" | "list";

const P: Record<IconName, ReactNode> = {
  cart: <><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.5L20 8H6.2" /><circle cx="10" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.7-3 3-4.6 5.5-4.6s4.8 1.6 5.5 4.6" /><path d="M16 5.5a3 3 0 0 1 0 6M17.5 14.6c1.6.6 2.7 2 3 4.4" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.4" /></>,
  phone: <path d="M5 4h3l1.5 4-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />,
  wa: <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5Zm4.6 11.9c-.2.6-1.1 1.1-1.6 1.2-.4 0-.9.2-3-.6-2.5-1-4.1-3.6-4.2-3.8-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.5.2.5.3.1.2.1.6-.1 1.2Z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5S14.3 18.1 12 20.5M12 3.5C9.7 5.9 8.6 8.7 8.6 12s1.1 6.1 3.4 8.5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  bell: <><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  ticket: <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2.5 2.5 0 0 0 0-5v-2Z" />,
  flame: <path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5.1 3.4-8.4 1.9 1.4 2.4 3.3 2.4 3.3s1.4-1.3 1.6-4.3C16.4 8.2 18 11.3 18 15.4 18 18.6 15.6 21 12 21Z" />,
  leaf: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" /><path d="M5 19c3-4 6-6.5 9.5-8.5" /></>,
  star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 19l.9-5.4-3.9-3.8 5.4-.8L12 4Z" />,
  sparkle: <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9 12 3.5ZM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7" />,
  map: <path d="m9 5-5 2v12l5-2 6 2 5-2V5l-5 2-6-2Zm0 0v12m6-10v12" />,
  arrow: <path d="M19 12H5m6-6-6 6 6 6" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  dish: <><path d="M4 15.5a8 8 0 0 1 16 0" /><path d="M2.5 15.5h19M12 7.5V5.5M10.5 5.5h3" /><path d="M5 18.5h14" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
};

export function Icon({ name, className = "w-5 h-5", strokeWidth = 1.8, style }: { name: IconName; className?: string; strokeWidth?: number; style?: CSSProperties }) {
  const filled = name === "wa";
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true"
      fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {P[name]}
    </svg>
  );
}

/** The letter that stands for a name: «البيت الشامي» is ب, not ا. */
export function monogram(name: string): string {
  const w = String(name ?? "").trim().replace(/^(ال|مطعم\s+|مقهى\s+|حلويات\s+|صالون\s+)/, "").trim();
  return (w || name).charAt(0);
}

/** A photo that arrives blurred first, then sharp; a monogram when there is none. */
export function Img({ img, alt, className = "", sizes = "md", fallback, eager = false, imgRef }: {
  img?: PublicImage | null; alt: string; className?: string; sizes?: "sm" | "md" | "lg"; fallback?: string; eager?: boolean;
  imgRef?: React.Ref<HTMLDivElement>;
}) {
  const [loaded, setLoaded] = useState(false);
  const src = img ? (sizes === "sm" ? img.sm ?? img.md ?? img.url : sizes === "md" ? img.md ?? img.url : img.url) : null;
  if (!src) {
    // No photo yet: a quiet plate on the brand colour, never a broken image.
    return (
      <div ref={imgRef} className={`relative overflow-hidden flex items-center justify-center ${className}`}
        style={{ background: "radial-gradient(120% 120% at 30% 20%, var(--brand-soft), transparent 62%), var(--surface-2)" }}>
        <Icon name="dish" className="w-[34%] h-[34%] max-w-12 max-h-12" strokeWidth={1.4} style={{ color: "var(--brand)", opacity: 0.55 }} />
        {fallback ? <span className="sr-only">{fallback}</span> : null}
      </div>
    );
  }
  return (
    <div ref={imgRef} className={`relative overflow-hidden ${className}`} style={img?.blur ? { backgroundImage: `url(${img.blur})`, backgroundSize: "cover", backgroundPosition: "center" } : { background: "var(--surface-2)" }}>
      <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" onLoad={() => setLoaded(true)}
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500" style={{ opacity: loaded ? 1 : 0 }} />
    </div>
  );
}

/** Adds `.in` when the element scrolls into view, once. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { el.classList.add("in"); return; }
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { (e.target as HTMLElement).classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px 12% 0px", threshold: 0 });
    el.querySelectorAll(".reveal").forEach((n) => io.observe(n));
    if (el.classList.contains("reveal")) io.observe(el);
    return () => io.disconnect();
  });
  return ref;
}

/** A bottom sheet with a backdrop; closes on backdrop tap, Escape, or a drag down. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    if (open) { setMounted(true); requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))); return undefined; }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!mounted) return null;
  const onStart = (e: React.TouchEvent) => {
    const scroller = panel.current?.querySelector("[data-scroll]") as HTMLElement | null;
    if (scroller && scroller.scrollTop > 0) return;
    drag.current = { y: e.touches[0]!.clientY, dy: 0 };
  };
  const onMove = (e: React.TouchEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, e.touches[0]!.clientY - drag.current.y);
    drag.current.dy = dy;
    panel.current.style.transition = "none";
    panel.current.style.transform = window.innerWidth >= 720 ? `translate(-50%, ${dy}px)` : `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!drag.current || !panel.current) return;
    panel.current.style.transition = "";
    panel.current.style.transform = "";
    if (drag.current.dy > 110) onClose();
    drag.current = null;
  };
  return (
    <>
      <div className={`sheet-backdrop ${shown ? "open" : ""}`} onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className={`sheet ${shown ? "open" : ""}`}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
        <div className="pt-2.5 pb-1 flex justify-center flex-shrink-0"><span className="w-10 h-1.5 rounded-full bg-[var(--line)]" style={{ background: "color-mix(in srgb, var(--text) 18%, transparent)" }} /></div>
        {children}
      </div>
    </>
  );
}

export function Stepper({ value, onChange, min = 1, max = 99, size = "md" }: { value: number; onChange: (n: number) => void; min?: number; max?: number; size?: "sm" | "md" }) {
  const b = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-2 p-1">
      <button type="button" aria-label="-" className={`${b} rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Icon name="minus" className="w-4 h-4" />
      </button>
      <span className="min-w-7 text-center font-semibold tabular">{value}</span>
      <button type="button" aria-label="+" className={`${b} rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Icon name="plus" className="w-4 h-4" />
      </button>
    </div>
  );
}

export function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return <span className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin-slow ${className}`} />;
}

/** A small toast at the top, for errors and confirmations. */
let toastFn: ((m: string, kind?: "ok" | "err") => void) | null = null;
export function toast(m: string, kind: "ok" | "err" = "err") { toastFn?.(m, kind); }
export function Toaster() {
  const [m, setM] = useState<{ text: string; kind: "ok" | "err"; id: number } | null>(null);
  useEffect(() => {
    toastFn = (text, kind = "err") => { const id = Date.now(); setM({ text, kind, id }); setTimeout(() => setM((x) => (x?.id === id ? null : x)), 3600); };
    return () => { toastFn = null; };
  }, []);
  if (!m) return null;
  return (
    <div className="fixed top-3 inset-x-3 z-[100] flex justify-center pointer-events-none">
      <div key={m.id} className="animate-rise pointer-events-auto max-w-md px-4 py-3 rounded-2xl text-sm font-medium shadow-lg"
        style={{ background: m.kind === "ok" ? "var(--ok)" : "var(--danger)", color: "#fff" }}>{m.text}</div>
    </div>
  );
}
