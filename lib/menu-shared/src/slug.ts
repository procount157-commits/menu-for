// ── The shop's address ────────────────────────────────────────────
// A shop lives at /{slug}, alongside the dashboard's own pages, so every top
// level path the server or the dashboard uses is reserved here. Printed on a
// QR and said aloud at a counter, so: short, lower case, latin, no surprises.

export const RESERVED_SLUGS = new Set([
  // public pages of this app
  "t", "b", "d", "o", "m", "q", "s", "mw", "menu", "queue", "ticket", "book", "booking", "order", "display",
  // dashboard routes
  "dashboard", "connect", "contacts", "campaigns", "follow-ups", "knowledge", "assistant", "board", "browser",
  "meetings", "ops", "employees", "conversations", "inbox", "extractor", "wa-link", "email", "arena", "settings",
  "diagnostics", "admin", "login", "logout", "register", "signup", "wa", "home", "staff", "staff-login",
  "orders", "bookings", "branches", "customers", "qr", "reports", "onboarding", "templates", "messages",
  "shop", "store", "studio", "app", "account", "billing", "plans", "pricing",
  // server and site
  "api", "assets", "static", "public", "favicon.svg", "favicon.ico", "robots.txt", "sitemap.xml", "blog", "uae", "saudi",
  "features", "about", "contact", "privacy", "terms", "help", "support", "docs", "track", "u", "unsubscribe",
  "www", "mail", "root", "null", "undefined", "test", "demo-admin",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && !s.includes("--") && !RESERVED_SLUGS.has(s) && s.length >= 3;
}

export function slugError(s: string): string | null {
  if (!s || s.length < 3) return "الرابط 3 أحرف على الأقل";
  if (s.length > 40) return "الرابط 40 حرفاً كحد أقصى";
  if (!SLUG_RE.test(s) || s.includes("--")) return "أحرف إنجليزية صغيرة وأرقام وشرطة فقط";
  if (RESERVED_SLUGS.has(s)) return "هذا الرابط محجوز — اختر غيره";
  return null;
}

/** A latin slug from a name; Arabic letters are transliterated roughly. */
export function slugify(name: string): string {
  const map: Record<string, string> = {
    "ا": "a", "أ": "a", "إ": "e", "آ": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
    "د": "d", "ذ": "th", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
    "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a",
    "و": "w", "ي": "y", "ى": "a", "ئ": "e", "ؤ": "o", "ء": "",
  };
  const s = [...String(name ?? "").toLowerCase()].map((c) => map[c] ?? c).join("")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 40).replace(/-+$/, "");
  return s;
}
