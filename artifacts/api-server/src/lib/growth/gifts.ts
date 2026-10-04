// ── Gift cards ────────────────────────────────────────────────────
// Sold at the counter (or asked for on WhatsApp and paid there), sent at once
// to the recipient's WhatsApp with the buyer's words and a link to the card.
// Spent at the counter, or by typing its code in the cart — in one go or bit
// by bit. Every spend is a row, so the balance is never a guess, and a
// cancelled order gives its part back to the card.

import { randomInt } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, giftCardsTable, giftCardUsesTable, orgsTable, branchesTable, type GiftCard, type Org, type Branch } from "@workspace/db";
import { formatMoney, normaliseCode } from "@workspace/menu-shared";
import { token as newToken } from "../tenancy/org";
import { normalisePhone } from "../customers";
import { enqueue } from "../notify/outbox";
import { publicUrl, menuPath } from "../menu/urls";

export const giftPath = (token: string) => `/g/${token}`;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newGiftCode = () => `G${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

export class GiftError extends Error { constructor(public status: number, message: string) { super(message); } }

export interface NewGift { amount: unknown; recipientName?: unknown; recipientPhone?: unknown; buyerName?: unknown; buyerPhone?: unknown; message?: unknown; months?: unknown }

/** The WhatsApp the recipient gets. Pure. */
export function giftMessage(g: Pick<GiftCard, "amount" | "recipientName" | "buyerName" | "message" | "code" | "token" | "expiresAt">, org: Pick<Org, "name" | "currency">): string {
  const L = [`🎁 ${g.recipientName ? `${g.recipientName}، ` : ""}وصلتك بطاقة هدية${g.buyerName ? ` من ${g.buyerName}` : ""} بقيمة ${formatMoney(Number(g.amount), org.currency, "ar")} من ${org.name}!`];
  if (g.message) L.push("", `«${g.message}»`);
  L.push("", `بطاقتك: ${publicUrl(giftPath(g.token))}`, `الرمز: ${g.code}`, "اعرض البطاقة عند الدفع، أو اكتب الرمز في السلة عند الطلب من المنيو.");
  if (g.expiresAt) L.push(`صالحة حتى ${g.expiresAt.toISOString().slice(0, 10)}`);
  return L.join("\n");
}

export async function createGift(org: Org, branch: Branch, input: NewGift, byWho: string): Promise<GiftCard> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!(amount >= 1 && amount <= 10_000)) throw new GiftError(400, "قيمة البطاقة بين 1 و 10,000");
  const recipientPhone = input.recipientPhone ? normalisePhone(input.recipientPhone, org.currency) : null;
  if (input.recipientPhone && !recipientPhone) throw new GiftError(400, "رقم واتساب المُهدى إليه غير صحيح");
  const months = Math.max(1, Math.min(36, Math.round(Number(input.months) || 12)));
  const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n) || null;
  for (let i = 0; i < 6; i++) {
    const [g] = await db.insert(giftCardsTable).values({
      orgId: org.id, code: newGiftCode(), token: newToken(16), amount: String(amount), balance: String(amount),
      recipientName: str(input.recipientName, 80), recipientPhone, buyerName: str(input.buyerName, 80),
      buyerPhone: input.buyerPhone ? normalisePhone(input.buyerPhone, org.currency) : null,
      message: str(input.message, 300), expiresAt: new Date(Date.now() + months * 30 * 24 * 3_600_000), createdBy: byWho.slice(0, 80),
    }).onConflictDoNothing().returning();
    if (!g) continue;
    // The buyer typed the number and asked for it to be sent: a gift, not a campaign.
    if (recipientPhone) await enqueue({ org, waUserId: branch.waUserId, phone: recipientPhone, kind: "gift_card", text: giftMessage(g, org), consented: true, refType: "customer" });
    return g;
  }
  throw new GiftError(500, "تعذّر إنشاء رمز فريد");
}

export async function giftByCode(orgId: number, code: string) {
  const c = normaliseCode(code);
  if (!/^G[A-Z0-9]{6}$/.test(c)) return null;
  const [g] = await db.select().from(giftCardsTable).where(and(eq(giftCardsTable.orgId, orgId), eq(giftCardsTable.code, c))).limit(1);
  return g ?? null;
}

/** Why a card cannot be spent now, or null. Pure. */
export function giftProblem(g: Pick<GiftCard, "status" | "balance" | "expiresAt">, now = new Date()): string | null {
  if (g.status === "void") return "هذه البطاقة أُلغيت";
  if (Number(g.balance) <= 0 || g.status === "used") return "رصيد البطاقة صفر";
  if (g.expiresAt && g.expiresAt <= now) return "انتهت صلاحية البطاقة";
  return null;
}

/** Take `amount` off the card, atomically; the spend's id, or null if the balance is not there any more. */
export async function spendGift(id: number, amount: number, o: { orderId?: number | null; note?: string | null; byWho?: string | null } = {}): Promise<number | null> {
  if (!(amount > 0)) return null;
  const r = await db.update(giftCardsTable).set({
    balance: sql`${giftCardsTable.balance} - ${amount}`,
    status: sql`CASE WHEN ${giftCardsTable.balance} - ${amount} <= 0 THEN 'used' ELSE 'active' END`,
  }).where(and(eq(giftCardsTable.id, id), eq(giftCardsTable.status, "active"), sql`${giftCardsTable.balance} >= ${amount}`,
    sql`(${giftCardsTable.expiresAt} IS NULL OR ${giftCardsTable.expiresAt} > now())`)).returning({ id: giftCardsTable.id });
  if (!r.length) return null;
  const [u] = await db.insert(giftCardUsesTable).values({ giftCardId: id, amount: String(amount), orderId: o.orderId ?? null, note: o.note ?? null, byWho: o.byWho ?? null }).returning({ id: giftCardUsesTable.id });
  return u!.id;
}

/** A cancelled order gives its part back to the card. */
export async function refundGift(id: number, amount: number, orderId: number) {
  if (!(amount > 0)) return;
  await db.update(giftCardsTable).set({ balance: sql`${giftCardsTable.balance} + ${amount}`, status: sql`CASE WHEN ${giftCardsTable.status} = 'void' THEN 'void' ELSE 'active' END` }).where(eq(giftCardsTable.id, id));
  await db.insert(giftCardUsesTable).values({ giftCardId: id, amount: String(-amount), orderId, note: "استرجاع — أُلغي الطلب" });
}

export async function giftView(token: string) {
  const [row] = await db.select({ g: giftCardsTable, o: orgsTable }).from(giftCardsTable).innerJoin(orgsTable, eq(orgsTable.id, giftCardsTable.orgId)).where(eq(giftCardsTable.token, token)).limit(1);
  if (!row) return null;
  const { g, o } = row;
  const [b] = await db.select().from(branchesTable).where(and(eq(branchesTable.orgId, o.id), eq(branchesTable.isActive, true))).orderBy(branchesTable.sort).limit(1);
  return {
    code: g.code, amount: Number(g.amount), balance: Number(g.balance), status: g.status, problem: giftProblem(g),
    recipientName: g.recipientName, buyerName: g.buyerName, message: g.message, expiresAt: g.expiresAt?.toISOString() ?? null,
    org: { name: o.name, nameEn: o.nameEn, slug: o.slug, logoUrl: o.logoUrl, coverUrl: o.coverUrl, theme: o.theme, currency: o.currency, defaultLang: o.defaultLang, vertical: o.vertical },
    menuUrl: menuPath(o.slug, b?.slug),
  };
}

export async function listGifts(orgId: number) {
  const rows = await db.select().from(giftCardsTable).where(eq(giftCardsTable.orgId, orgId)).orderBy(desc(giftCardsTable.id)).limit(300);
  const [s] = await db.select({
    sold: sql<number>`coalesce(sum(amount) filter (where status <> 'void'), 0)::float`,
    outstanding: sql<number>`coalesce(sum(balance) filter (where status = 'active' and (expires_at is null or expires_at > now())), 0)::float`,
    count: sql<number>`count(*) filter (where status <> 'void')::int`,
  }).from(giftCardsTable).where(eq(giftCardsTable.orgId, orgId));
  return { stats: { ...s!, redeemed: Math.max(0, (s?.sold ?? 0) - (s?.outstanding ?? 0)) }, cards: rows };
}

export async function giftUses(id: number) {
  return db.select().from(giftCardUsesTable).where(eq(giftCardUsesTable.giftCardId, id)).orderBy(desc(giftCardUsesTable.id)).limit(50);
}
