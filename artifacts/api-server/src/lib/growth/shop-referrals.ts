// ── Shop brings shop ──────────────────────────────────────────────
// Every shop has a link to the home page with its code. A shop that comes
// through it — by the sign-up form, by registering, or created by the admin
// with the code — is remembered; the first time it is put on a paid plan,
// both shops get 30 more days, and the one who brought it is told on
// WhatsApp. Once per shop, and never for bringing yourself.

import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, orgsTable, usersTable, branchesTable, type Org } from "@workspace/db";
import { publicUrl } from "../menu/urls";
import { alertShop } from "../notify/alerts";

export const FREE_DAYS = 30;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normaliseShopRef = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

export async function shopReferralCode(org: Pick<Org, "id" | "referralCode">): Promise<string> {
  if (org.referralCode) return org.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = `M${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
    try {
      const r = await db.update(orgsTable).set({ referralCode: code }).where(and(eq(orgsTable.id, org.id), isNull(orgsTable.referralCode))).returning({ code: orgsTable.referralCode });
      if (r.length) return code;
      const [o] = await db.select({ code: orgsTable.referralCode }).from(orgsTable).where(eq(orgsTable.id, org.id)).limit(1);
      if (o?.code) return o.code;
    } catch { /* taken: try another */ }
  }
  throw new Error("no referral code");
}

export const shopReferralLink = (code: string) => publicUrl(`/?ref=${code}`);

export async function orgByReferralCode(code: unknown) {
  const c = normaliseShopRef(code);
  if (!c) return null;
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.referralCode, c)).limit(1);
  return o ?? null;
}

/** Remember who brought this shop (only if nobody is remembered yet, and not itself). */
export async function setReferredBy(orgId: number, code: unknown): Promise<boolean> {
  const by = await orgByReferralCode(code);
  if (!by || by.id === orgId) return false;
  const r = await db.update(orgsTable).set({ referredByOrgId: by.id }).where(and(eq(orgsTable.id, orgId), isNull(orgsTable.referredByOrgId))).returning({ id: orgsTable.id });
  return r.length > 0;
}

async function addDays(ownerUserId: number, days: number) {
  await db.update(usersTable).set({
    planExpiresAt: sql`greatest(coalesce(${usersTable.planExpiresAt}, now()), now()) + make_interval(days => ${days})`,
  }).where(eq(usersTable.id, ownerUserId));
}

/** The brought shop is on a paid plan for the first time: a month for both, once. */
export async function rewardShopReferral(orgId: number): Promise<boolean> {
  const [o] = await db.update(orgsTable).set({ referralRewardedAt: new Date() })
    .where(and(eq(orgsTable.id, orgId), isNull(orgsTable.referralRewardedAt), sql`${orgsTable.referredByOrgId} IS NOT NULL`)).returning();
  if (!o) return false;
  const [by] = await db.select().from(orgsTable).where(eq(orgsTable.id, o.referredByOrgId!)).limit(1);
  if (!by) return false;
  await addDays(o.ownerUserId, FREE_DAYS);
  await addDays(by.ownerUserId, FREE_DAYS);
  const [b] = await db.select().from(branchesTable).where(and(eq(branchesTable.orgId, by.id), eq(branchesTable.isActive, true))).orderBy(branchesTable.sort).limit(1);
  if (b) await alertShop(by, b, "alert_referral", `🎉 «${o.name}» اشترك في منيو فور يو بدعوتك — أضفنا لك ${FREE_DAYS} يوماً مجاناً على اشتراكك. شكراً لك!`);
  return true;
}

export async function shopReferralStats(orgId: number) {
  const [s] = await db.select({
    brought: sql<number>`count(*)::int`,
    rewarded: sql<number>`count(*) filter (where referral_rewarded_at is not null)::int`,
  }).from(orgsTable).where(eq(orgsTable.referredByOrgId, orgId));
  return { brought: s?.brought ?? 0, rewarded: s?.rewarded ?? 0, freeDays: (s?.rewarded ?? 0) * FREE_DAYS };
}
