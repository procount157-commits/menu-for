// ── The menu designer ─────────────────────────────────────────────
// What an owner can change about how their menu looks, beyond the template
// and the brand colour: the font, the header, how items are laid out, how
// round the corners are, whether descriptions show, and a line of news at
// the top. Stored in orgs.theme.design; cleaned here for both sides.

export type FontKey = "cairo" | "tajawal" | "almarai" | "ibm" | "kufi";
export type HeroStyle = "cover" | "compact" | "center";
export type MenuView = "grid" | "list" | "text";
export type Radius = "round" | "soft" | "sharp";

export interface Announcement { text: string; textEn: string | null; tone: "brand" | "warn" | "info" }

export interface MenuDesign {
  font: FontKey;
  hero: HeroStyle;
  view: MenuView;
  radius: Radius;
  showDesc: boolean;
  announcement: Announcement | null;
}

export const FONTS: Record<FontKey, { label: string; family: string }> = {
  cairo:   { label: "كايرو — عصري وواضح", family: "\"Cairo\"" },
  tajawal: { label: "تجوال — خفيف وأنيق", family: "\"Tajawal\"" },
  almarai: { label: "المراعي — دافئ ومقروء", family: "\"Almarai\"" },
  ibm:     { label: "IBM بلكس — رسمي ونظيف", family: "\"IBM Plex Sans Arabic\"" },
  kufi:    { label: "نوتو كوفي — هندسي فاخر", family: "\"Noto Kufi Arabic\"" },
};

export const HEROES: Record<HeroStyle, string> = { cover: "غلاف كبير بالصورة", compact: "غلاف مختصر", center: "الشعار في الوسط" };
export const VIEWS: Record<MenuView, string> = { grid: "بطاقات بالصور", list: "قائمة مع صورة صغيرة", text: "منيو كلاسيكي بدون صور" };
export const RADII: Record<Radius, { label: string; px: number }> = { round: { label: "دائرية", px: 22 }, soft: { label: "ناعمة", px: 14 }, sharp: { label: "حادة", px: 6 } };

export const DEFAULT_DESIGN: MenuDesign = { font: "cairo", hero: "cover", view: "grid", radius: "round", showDesc: true, announcement: null };

/** Whatever was sent, made a design. Pure. */
export function cleanDesign(raw: unknown, current?: Partial<MenuDesign> | null): MenuDesign {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cur = { ...DEFAULT_DESIGN, ...(current ?? {}) };
  const pick = <T extends string>(v: unknown, allowed: Record<T, unknown>, d: T): T => (typeof v === "string" && v in allowed ? (v as T) : d);
  let announcement = cur.announcement;
  if ("announcement" in b) {
    const a = b.announcement as Record<string, unknown> | null;
    const text = a && typeof a.text === "string" ? a.text.trim().slice(0, 160) : "";
    announcement = text ? { text, textEn: typeof a!.textEn === "string" && a!.textEn.trim() ? a!.textEn.trim().slice(0, 160) : null, tone: pick<Announcement["tone"]>(a!.tone, { brand: 1, warn: 1, info: 1 }, "brand") } : null;
  }
  return {
    font: pick(b.font, FONTS, cur.font), hero: pick(b.hero, HEROES, cur.hero), view: pick(b.view, VIEWS, cur.view),
    radius: pick(b.radius, RADII, cur.radius), showDesc: typeof b.showDesc === "boolean" ? b.showDesc : cur.showDesc, announcement,
  };
}

// ── A section's hours (breakfast, lunch…) ─────────────────────────

export interface SectionHours { from: string | null; to: string | null; days: number[] }

/** Whether a section with these hours is served now. No hours = always. A window past midnight wraps. Pure. */
export function sectionOpen(h: SectionHours | null | undefined, weekday: number, minutes: number): boolean {
  if (!h || (!h.from && !h.to && !(h.days?.length))) return true;
  const toM = (s: string) => { const [a, b] = s.split(":").map(Number); return (a ?? 0) * 60 + (b ?? 0); };
  if (h.from && h.to) {
    const a = toM(h.from), b = toM(h.to);
    const inside = a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
    if (!inside) return false;
    const day = a > b && minutes < b ? (weekday + 6) % 7 : weekday;
    return !h.days?.length || h.days.includes(day);
  }
  return !h.days?.length || h.days.includes(weekday);
}
