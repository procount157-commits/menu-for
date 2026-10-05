// ── The stamp card ────────────────────────────────────────────────
// A stamp for each finished visit, booking or completed order — one a day,
// so a family of four in one visit is one stamp. When the card is full the
// customer gets a gift code on WhatsApp for their number alone, and the card
// starts again. No app, no paper card: the ticket, order and booking pages
// show how many are left.

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, customersTable, type Org, type Branch } from "@workspace/db";
import { formatMoney, localDate } from "@workspace/menu-shared";
import { createPersonalCode } from "./deals";
import { enqueue } from "../notify/outbox";
import { publicUrl, menuPath } from "../menu/urls";
import { menuPlan } from "../plans";

export const DEFAULT_LOYALTY = { target: 10, rewardKind: "amount" as "pct" | "amount", rewardValue: 25, rewardLabel: null as string | null, rewardDays: 30 };
export const loyaltyPrefs = (org: Pick<Org, "growthPrefs">) => ({ ...DEFAULT_LOYALTY, ...(org.growthPrefs?.loyalty ?? {}) });
export const loyaltyOn = (org: Pick<Org, "features">) => !!org.features?.loyalty;

/** «هدية بقيمة 25 د.إ» / «خصم 50%» — or the owner's own words. Pure. */
export function rewardText(p: ReturnType<typeof loyaltyPrefs>, currency: string): string {
  if (p.rewardLabel?.trim()) return p.rewardLabel.trim();
  return p.rewardKind === "pct" ? `خصم ${p.rewardValue}%` : `هدية بقيمة ${formatMoney(p.rewardValue, currency, "ar")}`;
}

/** The full-card message. Pure. */
export function rewardMessage(o: { name: string | null; shop: string; target: number; reward: string; code: string; days: number; link: string }): string {
  return [
    `🎉 اكتملت بطاقتك في ${o.shop}${o.name ? ` يا ${o.name}` : ""}! ${o.target} أختام — شكراً لأنك ترجع لنا.`,
    `هديتك: ${o.reward}`,
    "", `الرمز: ${o.code} (صالح ${o.days} يوماً)`,
    "اكتبه في السلة عند الطلب، أو اعرضه عند الدفع.", o.link,
  ].join("\n");
}

export type StampResult = { stamps: number; target: number; rewarded: boolean } | null;

/** One stamp for today's visit or order; the gift when the card fills. */
export async function addStamp(org: Org, branch: Pick<Branch, "waUserId" | "slug">, phone: string | null | undefined, now = new Date()): Promise<StampResult> {
  if (!phone || !loyaltyOn(org)) return null;
  if (!(await menuPlan(org.ownerUserId)).features.loyalty) return null;
  const today = localDate(org.timezone, new Date(now.getTime() - 4 * 3_600_000));
  const [row] = await db.update(customersTable).set({
    stamps: sql`${customersTable.stamps} + 1`, stampsTotal: sql`${customersTable.stampsTotal} + 1`, lastStampDay: today,
  }).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, phone), or(isNull(customersTable.lastStampDay), ne(customersTable.lastStampDay, today))))
    .returning({ stamps: customersTable.stamps, name: customersTable.name });
  const p = loyaltyPrefs(org);
  if (!row) return null; // already stamped today
  if (row.stamps < p.target) return { stamps: row.stamps, target: p.target, rewarded: false };
  // Full: the card starts again, and the gift goes out once.
  const [done] = await db.update(customersTable).set({ stamps: sql`${customersTable.stamps} - ${p.target}`, loyaltyRewards: sql`${customersTable.loyaltyRewards} + 1` })
    .where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, phone), sql`${customersTable.stamps} >= ${p.target}`)).returning({ stamps: customersTable.stamps });
  if (!done) return { stamps: row.stamps, target: p.target, rewarded: false };
  const reward = rewardText(p, org.currency);
  const deal = await createPersonalCode(org.id, phone, { title: `بطاقة الأختام: ${reward}`.slice(0, 80), kind: p.rewardKind, value: p.rewardValue, days: p.rewardDays, source: "loyalty", prefix: "LY" });
  const text = rewardMessage({ name: row.name, shop: org.name, target: p.target, reward, code: deal.code!, days: p.rewardDays, link: publicUrl(menuPath(org.slug, branch.slug)) });
  await enqueue({ org, waUserId: branch.waUserId, phone, kind: "loyalty_reward", text, consented: true, refType: "customer" });
  return { stamps: done.stamps, target: p.target, rewarded: true };
}

/** The card as the customer's pages show it. */
export async function loyaltyFor(org: Org, phone: string | null | undefined) {
  if (!phone || !loyaltyOn(org)) return null;
  const [c] = await db.select({ stamps: customersTable.stamps }).from(customersTable).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, phone))).limit(1);
  if (!c) return null;
  const p = loyaltyPrefs(org);
  return { stamps: Math.min(c.stamps, p.target), target: p.target, reward: rewardText(p, org.currency) };
}

export async function loyaltyStats(orgId: number) {
  const [s] = (await db.execute<any>(sql`
    SELECT count(*) FILTER (WHERE stamps > 0 OR loyalty_rewards > 0)::int AS members,
      coalesce(sum(loyalty_rewards), 0)::int AS rewards,
      count(*) FILTER (WHERE stamps_total >= 2)::int AS returning,
      (SELECT count(*)::int FROM orders o JOIN shop_deals d ON d.id = o.deal_id
        WHERE o.org_id = ${orgId} AND d.source = 'loyalty' AND o.status NOT IN ('pending','cancelled')) AS redeemed
    FROM customers WHERE org_id = ${orgId}`)).rows;
  return { members: s?.members ?? 0, rewards: s?.rewards ?? 0, returning: s?.returning ?? 0, redeemed: s?.redeemed ?? 0 };
}
