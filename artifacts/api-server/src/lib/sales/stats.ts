// ── How the seller is doing ───────────────────────────────────────
// The funnel by stage, today against the quota, which follow-up step gets
// replies, how often the guard had to fall back — and plain advice from it.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { adviceFrom, type FunnelNumbers, type SalesSettings } from "./brief";
import { localMidnight } from "./service";

export async function salesStats(s: SalesSettings) {
  const wa = s.waUserId;
  if (!wa) return null;
  const midnight = localMidnight(s.tz);
  const rows = <T = any>(q: any) => db.execute<any>(q).then((r) => r.rows as T[]);
  const [stages, today, perStep, opener, guard, clicks] = await Promise.all([
    rows(sql`SELECT stage, count(*)::int AS n FROM sales_prospects WHERE wa_user_id = ${wa} GROUP BY stage`),
    rows(sql`SELECT kind, count(*)::int AS n FROM sales_touches WHERE wa_user_id = ${wa} AND at >= ${midnight} AND status IN ('sent','dry') GROUP BY kind`),
    // A step "got a reply" when the shop wrote within three days of it.
    rows(sql`SELECT t.step, count(*)::int AS sent,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_touches i WHERE i.prospect_id = t.prospect_id AND i.kind = 'inbound' AND i.at > t.at AND i.at < t.at + interval '3 days'))::int AS replies
      FROM sales_touches t WHERE t.wa_user_id = ${wa} AND t.kind = 'followup' AND t.status IN ('sent','dry') GROUP BY t.step ORDER BY t.step`),
    rows(sql`SELECT count(*)::int AS sent,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_touches i WHERE i.prospect_id = t.prospect_id AND i.kind = 'inbound' AND i.at > t.at AND i.at < t.at + interval '3 days'))::int AS replies
      FROM sales_touches t WHERE t.wa_user_id = ${wa} AND t.kind = 'opener' AND t.status IN ('sent','dry')`),
    rows(sql`SELECT count(*) FILTER (WHERE (meta->>'fallback') = 'true')::int AS fallbacks, count(*)::int AS total
      FROM sales_touches WHERE wa_user_id = ${wa} AND kind IN ('opener','followup','reply') AND status IN ('sent','dry')`),
    rows(sql`SELECT coalesce(sum(clicks),0)::int AS clicks, count(*) FILTER (WHERE stop_reason LIKE 'طلب الإيقاف%')::int AS opt_outs FROM sales_prospects WHERE wa_user_id = ${wa}`),
  ]);
  const by = Object.fromEntries(stages.map((r: any) => [r.stage, r.n])) as Record<string, number>;
  const t = Object.fromEntries(today.map((r: any) => [r.kind, r.n])) as Record<string, number>;
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  const funnel: FunnelNumbers = {
    contacted: total - (by.new ?? 0), replied: by.replied ?? 0, interested: by.interested ?? 0, trial: by.trial ?? 0, won: by.won ?? 0,
    lost: by.lost ?? 0, stopped: by.stopped ?? 0, clicks: clicks[0]?.clicks ?? 0, optOuts: clicks[0]?.opt_outs ?? 0,
    perStep: perStep.map((r: any) => ({ step: r.step ?? 0, sent: r.sent, replies: r.replies })),
    openersSent: opener[0]?.sent ?? 0, openerReplies: opener[0]?.replies ?? 0,
    aiFallbacks: guard[0]?.fallbacks ?? 0, aiTotal: guard[0]?.total ?? 0,
  };
  return {
    total, byStage: by, funnel,
    today: { openers: t.opener ?? 0, followups: t.followup ?? 0, replies: t.reply ?? 0, inbound: t.inbound ?? 0, quota: s.dailyNew },
    advice: adviceFrom(funnel, s),
  };
}
