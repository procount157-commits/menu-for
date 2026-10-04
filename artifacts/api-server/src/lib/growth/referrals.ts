// ── «ادعُ صديقاً» ─────────────────────────────────────────────────
// After an order, the customer gets a link to share. A friend who opens it
// and is new to the shop (no order, visit or booking yet) gets a discount on
// their first order; once that order is completed, the customer who shared
// it gets a one-time code on WhatsApp. A phone is someone's friend only
// once, and nobody is their own friend.

import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, customersTable, customerReferralsTable, branchesTable, orgsTable, type Org, type Order } from "@workspace/db";
import { money } from "@workspace/menu-shared";
import { publicUrl, menuPath } from "../menu/urls";
import { createPersonalCode } from "./deals";
import { enqueue } from "../notify/outbox";

export const DEFAULT_REFERRAL = { friendPct: 10, rewardPct: 15, rewardDays: 30 };
export const referralPrefs = (org: Pick<Org, "growthPrefs">) => ({ ...DEFAULT_REFERRAL, ...(org.growthPrefs?.referral ?? {}) });
export const referralOn = (org: Pick<Org, "features">) => !!org.features?.referral;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newRefCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const normaliseRef = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

/** This customer's share code, made the first time it is needed. */
export async function referralCodeFor(orgId: number, phone: string): Promise<string | null> {
  const [c] = await db.select({ code: customersTable.referralCode }).from(customersTable).where(and(eq(customersTable.orgId, orgId), eq(customersTable.phone, phone))).limit(1);
  if (!c) return null;
  if (c.code) return c.code;
  for (let i = 0; i < 6; i++) {
    const code = newRefCode();
    try {
      const r = await db.update(customersTable).set({ referralCode: code })
        .where(and(eq(customersTable.orgId, orgId), eq(customersTable.phone, phone), sql`${customersTable.referralCode} IS NULL`)).returning({ code: customersTable.referralCode });
      if (r.length) return code;
      const [again] = await db.select({ code: customersTable.referralCode }).from(customersTable).where(and(eq(customersTable.orgId, orgId), eq(customersTable.phone, phone))).limit(1);
      if (again?.code) return again.code;
    } catch { /* a clash with another customer's code: try another */ }
  }
  return null;
}

/** What the order page shows: the link and what it gives. */
export async function referralFor(org: Org, branchSlug: string | undefined, phone: string | null) {
  if (!referralOn(org) || !phone) return null;
  const code = await referralCodeFor(org.id, phone);
  if (!code) return null;
  const p = referralPrefs(org);
  return { link: publicUrl(`${menuPath(org.slug, branchSlug)}?ref=${code}`), friendPct: p.friendPct, rewardPct: p.rewardPct };
}

/** Whether this phone has never ordered, visited or booked here. */
async function isNewHere(orgId: number, phone: string): Promise<boolean> {
  const [c] = await db.select().from(customersTable).where(and(eq(customersTable.orgId, orgId), eq(customersTable.phone, phone))).limit(1);
  return !c || (c.ordersCount === 0 && c.visits === 0 && c.bookingsCount === 0);
}

/** The friend's discount on this first order, or null (not new, own code, already someone's friend, off). */
export async function friendDiscount(org: Org, code: unknown, phone: string | null, subtotal: number): Promise<{ referrerPhone: string; discount: number; pct: number } | null> {
  const ref = normaliseRef(code);
  if (!referralOn(org) || !ref || !phone || subtotal <= 0) return null;
  const [owner] = await db.select({ phone: customersTable.phone }).from(customersTable).where(and(eq(customersTable.orgId, org.id), eq(customersTable.referralCode, ref))).limit(1);
  if (!owner || owner.phone === phone) return null;
  const [taken] = await db.select({ id: customerReferralsTable.id }).from(customerReferralsTable).where(and(eq(customerReferralsTable.orgId, org.id), eq(customerReferralsTable.friendPhone, phone))).limit(1);
  if (taken || !(await isNewHere(org.id, phone))) return null;
  const pct = referralPrefs(org).friendPct;
  return { referrerPhone: owner.phone, discount: money((subtotal * pct) / 100), pct };
}

export async function recordReferral(orgId: number, referrerPhone: string, friendPhone: string, orderId: number) {
  await db.insert(customerReferralsTable).values({ orgId, referrerPhone, friendPhone, orderId }).onConflictDoNothing();
}

/** The friend's order was completed: the customer who shared gets their code. */
export async function rewardReferral(o: Order): Promise<boolean> {
  const [r] = await db.update(customerReferralsTable).set({ status: "rewarded", rewardedAt: new Date() })
    .where(and(eq(customerReferralsTable.orderId, o.id), eq(customerReferralsTable.status, "pending"))).returning();
  if (!r) return false;
  const [row] = await db.select({ org: orgsTable, b: branchesTable }).from(orgsTable).innerJoin(branchesTable, eq(branchesTable.id, o.branchId)).where(eq(orgsTable.id, o.orgId)).limit(1);
  if (!row) return false;
  const p = referralPrefs(row.org);
  const deal = await createPersonalCode(o.orgId, r.referrerPhone, { title: "مكافأة دعوة صديق", kind: "pct", value: p.rewardPct, days: p.rewardDays, source: "referral", prefix: "RF" });
  await db.update(customerReferralsTable).set({ rewardDealId: deal.id }).where(eq(customerReferralsTable.id, r.id));
  const text = [
    `🎉 صديقك طلب من ${row.org.name} بدعوتك!`,
    `هديتك: خصم ${p.rewardPct}% على طلبك القادم خلال ${p.rewardDays} يوماً.`,
    "", `الرمز: ${deal.code}`, "اكتبه في السلة عند الطلب، أو اعرضه عند الدفع.",
    publicUrl(menuPath(row.org.slug, row.b.slug)),
  ].join("\n");
  await enqueue({ org: row.org, waUserId: row.b.waUserId, phone: r.referrerPhone, kind: "referral_reward", text, consented: true, refType: "customer" });
  return true;
}

export async function voidReferral(orderId: number) {
  await db.update(customerReferralsTable).set({ status: "void" }).where(and(eq(customerReferralsTable.orderId, orderId), eq(customerReferralsTable.status, "pending")));
}

export async function referralStats(orgId: number) {
  const [s] = (await db.execute<any>(sql`
    SELECT count(*)::int AS friends,
      count(*) FILTER (WHERE r.status = 'rewarded')::int AS rewarded,
      coalesce(sum(o.subtotal - o.discount) FILTER (WHERE o.status NOT IN ('pending','cancelled')), 0)::float AS sales
    FROM customer_referrals r LEFT JOIN orders o ON o.id = r.order_id WHERE r.org_id = ${orgId}`)).rows;
  return { friends: s?.friends ?? 0, rewarded: s?.rewarded ?? 0, sales: s?.sales ?? 0 };
}
