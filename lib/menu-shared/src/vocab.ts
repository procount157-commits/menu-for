// ── One engine, four kinds of shop ────────────────────────────────
// A restaurant's dish, a sweets shop's tray and a salon's service are the
// same row; what changes is what they are called and what the shop starts
// with. Nothing else branches on the vertical.

export type Vertical = "restaurant" | "cafe" | "sweets" | "beauty";
export type Template = "noir" | "cream" | "clean" | "rose";

export interface Vocab {
  label: [string, string];
  item: [string, string];
  items: [string, string];
  queue: [string, string];
  booking: [string, string];
  bookCta: [string, string];
  orderCta: [string, string];
  /** Whether items default to services (booked, with a duration). */
  services: boolean;
  template: Template;
  brand: string;
  avgServiceMin: number;
  defaultCategories: Array<[string, string]>;
}

export const VOCAB: Record<Vertical, Vocab> = {
  restaurant: {
    label: ["مطعم", "Restaurant"], item: ["طبق", "Dish"], items: ["الأطباق", "Dishes"],
    queue: ["قائمة الانتظار", "Waitlist"], booking: ["حجز طاولة", "Table booking"],
    bookCta: ["احجز طاولة", "Book a table"], orderCta: ["اطلب على واتساب", "Order on WhatsApp"],
    services: false, template: "noir", brand: "#22c55e", avgServiceMin: 6,
    defaultCategories: [["المقبلات", "Starters"], ["الأطباق الرئيسية", "Mains"], ["الحلويات", "Desserts"], ["المشروبات", "Drinks"]],
  },
  cafe: {
    label: ["كافيه", "Café"], item: ["صنف", "Item"], items: ["الأصناف", "Items"],
    queue: ["دور الطلبات", "Order queue"], booking: ["حجز طاولة", "Table booking"],
    bookCta: ["احجز طاولة", "Book a table"], orderCta: ["اطلب على واتساب", "Order on WhatsApp"],
    services: false, template: "noir", brand: "#22c55e", avgServiceMin: 3,
    defaultCategories: [["القهوة", "Coffee"], ["المشروبات الباردة", "Cold drinks"], ["المخبوزات", "Bakery"]],
  },
  sweets: {
    label: ["حلويات", "Sweets"], item: ["منتج", "Product"], items: ["المنتجات", "Products"],
    queue: ["دور الاستلام", "Pickup queue"], booking: ["طلب مسبق", "Pre-order"],
    bookCta: ["اطلب مسبقاً", "Pre-order"], orderCta: ["اطلب على واتساب", "Order on WhatsApp"],
    services: false, template: "noir", brand: "#22c55e", avgServiceMin: 4,
    defaultCategories: [["الصواني", "Trays"], ["الكيك", "Cakes"], ["الحلويات الشرقية", "Arabic sweets"], ["علب الهدايا", "Gift boxes"]],
  },
  beauty: {
    label: ["تجميل", "Beauty"], item: ["خدمة", "Service"], items: ["الخدمات", "Services"],
    queue: ["الدور", "Walk-in queue"], booking: ["موعد", "Appointment"],
    bookCta: ["احجزي موعد", "Book an appointment"], orderCta: ["احجزي على واتساب", "Book on WhatsApp"],
    services: true, template: "noir", brand: "#22c55e", avgServiceMin: 25,
    defaultCategories: [["الشعر", "Hair"], ["الأظافر", "Nails"], ["البشرة", "Skin"], ["المكياج", "Makeup"]],
  },
};

export function vocab(v: string | null | undefined): Vocab {
  return VOCAB[(v as Vertical) in VOCAB ? (v as Vertical) : "restaurant"];
}

/** Flow Hub's green — the default brand colour of a new shop. */
export const DEFAULT_BRAND = "#22c55e";

export const TEMPLATES: Record<Template, { label: [string, string]; bg: string; surface: string; text: string; muted: string; dark: boolean }> = {
  // Flow Hub's own palette — the dashboard's dark green — and the default.
  noir:  { label: ["أخضر داكن", "Deep green"],   bg: "#0b1411", surface: "#111d18", text: "#e0ebe6", muted: "#81988c", dark: true },
  cream: { label: ["كريمي دافئ", "Warm cream"],  bg: "#faf5ec", surface: "#ffffff", text: "#2b2118", muted: "#7d6e5c", dark: false },
  clean: { label: ["أبيض نظيف", "Clean white"],  bg: "#f6f7f9", surface: "#ffffff", text: "#111418", muted: "#667085", dark: false },
  rose:  { label: ["وردي ناعم", "Soft rose"],    bg: "#fbf3f5", surface: "#ffffff", text: "#2d1b22", muted: "#8a6b77", dark: false },
};
