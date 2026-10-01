// ── The short code a customer sends us ────────────────────────────
// The customer starts the WhatsApp thread with a prefilled message carrying a
// code; finding that code in what arrives is how a ticket, an order or a
// booking learns the customer's real number without asking for it.
//
// No 0/O or 1/I: the code is read off a screen and sometimes typed by hand.

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function randomCode(len = 4, rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

export function normaliseDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d);
}

/**
 * The code in a message, if there is one: after «رمز», «كود», "code" or "#".
 * Case does not matter, because people retype it.
 */
export function extractCode(text: string): string | null {
  const t = normaliseDigits(String(text ?? ""));
  const m = t.match(/(?:رمز|الرمز|كود|code|ref|#)\s*[:：\-]?\s*([A-Za-z0-9]{4,6})\b/i);
  if (!m) return null;
  const raw = m[1]!.toUpperCase();
  return [...raw].every((c) => CODE_ALPHABET.includes(c)) ? raw : null;
}

/** What a customer can ask in an open thread, without a code. */
export type QueueCommand = "status" | "leave" | "menu" | "book" | null;

export function queueCommand(text: string): QueueCommand {
  const t = normaliseDigits(String(text ?? "")).trim().toLowerCase()
    .replace(/[؟?!.،,]/g, "").replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  if (!t || t.length > 40) return null;
  if (/^(كم (قدامي|باقي|دوري|متبقي)|متي دوري|وين دوري|دوري|status|my turn|position)$/.test(t)) return "status";
  if (/^(الغاء الدور|الغي الدور|اطلع من الصف|انسحب|cancel (my )?(ticket|turn|place)|leave (the )?queue)$/.test(t)) return "leave";
  if (/^(المنيو|منيو|القائمه|menu)$/.test(t)) return "menu";
  if (/^(حجز|احجز|ابي احجز|ابغي احجز|book|booking|reserve)$/.test(t)) return "book";
  return null;
}
