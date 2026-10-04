// ── Pointing happy customers to Google ────────────────────────────
// The review request already asks «how was it, 1 to 5?». A 4 or 5 is now
// answered with the shop's Google review link — the review that ranks a shop
// on Google Maps and brings new customers — and a 1 to 3 stays a private note
// to the owner, as before.

import { and, eq, gte, sql } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";

const GOOGLE_HOSTS = ["g.page", "maps.app.goo.gl", "goo.gl", "google.com", "maps.google.com", "search.google.com", "business.google.com", "g.co"];

/** A Google review or Maps link, cleaned; null if it is anything else. Pure. */
export function cleanReviewUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!GOOGLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  u.protocol = "https:";
  return u.toString().slice(0, 500);
}

/** The last 30 days of ratings: how many, how good, how many were sent to Google. */
export async function reviewStats(orgId: number) {
  const since = new Date(Date.now() - 30 * 24 * 3_600_000);
  const [r] = await db.select({
    rated: sql<number>`count(*)::int`,
    happy: sql<number>`count(*) filter (where rating_last >= 4)::int`,
    unhappy: sql<number>`count(*) filter (where rating_last <= 3)::int`,
    avg: sql<number | null>`round(avg(rating_last)::numeric, 1)::float`,
    toGoogle: sql<number>`count(*) filter (where google_invited_at >= ${since})::int`,
  }).from(customersTable).where(and(eq(customersTable.orgId, orgId), gte(customersTable.ratedAt, since)));
  return r ?? { rated: 0, happy: 0, unhappy: 0, avg: null, toGoogle: 0 };
}
