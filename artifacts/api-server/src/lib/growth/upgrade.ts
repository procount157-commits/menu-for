// ── Asking for a bigger plan at the moment it is needed ───────────
// An owner who hits a limit (the third branch, the eleventh member of staff)
// or opens a feature of a higher plan is the warmest lead there is. The
// dashboard shows how close each limit is, and «اطلب الترقية» lands in the
// admin's subscription requests with the shop and the reason attached.

import { and, eq, sql } from "drizzle-orm";
import { db, branchesTable, menuItemsTable, staffTable, usersTable, subscriptionLeadsTable, type Org } from "@workspace/db";
import type { MenuPlan } from "../plans";

export interface Usage { branches: number; items: number; staff: number }

export async function usageOf(orgId: number): Promise<Usage> {
  const [[b], [i], [s]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(branchesTable).where(eq(branchesTable.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(menuItemsTable).where(eq(menuItemsTable.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(staffTable).where(eq(staffTable.orgId, orgId)),
  ]);
  return { branches: b?.n ?? 0, items: i?.n ?? 0, staff: s?.n ?? 0 };
}

export interface Nudge { key: keyof Usage; used: number; limit: number; label: string; full: boolean }
const LABEL: Record<keyof Usage, string> = { branches: "الفروع", items: "الأصناف", staff: "الموظفون" };

/** Limits at 80% or more, fullest first. Unlimited (-1) never nudges. Pure. */
export function nudges(usage: Usage, limits: MenuPlan["limits"]): Nudge[] {
  return (Object.keys(LABEL) as Array<keyof Usage>)
    .map((k) => ({ key: k, used: usage[k], limit: limits[k], label: LABEL[k], full: limits[k] >= 0 && usage[k] >= limits[k] }))
    .filter((x) => x.limit > 0 && x.used / x.limit >= 0.8)
    .sort((a, b) => b.used / b.limit - a.used / a.limit);
}

/** The plan that lifts what the shop is short of. Pure. */
export function suggestedPlan(current: string): "pro" | "business" | null {
  return current === "business" ? null : current === "pro" ? "business" : "pro";
}

export async function requestUpgrade(org: Org, plan: unknown, reason: unknown) {
  const want = plan === "business" ? "business" : "pro";
  const [u] = await db.select({ phone: usersTable.phone, name: usersTable.displayName, plan: usersTable.plan }).from(usersTable).where(eq(usersTable.id, org.ownerUserId)).limit(1);
  // One open request per shop and plan is enough: a second press refreshes it.
  const [open] = await db.select({ id: subscriptionLeadsTable.id }).from(subscriptionLeadsTable)
    .where(and(eq(subscriptionLeadsTable.phone, u?.phone ?? ""), eq(subscriptionLeadsTable.source, "in_app"), eq(subscriptionLeadsTable.status, "new"))).limit(1);
  const notes = `ترقية من داخل اللوحة — المحل «${org.name}» (/${org.slug})، الخطة الحالية: ${u?.plan ?? "?"}.${reason ? ` السبب: ${String(reason).slice(0, 200)}` : ""}`;
  const values = { name: u?.name ?? org.name, phone: u?.phone ?? "", planName: want === "business" ? "الأعمال" : "الاحترافية", businessType: org.vertical, notes, source: "in_app" };
  if (open) await db.update(subscriptionLeadsTable).set({ ...values, createdAt: new Date() }).where(eq(subscriptionLeadsTable.id, open.id));
  else await db.insert(subscriptionLeadsTable).values(values);
  return { plan: want };
}
