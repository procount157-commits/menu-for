import { db, messageLogs, campaignsTable, contactGroupsTable } from "@workspace/db";
import { assessDeliveryHealth } from "../delivery-health";
import { eq, sql } from "drizzle-orm";

const OLD = () => new Date(Date.now() - 60 * 60_000);      // 1h ago — mature
const NEW = () => new Date(Date.now() - 2 * 60_000);       // 2m ago — too young

async function scenario(name: string, rows: Array<{ delivered: boolean; mature: boolean }>, expect: string) {
  const [g] = await db.insert(contactGroupsTable).values({ userId: 1, name: `t-${Date.now()}` }).returning();
  const [c] = await db.insert(campaignsTable).values({
    userId: 1, name: `test-${Date.now()}`, message: "x", contactGroupId: g!.id,
  }).returning();

  await db.insert(messageLogs).values(rows.map((r, i) => ({
    campaignId: c!.id,
    phone: `9715000${String(i).padStart(5, "0")}`,
    status: "sent",
    sentAt: r.mature ? OLD() : NEW(),
    deliveredAt: r.delivered ? OLD() : null,
  })));

  const h = await assessDeliveryHealth(c!.id);
  const ok = h.level === expect;
  console.log(`${ok ? "✅" : "❌"} ${name.padEnd(46)} -> ${h.level.padEnd(18)} (${h.delivered}/${h.sample}, pause=${h.shouldPause}) expected ${expect}`);

  await db.delete(campaignsTable).where(eq(campaignsTable.id, c!.id));
  await db.delete(contactGroupsTable).where(eq(contactGroupsTable.id, g!.id));
  return ok;
}

const mk = (n: number, deliveredCount: number, mature = true) =>
  Array.from({ length: n }, (_, i) => ({ delivered: i < deliveredCount, mature }));

const results: boolean[] = [];
// below MIN_SAMPLE -> must not judge
results.push(await scenario("10 mature, all delivered (under min sample)", mk(10, 10), "insufficient_data"));
// young messages must not count as undelivered
results.push(await scenario("40 sent 2min ago, none delivered yet", mk(40, 0, false), "insufficient_data"));
// healthy
results.push(await scenario("40 mature, 38 delivered (95%)", mk(40, 38), "healthy"));
results.push(await scenario("40 mature, 31 delivered (78%)", mk(40, 31), "healthy"));
// degraded — slow, don't stop
results.push(await scenario("40 mature, 28 delivered (70%)", mk(40, 28), "degraded"));
// high risk — pause
results.push(await scenario("40 mature, 20 delivered (50%)", mk(40, 20), "high_risk"));
// critical
results.push(await scenario("40 mature, 8 delivered (20%)", mk(40, 8), "critical"));
results.push(await scenario("40 mature, 0 delivered (total collapse)", mk(40, 0), "critical"));

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
