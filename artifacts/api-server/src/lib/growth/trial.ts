// ── The trial ─────────────────────────────────────────────────────
// A shop that signs up by itself starts on the trial plan — every switch on,
// a month's worth of messages — for the number of days the admin set. A
// shop that gets going in its first week (WhatsApp linked, a real menu)
// earns an extension once. When it ends, the account falls to the plan the
// settings name, keeping its data.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, usersTable, orgsTable, branchesTable, menuItemsTable, type Org } from "@workspace/db";
import { getStatus } from "../whatsapp";
import { loadPlans, trialSettings, type TrialSettings } from "../plans";
import { alertShop } from "../notify/alerts";

/** Put a new owner on the trial, if there is one. */
export async function startTrial(userId: number): Promise<boolean> {
  const [plans, t] = await Promise.all([loadPlans(), trialSettings()]);
  const trial = plans.get("trial");
  if (!trial?.isActive || t.days <= 0) return false;
  await db.update(usersTable).set({ plan: "trial", planExpiresAt: new Date(Date.now() + t.days * 86_400_000) }).where(eq(usersTable.id, userId));
  return true;
}

/** Pure: earned the extension? Inside the first days, WhatsApp linked, a real menu, not yet extended. */
export function earnsExtension(o: { createdAt: Date; trialExtendedAt: Date | null }, linked: boolean, items: number, t: TrialSettings, now = new Date()): boolean {
  if (o.trialExtendedAt || t.extensionDays <= 0) return false;
  if (now.getTime() - o.createdAt.getTime() > t.extensionWithinDays * 86_400_000) return false;
  return linked && items >= t.extensionMinItems;
}

/** Called when the owner opens the dashboard: cheap, and the moment they would notice. */
export async function maybeExtendTrial(org: Org, now = new Date()): Promise<number> {
  const [u] = await db.select({ plan: usersTable.plan, exp: usersTable.planExpiresAt }).from(usersTable).where(eq(usersTable.id, org.ownerUserId)).limit(1);
  if (u?.plan !== "trial" || org.trialExtendedAt) return 0;
  const t = await trialSettings();
  if (now.getTime() - org.createdAt.getTime() > t.extensionWithinDays * 86_400_000) return 0;
  const branches = await db.select().from(branchesTable).where(and(eq(branchesTable.orgId, org.id), eq(branchesTable.isActive, true)));
  const linked = branches.some((b) => (getStatus(b.waUserId) as { connected?: boolean })?.connected);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(menuItemsTable).where(eq(menuItemsTable.orgId, org.id));
  if (!earnsExtension(org, linked, n, t, now)) return 0;
  const claimed = await db.update(orgsTable).set({ trialExtendedAt: now }).where(and(eq(orgsTable.id, org.id), isNull(orgsTable.trialExtendedAt))).returning({ id: orgsTable.id });
  if (!claimed.length) return 0;
  const base = u.exp && u.exp.getTime() > now.getTime() ? u.exp : now;
  await db.update(usersTable).set({ planExpiresAt: new Date(base.getTime() + t.extensionDays * 86_400_000) }).where(eq(usersTable.id, org.ownerUserId));
  const main = branches[0];
  if (main) await alertShop(org, main, "alert_campaign", `🎁 ربطت واتساب وجهّزت منيوك في أسبوعك الأول — مددنا تجربتك ${t.extensionDays} يوماً إضافياً. كل الميزات مفتوحة لك.`);
  return t.extensionDays;
}

/** Days left, for the dashboard. Pure. */
export const daysLeft = (exp: Date | null, now = new Date()) => (exp ? Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 86_400_000)) : null);
