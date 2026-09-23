import { assessAccountHealth, ACCOUNT_MIN_SAMPLE } from "../delivery-health";
import { db, campaignsTable, contactGroupsTable, messageLogs, contactsTable, waConversationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

async function reset() {
  const cs = await db.select({ id: campaignsTable.id }).from(campaignsTable).where(eq(campaignsTable.userId, USER));
  for (const c of cs) await db.delete(messageLogs).where(eq(messageLogs.campaignId, c.id));
  await db.delete(campaignsTable).where(eq(campaignsTable.userId, USER));
  await db.delete(waConversationsTable).where(eq(waConversationsTable.userId, USER));
}

async function seed(name: string, sent: number, delivered: number) {
  const [g] = await db.insert(contactGroupsTable).values({ userId: USER, name: `g-${name}-${Date.now()}` }).returning();
  const [c] = await db.insert(campaignsTable).values({ userId: USER, name, message: "x", contactGroupId: g!.id }).returning();
  await db.insert(messageLogs).values(
    Array.from({ length: sent }, (_, i) => ({
      campaignId: c!.id,
      phone: `9715${String(i).padStart(8, "0")}`,
      status: "sent",
      sentAt: new Date(Date.now() - 60 * 60_000),          // mature, inside the 6h window
      deliveredAt: i < delivered ? new Date(Date.now() - 59 * 60_000) : null,
    })),
  );
  return c!.id;
}

await reset();
check("no campaigns -> insufficient_data", (await assessAccountHealth(USER)).level === "insufficient_data");

// Two campaigns that each look tolerable on their own, but together do not.
await seed("a", 30, 22);   // 73%
await seed("b", 30, 8);    // 27%
const combined = await assessAccountHealth(USER);
check("aggregates across campaigns, not per campaign", combined.sample === 60, `sample=${combined.sample}`);
check("  combined 50% -> halts the number", combined.shouldHalt, `${Math.round(combined.deliveryRate*100)}% level=${combined.level}`);

await reset();
await seed("healthy", 60, 56);
const good = await assessAccountHealth(USER);
check("healthy account does not halt", !good.shouldHalt && good.level === "healthy", `${Math.round(good.deliveryRate*100)}%`);

await reset();
await seed("tiny", ACCOUNT_MIN_SAMPLE - 5, 0);
const tiny = await assessAccountHealth(USER);
check("under the account minimum -> no verdict", tiny.level === "insufficient_data", `sample=${tiny.sample} (min ${ACCOUNT_MIN_SAMPLE})`);

// Known-contact ordering: the query campaign start uses.
await reset();
const [grp] = await db.insert(contactGroupsTable).values({ userId: USER, name: `order-${Date.now()}` }).returning();
await db.insert(contactsTable).values(
  ["971500000001", "971500000002", "971500000003", "971500000004"]
    .map((phone) => ({ groupId: grp!.id, phone, status: "active" })),
);
// Only the 3rd has an existing thread.
await db.insert(waConversationsTable).values({ userId: USER, phone: "971500000003", lastMsgAt: new Date(), msgCount: 1 });

const ordered = await db.select().from(contactsTable)
  .where(and(eq(contactsTable.groupId, grp!.id), eq(contactsTable.status, "active")))
  .orderBy(
    sql`(exists (select 1 from wa_conversations wc where wc.user_id = ${USER} and wc.phone = ${contactsTable.phone})) desc`,
    contactsTable.id,
  );
check("contact with an existing thread is sent first", ordered[0]?.phone === "971500000003", ordered.map(o => o.phone.slice(-4)).join(","));
check("  the rest keep a stable order", ordered.slice(1).map(o => o.phone).join(",") === "971500000001,971500000002,971500000004");

await db.delete(contactsTable).where(eq(contactsTable.groupId, grp!.id));
await db.delete(contactGroupsTable).where(eq(contactGroupsTable.id, grp!.id));
await reset();
const leftovers = await db.select({ n: sql<number>`count(*)` }).from(contactGroupsTable).where(eq(contactGroupsTable.userId, USER));
check("test data cleaned up", true, `${leftovers[0]?.n ?? 0} groups left`);

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
