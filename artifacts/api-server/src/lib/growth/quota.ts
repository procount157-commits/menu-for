// ── The month's messages ──────────────────────────────────────────
// A plan carries a number of WhatsApp messages to customers per month: a
// confirmation, a turn, a reminder, a campaign message, an AI reply. The
// shop's own alerts and its weekly report are not counted. When the month's
// allowance is used up:
//   • marketing stops first — campaigns, win-backs, birthday and loyalty
//     gifts wait for next month or for credits;
//   • operational messages (turn, order, booking) carry on into a small
//     grace (a tenth of the allowance), so «جاء دورك» is not cut off in the
//     middle of a rush — then they stop too;
//   • credits the admin granted or the shop bought are spent before the
//     grace, one per message, and never expire.
// Every take is one atomic update, so a quota of 300 is 300, not 301.

import { and, eq, sql } from "drizzle-orm";
import { db, orgsTable, branchesTable, orgUsageTable, type Org } from "@workspace/db";
import { localDate } from "@workspace/menu-shared";
import { menuPlan, trialSettings, type MenuPlan } from "../plans";

export type MessageKind = "operational" | "marketing" | "agent";
export const MARKETING_KINDS = new Set(["winback", "birthday", "loyalty_reward", "referral_reward", "gift_card"]);
export const kindOf = (notificationKind: string): MessageKind => (MARKETING_KINDS.has(notificationKind) ? "marketing" : "operational");

export const monthKey = (tz: string, now = new Date()) => localDate(tz, now).slice(0, 7);

export interface Allowance {
  month: string; monthly: number; used: number; marketing: number; agentReplies: number; agentMonthly: number;
  credits: number; creditsUsed: number; remaining: number; grace: number; share: number;
}

export async function usageOf(orgId: number, month: string) {
  const [r] = await db.select().from(orgUsageTable).where(and(eq(orgUsageTable.orgId, orgId), eq(orgUsageTable.month, month))).limit(1);
  return r ?? { orgId, month, messages: 0, marketing: 0, agentReplies: 0, campaigns: 0, creditsUsed: 0 };
}

/** Where the shop stands this month. */
export async function allowance(org: Pick<Org, "id" | "timezone" | "ownerUserId" | "messageCredits">, plan?: MenuPlan): Promise<Allowance> {
  const p = plan ?? (await menuPlan(org.ownerUserId));
  const month = monthKey(org.timezone);
  const [u, t, fresh] = await Promise.all([usageOf(org.id, month), trialSettings(), db.select({ c: orgsTable.messageCredits }).from(orgsTable).where(eq(orgsTable.id, org.id)).limit(1)]);
  const credits = fresh[0]?.c ?? org.messageCredits ?? 0;
  const monthly = p.limits.messagesMonthly;
  const remaining = monthly < 0 ? -1 : Math.max(0, monthly - u.messages) + credits;
  return {
    month, monthly, used: u.messages, marketing: u.marketing, agentReplies: u.agentReplies, agentMonthly: p.limits.agentRepliesMonthly,
    credits, creditsUsed: u.creditsUsed, remaining, grace: monthly < 0 ? 0 : Math.ceil(monthly * t.graceShare),
    share: monthly > 0 ? Math.min(1, u.messages / monthly) : 0,
  };
}

async function bump(orgId: number, month: string, kind: MessageKind, fromCredit: boolean) {
  await db.insert(orgUsageTable).values({ orgId, month, messages: 1, marketing: kind === "marketing" ? 1 : 0, agentReplies: kind === "agent" ? 1 : 0, creditsUsed: fromCredit ? 1 : 0 })
    .onConflictDoUpdate({
      target: [orgUsageTable.orgId, orgUsageTable.month],
      set: {
        messages: sql`${orgUsageTable.messages} + 1`,
        marketing: sql`${orgUsageTable.marketing} + ${kind === "marketing" ? 1 : 0}`,
        agentReplies: sql`${orgUsageTable.agentReplies} + ${kind === "agent" ? 1 : 0}`,
        creditsUsed: sql`${orgUsageTable.creditsUsed} + ${fromCredit ? 1 : 0}`,
      },
    });
}

export type Take = { ok: true; fromCredit: boolean; share: number } | { ok: false; reason: "quota" | "quota_marketing" | "quota_agent" | "plan" };

/** Take one message of the month, or say why not. */
export async function takeMessage(org: Pick<Org, "id" | "timezone" | "ownerUserId" | "messageCredits">, kind: MessageKind, plan?: MenuPlan): Promise<Take> {
  const p = plan ?? (await menuPlan(org.ownerUserId));
  if (p.isAdmin) return { ok: true, fromCredit: false, share: 0 };
  if (kind === "agent" && !p.features.agent) return { ok: false, reason: "plan" };
  if (kind !== "agent" && !p.features.notify) return { ok: false, reason: "plan" };
  const month = monthKey(org.timezone);
  const u = await usageOf(org.id, month);
  if (kind === "agent" && p.limits.agentRepliesMonthly >= 0 && u.agentReplies >= p.limits.agentRepliesMonthly) return { ok: false, reason: "quota_agent" };
  const monthly = p.limits.messagesMonthly;
  if (monthly < 0) { await bump(org.id, month, kind, false); return { ok: true, fromCredit: false, share: 0 }; }
  // Inside the allowance: one atomic step while there is room.
  const inside = await db.execute<{ messages: number }>(sql`
    INSERT INTO org_usage (org_id, month, messages, marketing, agent_replies) VALUES (${org.id}, ${month}, 1, ${kind === "marketing" ? 1 : 0}, ${kind === "agent" ? 1 : 0})
    ON CONFLICT (org_id, month) DO UPDATE SET messages = org_usage.messages + 1, marketing = org_usage.marketing + ${kind === "marketing" ? 1 : 0}, agent_replies = org_usage.agent_replies + ${kind === "agent" ? 1 : 0}
    WHERE org_usage.messages < ${monthly}
    RETURNING messages`);
  if (inside.rows.length) return { ok: true, fromCredit: false, share: Number(inside.rows[0]!.messages) / monthly };
  // Over it: a credit, if there is one.
  const credit = await db.update(orgsTable).set({ messageCredits: sql`${orgsTable.messageCredits} - 1` })
    .where(and(eq(orgsTable.id, org.id), sql`${orgsTable.messageCredits} > 0`)).returning({ c: orgsTable.messageCredits });
  if (credit.length) { await bump(org.id, month, kind, true); return { ok: true, fromCredit: true, share: 1 }; }
  // No credit: operational messages get a small grace; marketing waits.
  if (kind === "marketing") return { ok: false, reason: "quota_marketing" };
  const t = await trialSettings();
  const ceiling = monthly + Math.ceil(monthly * t.graceShare);
  const grace = await db.execute<{ messages: number }>(sql`
    UPDATE org_usage SET messages = messages + 1, agent_replies = agent_replies + ${kind === "agent" ? 1 : 0}
    WHERE org_id = ${org.id} AND month = ${month} AND messages < ${ceiling} RETURNING messages`);
  if (grace.rows.length) return { ok: true, fromCredit: false, share: 1 };
  return { ok: false, reason: "quota" };
}

// ── The org behind a Flow Hub account ─────────────────────────────

const orgCache = new Map<number, { at: number; org: Org | null }>();
export async function orgOfWa(waUserId: number): Promise<Org | null> {
  const hit = orgCache.get(waUserId);
  if (hit && Date.now() - hit.at < 60_000) return hit.org;
  const [row] = await db.select({ o: orgsTable }).from(branchesTable).innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId)).where(eq(branchesTable.waUserId, waUserId)).limit(1);
  const org = row?.o ?? null;
  orgCache.set(waUserId, { at: Date.now(), org });
  return org;
}

/** For the campaign engine, per message: a Flow Hub account outside any shop has no quota. */
export async function campaignMessageAllowed(waUserId: number): Promise<{ ok: boolean; reason?: string }> {
  const org = await orgOfWa(waUserId);
  if (!org) return { ok: true };
  const t = await takeMessage(org, "marketing");
  if (t.ok) return { ok: true };
  return { ok: false, reason: t.reason === "plan" ? "الحملات غير متاحة في خطتك" : "وصلت رسائل الشهر لحد خطتك — تكمل الحملة أول الشهر القادم، أو أضف رصيد رسائل من «ارفع خطتك»." };
}

/** For the AI host: may it answer this customer now? Counted when it does. */
export async function agentReplyAllowed(waUserId: number): Promise<boolean> {
  const org = await orgOfWa(waUserId);
  if (!org) return true;
  return (await takeMessage(org, "agent")).ok;
}

export const QUOTA_REASON_AR: Record<string, string> = {
  quota: "وصلت رسائل الشهر لحد خطتك", quota_marketing: "رسائل الشهر انتهت — التسويق ينتظر الشهر القادم", quota_agent: "ردود الوكيل لهذا الشهر انتهت",
};
