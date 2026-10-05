// ── Orders that end on WhatsApp ───────────────────────────────────
// «أرسل الطلب على واتساب» creates the order here first, priced by the server
// against the menu as stored, then opens WhatsApp with the order written out
// and its code. The message arriving is what tells us who ordered; until then
// the order is `pending` and the kitchen does not see it as real.

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, ordersTable, branchesTable, orgsTable, notificationsTable, giftCardUsesTable, type Order, type Org, type Branch } from "@workspace/db";
import { priceCart, formatMoney, waMeLink, formatClock, formatDayLabel, localDate, type CartLineInput, type PublicOrderView } from "@workspace/menu-shared";
import { priceableItems, closedSectionLine } from "../menu/service";
import { freshCode, todayFor } from "../queue/engine";
import { token as newToken } from "../tenancy/org";
import { publish } from "../realtime";
import { touchCustomer, normalisePhone } from "../customers";
import { enqueue, cancelQueued } from "../notify/outbox";
import { renderFor, type TemplateKey } from "../notify/templates";
import { publicUrl, orderPath } from "../menu/urls";
import { alertShop } from "../notify/alerts";
import { resolveDeal, claimUse, releaseUse } from "../growth/deals";
import { giftByCode, giftProblem, spendGift, refundGift } from "../growth/gifts";
import { shouldAskBirthday } from "../growth/birthday";
import { addStamp, loyaltyFor } from "../growth/loyalty";
import { friendDiscount, recordReferral, rewardReferral, voidReferral, referralFor } from "../growth/referrals";

export class OrderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const ORDER_TYPES = ["dine_in", "pickup", "delivery", "preorder"] as const;
export type OrderType = typeof ORDER_TYPES[number];
export const ORDER_FLOW = ["pending", "received", "preparing", "ready", "completed", "cancelled"] as const;

const TYPE_AR: Record<OrderType, string> = { dine_in: "داخل المحل", pickup: "استلام", delivery: "توصيل", preorder: "طلب مسبق" };
const TYPE_EN: Record<OrderType, string> = { dine_in: "Dine-in", pickup: "Pickup", delivery: "Delivery", preorder: "Pre-order" };

export interface NewOrder {
  lines: CartLineInput[];
  type?: string;
  tableLabel?: string | null;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  scheduledFor?: string | null;
  marketingOptIn?: boolean;
  lang?: "ar" | "en";
  /** A coupon typed at checkout; with none, the best timed deal applies by itself. */
  couponCode?: string | null;
  /** «ادعُ صديقاً»: the share code the customer arrived with. */
  referralCode?: string | null;
}

/** What the customer pays. */
export const orderTotal = (o: Pick<Order, "subtotal" | "discount"> & { giftAmount?: string | null }) => Math.round((Number(o.subtotal) - Number(o.discount ?? 0) - Number(o.giftAmount ?? 0)) * 100) / 100;

/** The WhatsApp message a customer sends to place the order. */
export function orderMessage(o: Pick<Order, "code" | "type" | "tableLabel" | "items" | "subtotal" | "discount" | "dealTitle" | "giftAmount" | "notes" | "scheduledFor" | "customerName" | "address">, org: Pick<Org, "currency" | "timezone">, lang: "ar" | "en" = "ar"): string {
  const t = o.type as OrderType;
  const L: string[] = [];
  L.push(lang === "ar" ? `🧾 طلب جديد #${o.code}` : `🧾 New order #${o.code}`);
  L.push(lang === "ar" ? `النوع: ${TYPE_AR[t] ?? t}${o.tableLabel ? ` · طاولة ${o.tableLabel}` : ""}` : `Type: ${TYPE_EN[t] ?? t}${o.tableLabel ? ` · table ${o.tableLabel}` : ""}`);
  if (o.scheduledFor) {
    const d = localDate(org.timezone, o.scheduledFor);
    L.push(`${lang === "ar" ? "الموعد" : "For"}: ${formatDayLabel(d, org.timezone, lang)} ${formatClock(o.scheduledFor, org.timezone, lang)}`);
  }
  L.push("");
  for (const l of o.items) {
    const opts = l.options.length ? ` (${l.options.map((x) => x.choice).join("، ")})` : "";
    L.push(`${l.qty}× ${lang === "en" && l.nameEn ? l.nameEn : l.name}${opts} — ${formatMoney(l.lineTotal, org.currency, lang)}`);
    if (l.note) L.push(`   ↳ ${l.note}`);
  }
  L.push("");
  if (Number(o.discount) > 0) {
    L.push(`${lang === "ar" ? "المجموع" : "Subtotal"}: ${formatMoney(Number(o.subtotal), org.currency, lang)}`);
    L.push(`${o.dealTitle ?? (lang === "ar" ? "الخصم" : "Discount")}: −${formatMoney(Number(o.discount), org.currency, lang)}`);
  }
  if (Number(o.giftAmount) > 0) L.push(`${lang === "ar" ? "🎁 بطاقة هدية" : "🎁 Gift card"}: −${formatMoney(Number(o.giftAmount), org.currency, lang)}`);
  L.push(`${lang === "ar" ? "الإجمالي" : "Total"}: ${formatMoney(orderTotal(o), org.currency, lang)}`);
  if (o.customerName) L.push(`${lang === "ar" ? "الاسم" : "Name"}: ${o.customerName}`);
  if (o.address) L.push(`${lang === "ar" ? "العنوان" : "Address"}: ${o.address}`);
  if (o.notes) L.push(`${lang === "ar" ? "ملاحظات" : "Notes"}: ${o.notes}`);
  return L.join("\n");
}

export async function createOrder(org: Org, branch: Branch, input: NewOrder): Promise<Order> {
  const type = (ORDER_TYPES as readonly string[]).includes(String(input.type)) ? input.type as OrderType : "pickup";
  const items = await priceableItems(org, branch.id);
  const priced = priceCart(items, input.lines);
  if (!priced.ok) throw new OrderError(400, priced.error);
  let scheduledFor: Date | null = null;
  if (input.scheduledFor) {
    const d = new Date(input.scheduledFor);
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - 5 * 60_000) throw new OrderError(400, "موعد الطلب غير صالح");
    if (d.getTime() > Date.now() + 90 * 24 * 3_600_000) throw new OrderError(400, "الموعد بعيد جداً");
    scheduledFor = d;
  }
  if (type === "preorder" && !scheduledFor) throw new OrderError(400, "اختر موعد الاستلام");
  // A section with hours (breakfast…) is ordered only while it is served — or for a time when it is.
  const shut = await closedSectionLine(org, [...new Set(input.lines.map((l) => Number(l.itemId)).filter(Number.isFinite))], scheduledFor ?? new Date());
  if (shut) throw new OrderError(400, `«${shut.item}» من قسم ${shut.section}${shut.from ? ` ويُقدَّم من ${shut.from} إلى ${shut.to}` : ""} — احذفه أو اطلبه بموعد لاحق`);
  if (type === "delivery" && !String(input.address ?? "").trim()) throw new OrderError(400, "اكتب عنوان التوصيل");
  const phone = normalisePhone(input.phone, org.currency);
  // The code box takes a coupon or a gift card; a gift card pays after the timed deal.
  const gift = input.couponCode ? await giftByCode(org.id, input.couponCode) : null;
  const deal = await resolveDeal(org, branch.id, priced.subtotal, { code: gift ? null : input.couponCode, phone });
  if (deal && "error" in deal) throw new OrderError(400, deal.error);
  if (deal && !(await claimUse(deal.deal.id))) throw new OrderError(400, "انتهى عدد مرات استخدام هذا العرض");
  let discount = deal ? deal.discount : 0;
  let dealId = deal?.deal.id ?? null, dealTitle = deal?.deal.title ?? null;
  // A friend's first order: their discount, when it beats the timed deal (a typed code always wins).
  const friend = !input.couponCode ? await friendDiscount(org, input.referralCode, phone, priced.subtotal) : null;
  if (friend && friend.discount > discount) {
    if (dealId) await releaseUse(dealId);
    discount = friend.discount; dealId = null; dealTitle = "هدية من صديقك";
  }
  let giftAmount = 0, giftUse: number | null = null;
  if (gift) {
    const problem = giftProblem(gift);
    if (problem) { if (dealId) await releaseUse(dealId); throw new OrderError(400, problem); }
    giftAmount = Math.round(Math.min(Number(gift.balance), priced.subtotal - discount) * 100) / 100;
    giftUse = await spendGift(gift.id, giftAmount, { note: "طلب من المنيو" });
    if (giftAmount > 0 && !giftUse) { if (dealId) await releaseUse(dealId); throw new OrderError(400, "رصيد البطاقة تغيّر — حدّث الصفحة"); }
  }
  const code = await freshCode(org.id, todayFor(org));
  const [o] = await db.insert(ordersTable).values({
    orgId: org.id, branchId: branch.id, code, token: newToken(16), type,
    tableLabel: String(input.tableLabel ?? "").trim().slice(0, 20) || null,
    customerName: String(input.customerName ?? "").trim().slice(0, 80) || null,
    phone, address: String(input.address ?? "").trim().slice(0, 300) || null,
    items: priced.lines, subtotal: String(priced.subtotal),
    discount: String(discount), dealId, dealTitle,
    giftCardId: gift && giftAmount > 0 ? gift.id : null, giftAmount: String(giftAmount),
    notes: String(input.notes ?? "").trim().slice(0, 500) || null,
    // A number typed at checkout makes the order real at once: the customer
    // gets it on WhatsApp without having to send anything. With no number,
    // it waits for their WhatsApp message (the wa.me link).
    scheduledFor, status: phone ? "received" : "pending", marketingOptIn: !!input.marketingOptIn,
  }).returning();
  if (giftUse) await db.update(giftCardUsesTable).set({ orderId: o!.id }).where(eq(giftCardUsesTable.id, giftUse));
  if (friend && dealTitle === "هدية من صديقك" && phone) await recordReferral(org.id, friend.referrerPhone, phone, o!.id);
  publish(`orders:${branch.id}`);
  if (phone) {
    await touchCustomer(org.id, phone, { name: o!.customerName, order: { total: orderTotal(o!), itemIds: priced.lines.map((l) => l.itemId) }, optIn: o!.marketingOptIn, branchId: branch.id });
    await notifyOrder(o!, "order_received");
    await alertShop(org, branch, "alert_order", shopAlertText(o!, org), { type: "order", id: o!.id });
  }
  return o!;
}

/** What the owner's phone is told about a new order. */
function shopAlertText(o: Order, org: Pick<Org, "currency" | "timezone">): string {
  return `🔔 ${orderMessage(o, org, "ar")}${o.phone ? `\nالزبون: ${o.phone}` : ""}`;
}

export async function orderByToken(token: string): Promise<Order | null> {
  const [o] = await db.select().from(ordersTable).where(eq(ordersTable.token, token)).limit(1);
  return o ?? null;
}

async function ctxOf(o: Order) {
  const rows = await db.select({ b: branchesTable, org: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId)).where(eq(branchesTable.id, o.branchId)).limit(1);
  return rows[0] ? { branch: rows[0].b, org: rows[0].org } : null;
}

/** An order's lines as cart lines again: options grouped back into selections. Pure. */
export function reorderLines(o: Pick<Order, "items">): PublicOrderView["reorder"] {
  return o.items.map((l) => {
    const groups = new Map<string, string[]>();
    for (const x of l.options ?? []) groups.set(x.group, [...(groups.get(x.group) ?? []), x.choice]);
    return { itemId: l.itemId, qty: l.qty, selections: [...groups].map(([group, choices]) => ({ group, choices })), ...(l.note ? { note: l.note } : {}) };
  });
}

/** The last real order this phone placed at this shop — for «نفس الطلب». */
export async function lastOrderOf(orgId: number, phone: string): Promise<Order | null> {
  const [o] = await db.select().from(ordersTable)
    .where(and(eq(ordersTable.orgId, orgId), eq(ordersTable.phone, phone), sql`${ordersTable.status} NOT IN ('pending', 'cancelled')`))
    .orderBy(sql`${ordersTable.id} DESC`).limit(1);
  return o ?? null;
}

export async function orderView(o: Order): Promise<PublicOrderView | null> {
  const c = await ctxOf(o);
  if (!c) return null;
  const lang = c.org.defaultLang === "en" ? "en" : "ar";
  return {
    code: o.code, token: o.token, status: o.status, type: o.type, tableLabel: o.tableLabel,
    items: o.items.map((l) => ({ name: l.name, nameEn: l.nameEn, qty: l.qty, unitPrice: l.unitPrice, options: l.options.map((x) => ({ group: x.group, choice: x.choice })), note: l.note, lineTotal: l.lineTotal })),
    subtotal: Number(o.subtotal), discount: Number(o.discount), giftAmount: Number(o.giftAmount), total: orderTotal(o), dealTitle: o.dealTitle, scheduledFor: o.scheduledFor?.toISOString() ?? null,
    whatsappLinked: o.phoneVerified,
    waLink: waMeLink(c.branch.waPhone, orderMessage(o, c.org, lang)),
    createdAt: o.createdAt.toISOString(),
    reorder: reorderLines(o),
    askBirthday: await shouldAskBirthday(c.org, o.phone),
    loyalty: o.status === "pending" ? null : await loyaltyFor(c.org, o.phone),
    referral: o.status === "pending" ? null : await referralFor(c.org, c.branch.slug, o.phone),
    org: { name: c.org.name, nameEn: c.org.nameEn, slug: c.org.slug, logoUrl: c.org.logoUrl, theme: c.org.theme, vertical: c.org.vertical as any, currency: c.org.currency, defaultLang: lang },
    branch: { name: c.branch.name, nameEn: c.branch.nameEn, slug: c.branch.slug, address: c.branch.address, mapUrl: c.branch.mapUrl },
  };
}

const STATUS_NOTIFY: Partial<Record<string, TemplateKey>> = {
  received: "order_received", preparing: "order_preparing", ready: "order_ready", cancelled: "order_cancelled",
};

export async function notifyOrder(o: Order, key: TemplateKey) {
  if (!o.phone) return;
  // An undo (ready → preparing → ready) must not tell the customer twice.
  const [already] = await db.select({ id: notificationsTable.id }).from(notificationsTable).where(and(
    eq(notificationsTable.refType, "order"), eq(notificationsTable.refId, o.id), eq(notificationsTable.kind, key),
    inArray(notificationsTable.status, ["queued", "sent"]),
  )).limit(1);
  if (already) return;
  const c = await ctxOf(o);
  if (!c) return;
  const lang = c.org.defaultLang === "en" ? "en" : "ar";
  const details = o.items.map((l) => `${l.qty}× ${lang === "en" && l.nameEn ? l.nameEn : l.name}`).join("\n");
  const text = await renderFor(c.org.id, key, lang, {
    name: o.customerName ?? "", number: `#${o.code}`, details, total: formatMoney(orderTotal(o), c.org.currency, lang),
    branch: lang === "en" ? (c.branch.nameEn || c.branch.name) : c.branch.name,
    shop: lang === "en" ? (c.org.nameEn || c.org.name) : c.org.name,
    link: publicUrl(orderPath(o.token)),
  });
  await enqueue({ org: c.org, waUserId: c.branch.waUserId, phone: o.phone, kind: key, text, refType: "order", refId: o.id, consented: !o.phoneVerified });
}

/** The customer's WhatsApp message arrived: the order is real now. */
export async function confirmOrderFromWhatsApp(o: Order, phone: string): Promise<Order> {
  const [u] = await db.update(ordersTable).set({
    phone, phoneVerified: true, status: o.status === "pending" ? "received" : o.status, updatedAt: new Date(),
  }).where(eq(ordersTable.id, o.id)).returning();
  if (o.status === "pending") {
    await touchCustomer(o.orgId, phone, {
      name: o.customerName, order: { total: orderTotal(o), itemIds: o.items.map((l) => l.itemId) },
      optIn: o.marketingOptIn, branchId: o.branchId,
    });
    await notifyOrder(u!, "order_received");
    const c = await ctxOf(u!);
    if (c) await alertShop(c.org, c.branch, "alert_order", shopAlertText(u!, c.org), { type: "order", id: u!.id });
  }
  publish(`orders:${o.branchId}`);
  return u!;
}

export async function setOrderStatus(orgId: number, branchIds: number[], id: number, status: string): Promise<Order> {
  if (!(ORDER_FLOW as readonly string[]).includes(status)) throw new OrderError(400, "حالة غير معروفة");
  const [o] = await db.select().from(ordersTable).where(and(eq(ordersTable.id, id), eq(ordersTable.orgId, orgId), inArray(ordersTable.branchId, branchIds))).limit(1);
  if (!o) throw new OrderError(404, "الطلب غير موجود");
  if (o.status === status) return o;
  const [u] = await db.update(ordersTable).set({ status, updatedAt: new Date() }).where(eq(ordersTable.id, o.id)).returning();
  // An order the staff accept by hand (a pending one whose message never
  // came, taken over the counter) counts for the customer like any other.
  if (o.status === "pending" && status !== "cancelled" && u!.phone) {
    await touchCustomer(o.orgId, u!.phone, { name: o.customerName, order: { total: orderTotal(o), itemIds: o.items.map((l) => l.itemId) }, branchId: o.branchId });
  }
  if (status === "completed" || status === "cancelled") await cancelQueued("order", o.id);
  // A cancelled order gives back what it took: the coupon's use, the gift card's amount.
  if (status === "cancelled") {
    if (o.dealId) await releaseUse(o.dealId);
    if (o.giftCardId && Number(o.giftAmount) > 0) await refundGift(o.giftCardId, Number(o.giftAmount), o.id);
    await voidReferral(o.id);
  }
  // The friend's order is done: the customer who invited them gets their gift.
  if (status === "completed") {
    await rewardReferral(u!);
    const c = u!.phone ? await ctxOf(u!) : null;
    if (c) await addStamp(c.org, c.branch, u!.phone);
  }
  const key = STATUS_NOTIFY[status];
  if (key && !(status === "received" && o.status !== "pending")) await notifyOrder(u!, key);
  publish(`orders:${o.branchId}`);
  return u!;
}

export async function listOrders(orgId: number, branchIds: number[], opts: { status?: string[]; sinceHours?: number; limit?: number } = {}) {
  const since = new Date(Date.now() - (opts.sinceHours ?? 36) * 3_600_000);
  return db.select().from(ordersTable).where(and(
    eq(ordersTable.orgId, orgId), inArray(ordersTable.branchId, branchIds), gte(ordersTable.createdAt, since),
    ...(opts.status?.length ? [inArray(ordersTable.status, opts.status)] : []),
  )).orderBy(desc(ordersTable.createdAt)).limit(opts.limit ?? 200);
}
