// ── The shop's customers ──────────────────────────────────────────
// One row per phone per org, kept by whatever the customer does: messaging,
// joining the queue, ordering, booking, showing up or not.

import { sql } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import { canonical } from "./dedupe";

export const COUNTRY_BY_CURRENCY: Record<string, string> = { AED: "AE", SAR: "SA", KWD: "KW", QAR: "QA", BHD: "BH", OMR: "OM", EGP: "EG" };

/** A phone typed into a form, in the international digits WhatsApp uses; null when it is not one. */
export function normalisePhone(raw: unknown, currency = "AED"): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.includes("@")) return s.slice(0, 40);
  const digits = canonical(s, COUNTRY_BY_CURRENCY[currency] ?? "AE");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export interface Touch {
  name?: string | null;
  inbound?: boolean;
  visit?: boolean;
  order?: { total: number; itemIds: number[] };
  booking?: boolean;
  noShow?: boolean;
  optIn?: boolean;
  branchId?: number;
  rating?: number;
}

export async function touchCustomer(orgId: number, phone: string | null | undefined, t: Touch): Promise<void> {
  if (!phone) return;
  const now = new Date();
  const fav: Record<string, number> = {};
  for (const id of t.order?.itemIds ?? []) fav[String(id)] = (fav[String(id)] ?? 0) + 1;
  await db.insert(customersTable).values({
    orgId, phone,
    name: t.name?.trim().slice(0, 80) || null,
    lastInboundAt: t.inbound ? now : null,
    visits: t.visit ? 1 : 0,
    ordersCount: t.order ? 1 : 0,
    bookingsCount: t.booking ? 1 : 0,
    noShows: t.noShow ? 1 : 0,
    totalSpent: String(t.order?.total ?? 0),
    favourites: fav,
    marketingOptIn: !!t.optIn,
    optInAt: t.optIn ? now : null,
    lastBranchId: t.branchId ?? null,
    ratingLast: t.rating ?? null,
  }).onConflictDoUpdate({
    target: [customersTable.orgId, customersTable.phone],
    set: {
      lastSeenAt: now,
      ...(t.name?.trim() ? { name: t.name.trim().slice(0, 80) } : {}),
      ...(t.inbound ? { lastInboundAt: now } : {}),
      ...(t.visit ? { visits: sql`${customersTable.visits} + 1` } : {}),
      ...(t.order ? {
        ordersCount: sql`${customersTable.ordersCount} + 1`,
        totalSpent: sql`${customersTable.totalSpent} + ${t.order.total}`,
        favourites: sql`(
          SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
            SELECT k, sum(v)::int AS v FROM (
              SELECT key AS k, value::int AS v FROM jsonb_each_text(${customersTable.favourites})
              UNION ALL SELECT key, value::int FROM jsonb_each_text(${JSON.stringify(fav)}::jsonb)
            ) a GROUP BY k
          ) b)`,
      } : {}),
      ...(t.booking ? { bookingsCount: sql`${customersTable.bookingsCount} + 1` } : {}),
      ...(t.noShow ? { noShows: sql`${customersTable.noShows} + 1` } : {}),
      // Agreeing is remembered; not ticking the box another time does not withdraw it.
      ...(t.optIn ? { marketingOptIn: true, optInAt: now } : {}),
      ...(t.branchId ? { lastBranchId: t.branchId } : {}),
      ...(t.rating ? { ratingLast: t.rating } : {}),
    },
  });
}

export async function lastInboundAt(orgId: number, phone: string): Promise<Date | null> {
  const { rows } = await db.execute<{ at: Date | null }>(sql`SELECT last_inbound_at AS at FROM customers WHERE org_id = ${orgId} AND phone = ${phone}`);
  const at = rows[0]?.at;
  return at ? new Date(at) : null;
}
