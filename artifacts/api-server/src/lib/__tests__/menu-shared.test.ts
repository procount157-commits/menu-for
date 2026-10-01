// The pure parts of Menu For You: prices, waits, local time, booking slots,
// codes in messages, shop addresses and message templates. No database.

import {
  priceLine, priceCart, formatMoney, serviceInterval, etaFor, formatEta, serviceDay, localDate, zonedToUtc,
  isOpenAt, openWindow, availableSlots, fits, extractCode, queueCommand, randomCode, CODE_ALPHABET,
  isValidSlug, slugError, slugify, renderTemplate, waMeLink, type PriceableItem,
} from "@workspace/menu-shared";
import { laneFor, REPLIED_WINDOW_MS } from "../notify/outbox";
import { withinDaytime } from "../notify/lifecycle";
import { joinKey, joinKeyValid } from "../menu/urls";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

// ── Pricing ──────────────────────────────────────────────────────
const burger: PriceableItem = {
  id: 1, name: "برجر", price: 32, options: [
    { name: "الحجم", required: true, min: 1, max: 1, choices: [{ name: "عادي", priceDelta: 0 }, { name: "دبل", priceDelta: 10 }] },
    { name: "إضافات", required: false, min: 0, max: 2, choices: [{ name: "جبن", priceDelta: 3 }, { name: "هالبينو", priceDelta: 2 }, { name: "بيض", priceDelta: 4 }] },
  ],
};
let r = priceLine(burger, { itemId: 1, qty: 2, selections: [{ group: "الحجم", choices: ["دبل"] }, { group: "إضافات", choices: ["جبن", "بيض"] }] });
check("options add to the unit price", r.ok && r.line.unitPrice === 49 && r.line.lineTotal === 98, r.ok ? r.line : r);
r = priceLine(burger, { itemId: 1, qty: 1 });
check("a required group must be chosen", !r.ok);
r = priceLine(burger, { itemId: 1, qty: 1, selections: [{ group: "الحجم", choices: ["عادي"] }, { group: "إضافات", choices: ["جبن", "بيض", "هالبينو"] }] });
check("more than the group's max is refused", !r.ok);
r = priceLine(burger, { itemId: 1, qty: 1, selections: [{ group: "الحجم", choices: ["عملاق"] }] });
check("a choice that does not exist is refused", !r.ok);
r = priceLine(burger, { itemId: 1, qty: 0, selections: [{ group: "الحجم", choices: ["عادي"] }] });
check("zero quantity is refused", !r.ok);
r = priceLine(burger, { itemId: 1, qty: 1.7 as any, selections: [{ group: "الحجم", choices: ["عادي"] }] });
check("a fractional quantity is floored", r.ok && r.line.qty === 1);
const cart = priceCart(new Map([[1, burger]]), [
  { itemId: 1, qty: 1, selections: [{ group: "الحجم", choices: ["عادي"] }] },
  { itemId: 1, qty: 1, selections: [{ group: "الحجم", choices: ["دبل"] }] },
]);
check("the cart total is the server's sum", cart.ok && cart.subtotal === 74, cart.ok ? cart.subtotal : cart);
check("an item not on the menu fails the cart", !priceCart(new Map([[1, burger]]), [{ itemId: 9, qty: 1 }]).ok);
check("price sent by the browser is ignored", (() => {
  const c = priceCart(new Map([[1, burger]]), [{ itemId: 1, qty: 1, selections: [{ group: "الحجم", choices: ["عادي"] }], ...({ unitPrice: 1 } as any) }]);
  return c.ok && c.subtotal === 32;
})());
check("money formats in Arabic and English", formatMoney(12.5, "AED", "ar") === "12.50 د.إ" && formatMoney(12, "AED", "en") === "AED 12");

// ── ETA ──────────────────────────────────────────────────────────
const t0 = Date.UTC(2026, 9, 1, 12, 0);
const every = (min: number, n: number, start = t0) => Array.from({ length: n }, (_, i) => start + i * min * 60_000);
let iv = serviceInterval([], 5);
check("no calls yet: the owner's estimate", iv.minutes === 5 && iv.samples === 0);
iv = serviceInterval(every(3, 21), 10);
check("twenty gaps of 3 min pull the estimate toward 3", iv.minutes > 3 && iv.minutes < 4.5, iv);
iv = serviceInterval(every(3, 3), 10);
check("two gaps: still mostly the owner's number", iv.minutes > 7, iv);
iv = serviceInterval([...every(3, 15), t0 + 14 * 3 * 60_000 + 40 * 60_000], 3);
check("one 40-minute table does not move the estimate", iv.minutes < 5, iv);
iv = serviceInterval([0, 0, 0, 10, 10, 10, 20, 20, 20, 30, 30, 30].map((m) => t0 + m * 60_000), 3);
check("three called at once every 10 min: ~3.3 min a person, not zero", iv.minutes > 2.5 && iv.minutes < 4.5, iv);
iv = serviceInterval([...every(3, 10), t0 + 9 * 3 * 60_000 + 120 * 60_000, ...every(3, 10, t0 + 9 * 3 * 60_000 + 120 * 60_000)], 3);
check("an idle gap (queue empty) is not service time", iv.minutes < 4, iv);
let e = etaFor(0, 4);
check("nobody ahead: soon", e.soon && formatEta(e) === "أقل من 5 دقائق");
e = etaFor(4, 5);
check("four ahead at 5 min: a range around 20", !e.soon && e.low === 15 && e.high === 30, e);
check("the range is in fives", e.low % 5 === 0 && e.high % 5 === 0);
e = etaFor(4, 5, 10);
check("the staff's +10 moves it", e.expected === 30, e);
check("formats as a range", formatEta(etaFor(4, 5)) === "~15–30 دقيقة" && formatEta(etaFor(4, 5), "en") === "~15–30 min");
check("a long wait reads in hours", formatEta(etaFor(30, 6)).includes("ساعة"));

// ── Local time ───────────────────────────────────────────────────
const dubai = "Asia/Dubai";
check("1am Friday is still Thursday's service", serviceDay(dubai, new Date("2026-10-01T21:00:00Z")) === "2026-10-01"); // 01:00 Fri local
check("5am is the new day", serviceDay(dubai, new Date("2026-10-02T01:00:00Z")) === "2026-10-02"); // 05:00 local
check("local wall clock to UTC", zonedToUtc(dubai, "2026-10-01", "10:00").toISOString() === "2026-10-01T06:00:00.000Z");
const hours = { "4": { open: "12:00", close: "02:00" }, "5": { open: "13:00", close: "23:00" } } as any; // Thu, Fri
const w = openWindow(hours, dubai, "2026-10-01")!; // Thursday
check("a close after midnight runs into the next day", w.end.toISOString() === "2026-10-01T22:00:00.000Z", w);
check("open at 1am after a Thursday night", isOpenAt(hours, dubai, new Date("2026-10-01T21:00:00Z")).open);
check("closed at 3am", !isOpenAt(hours, dubai, new Date("2026-10-01T23:00:00Z")).open);
check("no hours set reads as open", isOpenAt({}, dubai).open && !isOpenAt({}, dubai).known);
check("closed day knows when it opens next", !!isOpenAt(hours, dubai, new Date("2026-10-03T08:00:00Z")).opensAt);
check("localDate in Dubai", localDate(dubai, new Date("2026-10-01T21:00:00Z")) === "2026-10-02");

// ── Booking slots ────────────────────────────────────────────────
const fri = { "5": { open: "13:00", close: "17:00" } } as any;
const rules = { slotMin: 60, capacityPerSlot: 2, leadTimeMin: 0 };
const now = new Date("2026-09-30T00:00:00Z");
let slots = availableSlots("2026-10-02", fri, dubai, rules, [], now);
check("four hourly slots between 13:00 and 17:00", slots.length === 4, slots.map((s) => s.start));
const at13 = zonedToUtc(dubai, "2026-10-02", "13:00");
const full = [{ startsAt: at13, endsAt: new Date(at13.getTime() + 3_600_000) }, { startsAt: at13, endsAt: new Date(at13.getTime() + 3_600_000) }];
slots = availableSlots("2026-10-02", fri, dubai, rules, full, now);
check("a full slot is not offered", slots.length === 3 && !slots.some((s) => s.start === at13.toISOString()));
check("fits refuses the third booking", !fits(at13, rules, full) && fits(at13, rules, full.slice(1)));
slots = availableSlots("2026-10-02", fri, dubai, { ...rules, durationMin: 90 }, [], now);
check("a 90-minute service needs room before closing", slots.length === 3, slots.length);
slots = availableSlots("2026-10-02", fri, dubai, { ...rules, leadTimeMin: 120 }, [], new Date(at13.getTime() - 30 * 60_000));
check("lead time hides the next two hours", slots.length === 2, slots.length);
check("a closed day has no slots", availableSlots("2026-10-03", fri, dubai, rules, [], now).length === 0);

// ── Codes in messages ────────────────────────────────────────────
check("the prefilled join message gives its code", extractCode("انضمام للصف A-27\nرمز 7F3K") === "7F3K");
check("an order message with #", extractCode("🧾 طلب جديد #K7M3\n2× برجر") === "K7M3");
check("English and lower case", extractCode("Join queue A-3 code 7f3k") === "7F3K");
check("Arabic-Indic digits are read", extractCode("رمز ٧F٣K") === "7F3K");
check("a word that is not a code is not one", extractCode("السلام عليكم") === null);
check("a code with letters outside the alphabet is refused", extractCode("رمز O0I1") === null);
check("codes never use 0/O/1/I", !/[01OI]/.test(CODE_ALPHABET) && [...Array(200)].every(() => /^[2-9A-HJ-NP-Z]{4}$/.test(randomCode(4))));
check("«كم قدامي» is a status question", queueCommand("كم قدامي؟") === "status" && queueCommand("متى دوري") === "status");
check("«إلغاء الدور» leaves — and is not the bare opt-out word", queueCommand("إلغاء الدور") === "leave" && queueCommand("إلغاء") === null);
check("«المنيو» asks for the link", queueCommand("المنيو") === "menu");
check("ordinary chat is not a command", queueCommand("ابغى اطلب برجر") === null);

// ── Shop addresses ───────────────────────────────────────────────
check("a plain slug is valid", isValidSlug("al-noor") && isValidSlug("cafe24"));
check("dashboard routes are reserved", !isValidSlug("dashboard") && !isValidSlug("api") && !isValidSlug("t") && !isValidSlug("admin"));
check("upper case and spaces are refused", slugError("Al Noor") !== null);
check("double dashes are refused", !isValidSlug("al--noor"));
check("Arabic names transliterate", slugify("مطعم النور") === "mtam-alnwr", slugify("مطعم النور"));
check("English names slug cleanly", slugify("Café Noor & Co.") === "cafe-noor-co", slugify("Café Noor & Co."));

// ── Templates ────────────────────────────────────────────────────
check("Arabic variables fill", renderTemplate("أهلاً {الاسم}، رقمك {الرقم}", { name: "سارة", number: "A-3" }) === "أهلاً سارة، رقمك A-3");
check("English aliases fill", renderTemplate("Hi {name}", { name: "Sara" }) === "Hi Sara");
check("an empty variable leaves no stray space before the comma", renderTemplate("أهلاً {الاسم}، تفضل", {}) === "أهلاً، تفضل");
check("wa.me link has digits and the text", waMeLink("+971 50 123 4567", "رمز 7F3K") === "https://wa.me/971501234567?text=%D8%B1%D9%85%D8%B2%207F3K");
check("no number, no link", waMeLink(null, "x") === null);

// ── Lanes ────────────────────────────────────────────────────────
const n0 = Date.now();
check("a customer who wrote in the last day: reply lane", laneFor(new Date(n0 - 3_600_000), false, n0) === "replied");
check("wrote two days ago, typed their number: consented lane", laneFor(new Date(n0 - 2 * REPLIED_WINDOW_MS), true, n0) === "consented");
check("a stranger: no lane at all", laneFor(null, false, n0) === null);

// ── Scheduling and keys ──────────────────────────────────────────
check("a 1am review request waits for 10am", withinDaytime(new Date("2026-10-01T21:00:00Z"), dubai).toISOString() === "2026-10-02T06:00:00.000Z");
check("an 11pm one waits for tomorrow 10am", withinDaytime(new Date("2026-10-01T19:00:00Z"), dubai).toISOString() === "2026-10-02T06:00:00.000Z");
check("a 3pm one goes now", withinDaytime(new Date("2026-10-01T11:00:00Z"), dubai).toISOString() === "2026-10-01T11:00:00.000Z");
const k = joinKey("secret", 1_000_000_000_000);
check("the in-store key is valid now and for the previous window", joinKeyValid("secret", k, 1_000_000_000_000) && joinKeyValid("secret", k, 1_000_000_000_000 + 5 * 60_000));
check("…and not after that", !joinKeyValid("secret", k, 1_000_000_000_000 + 11 * 60_000));
check("…nor with another shop's secret", !joinKeyValid("other", k, 1_000_000_000_000));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
