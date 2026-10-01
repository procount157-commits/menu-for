// ── After the visit ───────────────────────────────────────────────
// Two things a shop asked for and Flow Hub's follow-up ladder was not shaped
// for: a review request a couple of hours after someone was served, and a
// "we miss you" to a regular who stopped coming. Both are off until the owner
// turns them on (org.features.reviews / org.features.winback), and the
// win-back reaches only customers who ticked «أرسلوا لي العروض».

import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, customersTable, orgsTable, branchesTable, queueTicketsTable, ordersTable } from "@workspace/db";
import { localParts, zonedToUtc, localDate, addDays } from "@workspace/menu-shared";
import { enqueue } from "./outbox";
import { renderFor } from "./templates";
import { publicUrl, menuPath } from "../menu/urls";
import { menuPlan } from "../plans";
import { logger } from "../logger";

export const REVIEW_DELAY_MS = 2 * 3_600_000;
export const WINBACK_AFTER_DAYS = 30;
const WINBACK_EVERY_DAYS = 60;

/** `at`, moved into 10:00–22:00 in `tz` if it falls outside. Pure. */
export function withinDaytime(at: Date, tz: string): Date {
  const p = localParts(tz, at);
  if (p.hour >= 10 && p.hour < 22) return at;
  const day = localDate(tz, at);
  return zonedToUtc(tz, p.hour >= 22 ? addDays(day, 1) : day, "10:00");
}

let timer: NodeJS.Timeout | null = null;

/** Review requests for tickets finished 2h+ ago, and win-backs. Runs every 10 minutes. */
export async function runLifecycle(now = new Date()): Promise<{ reviews: number; winbacks: number }> {
  let reviews = 0, winbacks = 0;
  const orgs = await db.select().from(orgsTable).where(eq(orgsTable.status, "active"));
  for (const org of orgs) {
    const f = org.features ?? {};
    if (!f.reviews && !f.winback) continue;
    const plan = await menuPlan(org.ownerUserId);
    if (!plan.features.notify) continue;
    const lang = org.defaultLang === "en" ? "en" : "ar";
    const [main] = await db.select().from(branchesTable).where(and(eq(branchesTable.orgId, org.id), eq(branchesTable.isActive, true))).orderBy(branchesTable.sort).limit(1);
    if (!main) continue;

    if (f.reviews) {
      // Finished visits between 2h and 26h ago, from customers not asked in the last 2 weeks.
      const from = new Date(now.getTime() - 26 * 3_600_000), to = new Date(now.getTime() - REVIEW_DELAY_MS);
      const done = await db.select({ phone: queueTicketsTable.phone, name: queueTicketsTable.customerName, branchId: queueTicketsTable.branchId })
        .from(queueTicketsTable).where(and(
          eq(queueTicketsTable.orgId, org.id), eq(queueTicketsTable.status, "done"),
          gte(queueTicketsTable.finishedAt, from), lt(queueTicketsTable.finishedAt, to),
        ));
      const orders = await db.select({ phone: ordersTable.phone, name: ordersTable.customerName, branchId: ordersTable.branchId })
        .from(ordersTable).where(and(eq(ordersTable.orgId, org.id), eq(ordersTable.status, "completed"), gte(ordersTable.updatedAt, from), lt(ordersTable.updatedAt, to)));
      const seen = new Set<string>();
      for (const v of [...done, ...orders]) {
        if (!v.phone || seen.has(v.phone)) continue;
        seen.add(v.phone);
        const [c] = await db.select().from(customersTable).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, v.phone))).limit(1);
        if (!c || (c.reviewAskedAt && now.getTime() - c.reviewAskedAt.getTime() < 14 * 24 * 3_600_000)) continue;
        const [b] = await db.select().from(branchesTable).where(eq(branchesTable.id, v.branchId)).limit(1);
        const text = await renderFor(org.id, "review_request", lang, { name: v.name ?? c.name ?? "", shop: lang === "en" ? (org.nameEn || org.name) : org.name });
        await db.update(customersTable).set({ reviewAskedAt: now }).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, v.phone)));
        await enqueue({ org, waUserId: (b ?? main).waUserId, phone: v.phone, kind: "review_request", text, refType: "customer", at: withinDaytime(now, org.timezone) });
        reviews++;
      }
    }

    if (f.winback) {
      const quietSince = new Date(now.getTime() - WINBACK_AFTER_DAYS * 24 * 3_600_000);
      const lastAsk = new Date(now.getTime() - WINBACK_EVERY_DAYS * 24 * 3_600_000);
      const regulars = await db.select().from(customersTable).where(and(
        eq(customersTable.orgId, org.id), eq(customersTable.marketingOptIn, true),
        lt(customersTable.lastSeenAt, quietSince), sql`${customersTable.visits} + ${customersTable.ordersCount} >= 2`,
        or(isNull(customersTable.winbackAt), lt(customersTable.winbackAt, lastAsk)),
      )).limit(20);
      for (const c of regulars) {
        const [b] = c.lastBranchId ? await db.select().from(branchesTable).where(eq(branchesTable.id, c.lastBranchId)).limit(1) : [main];
        const br = b ?? main;
        const text = await renderFor(org.id, "winback", lang, {
          name: c.name ?? "", shop: lang === "en" ? (org.nameEn || org.name) : org.name,
          link: publicUrl(menuPath(org.slug, br.slug)),
        });
        await db.update(customersTable).set({ winbackAt: now }).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, c.phone)));
        // A win-back is marketing: it travels only to a number that agreed.
        await enqueue({ org, waUserId: br.waUserId, phone: c.phone, kind: "winback", text, refType: "customer", consented: true, at: withinDaytime(now, org.timezone) });
        winbacks++;
      }
    }
  }
  return { reviews, winbacks };
}

export function startLifecycle() {
  if (timer) return;
  timer = setInterval(() => { runLifecycle().catch((err) => logger.warn({ err: String(err?.message ?? err) }, "lifecycle run failed")); }, 10 * 60_000);
  timer.unref?.();
}
