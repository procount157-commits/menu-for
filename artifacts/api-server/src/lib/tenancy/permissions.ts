// ── Which routes each staff permission opens ──────────────────────
// Default deny. Every Flow Hub route checks only `requireAuth`, which a staff
// session passes, so without this a cashier could open the campaigns or
// unlink the shop's WhatsApp. A route, old or new, that no permission below
// names answers 403 to staff — forgetting to list a new route fails closed.
//
// «مدير كامل» (admin) opens everything the owner reaches, except what belongs
// to the owner's own account rather than the shop: their sign-in links, the
// subscription, and making a shop.

import type { StaffPerm } from "@workspace/menu-shared";

type Rule = [method: string, path: RegExp];

/** What any signed-in member of staff needs, whatever they may do. */
const BASE: Rule[] = [
  ["GET",  /^\/auth\/me$/],
  ["POST", /^\/auth\/logout$/],
  ["*",    /^\/staff-auth\//],
  ["GET",  /^\/tenancy\/(me|queues)$/],
  ["POST", /^\/tenancy\/branch$/],
  ["GET",  /^\/whatsapp\/status$/],
  ["GET",  /^\/menu\/(items|categories)$/],
  ["*",    /^\/public\//],
  ["GET",  /^\/healthz$/],
  ["GET",  /^\/ping$/],
];

export const PERM_ROUTES: Record<Exclude<StaffPerm, "admin">, Rule[]> = {
  queue:     [["*", /^\/queue(\/|$)/]],
  orders:    [["*", /^\/orders(\/|$)/], ["PATCH", /^\/menu\/availability$/]],
  bookings:  [["*", /^\/bookings(\/|$)/]],
  menu: [
    ["*",    /^\/menu\/(items|categories|offers)(\/|$)/],
    ["PATCH", /^\/menu\/availability$/],
    ["POST", /^\/menu\/images$/],
    ["POST", /^\/menu\/(import|import-photo|import-rows|translate)$/],
  ],
  customers: [["GET", /^\/customers(\/|$)/], ["GET", /^\/customers-export\.csv$/]],
  reports:   [["GET", /^\/reports(\/|$)/]],
  settings:  [["*", /^\/queues(\/|$)/], ["*", /^\/booking-settings(\/|$)/], ["GET", /^\/qr(\/|$)/]],
  chats: [
    ["*",   /^\/whatsapp\/inbox(\/|$)/],
    ["GET", /^\/whatsapp\/(extractor|sync-state)(\/|$)/],
    ["*",   /^\/lead-cards(\/|$)/],
    ["GET", /^\/media\/file\//],
  ],
  marketing: [
    ["*",    /^\/(campaigns|contacts|follow-ups|folders|email|wa-auto|wa-templates)(\/|$)/],
    ["GET",  /^\/notifications$/],
    ["*",    /^\/media(\/|$)/],
    ["POST", /^\/customers\/to-list$/],
    ["POST", /^\/ai\/optimize-message$/],
  ],
};

/** Even «مدير كامل» stays out of these: they are the owner's account, not the shop. */
const OWNER_ONLY: Rule[] = [
  ["*", /^\/auth\/(direct|register|login)(\/|$)/],
  ["*", /^\/admin(\/|$)/],
  ["*", /^\/plans\/admin(\/|$)/],
  ["*", /^\/coupons(\/|$)/],
  ["*", /^\/onboarding(\/|$)/],
];

const hit = (rules: Rule[], method: string, path: string) =>
  rules.some(([m, re]) => (m === "*" || m === method) && re.test(path));

/** Pure: may someone with these permissions make this request? */
export function staffMay(perms: readonly StaffPerm[], method: string, path: string): boolean {
  if (perms.includes("admin")) return !hit(OWNER_ONLY, method, path);
  if (hit(BASE, method, path)) return true;
  return perms.some((p) => p !== "admin" && hit(PERM_ROUTES[p], method, path));
}
