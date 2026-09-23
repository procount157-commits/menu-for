import { enrolGroup } from "../follow-up-engine";
import { getDailySentCount, getDailyRemaining, getEffectiveDailyLimit } from "../daily-limit";
import {
  db, contactsTable, contactGroupsTable, followUpSequencesTable, followUpJobsTable,
  leadSourcesTable, unsubscribedPhonesTable, messageLogs, campaignsTable,
  DEFAULT_FOLLOW_UP_OFFSETS,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(56)} ${d}`); };

async function clean() {
  await db.delete(followUpJobsTable).where(eq(followUpJobsTable.userId, USER));
  await db.delete(followUpSequencesTable).where(eq(followUpSequencesTable.userId, USER));
  await db.delete(leadSourcesTable).where(eq(leadSourcesTable.userId, USER));
  await db.delete(unsubscribedPhonesTable).where(eq(unsubscribedPhonesTable.userId, USER));
  const gs = await db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(eq(contactGroupsTable.userId, USER));
  for (const g of gs) await db.delete(contactsTable).where(eq(contactsTable.groupId, g.id));
  await db.delete(contactGroupsTable).where(eq(contactGroupsTable.userId, USER));
  const cs = await db.select({ id: campaignsTable.id }).from(campaignsTable).where(eq(campaignsTable.userId, USER));
  for (const c of cs) await db.delete(messageLogs).where(eq(messageLogs.campaignId, c.id));
  await db.delete(campaignsTable).where(eq(campaignsTable.userId, USER));
}
await clean();

const [seq] = await db.insert(followUpSequencesTable).values({
  userId: USER, name: "متابعة عملاء الإعلان", isActive: true, sourceFilter: "ad",
  steps: DEFAULT_FOLLOW_UP_OFFSETS.map((offsetMinutes) => ({ offsetMinutes, message: `م ${offsetMinutes}` })) as any,
}).returning();

const [grp] = await db.insert(contactGroupsTable).values({ userId: USER, name: "عملاء استمارة الإعلان" }).returning();
const PHONES = Array.from({ length: 20 }, (_, i) => `97155000${String(i).padStart(4, "0")}`);
await db.insert(contactsTable).values(PHONES.map((phone) => ({ groupId: grp!.id, phone, status: "active" })));
// One of them already asked to stop.
await db.insert(unsubscribedPhonesTable).values({ userId: USER, phone: PHONES[0]!, reason: "اختبار" });

const r = await enrolGroup(USER, seq!.id, grp!.id, "ad");
check("group enrolled", r.enrolled === 19, `${r.enrolled} من ${r.total}`);
check("  opted-out number excluded", r.skippedOptedOut === 1);

const jobs = await db.select().from(followUpJobsTable).where(eq(followUpJobsTable.userId, USER));
check("one job per lead per step", jobs.length === 19 * DEFAULT_FOLLOW_UP_OFFSETS.length, `${jobs.length} jobs`);
check("the opted-out number has no jobs",
  !jobs.some((j) => j.phone === PHONES[0]));

const [lead] = await db.select().from(leadSourcesTable)
  .where(and(eq(leadSourcesTable.userId, USER), eq(leadSourcesTable.phone, PHONES[1]!)));
check("leads recorded with the declared source", lead?.source === "ad");

// Due times must not all land on the same instant.
const step0 = jobs.filter((j) => j.stepIndex === 0).map((j) => new Date(j.dueAt).getTime()).sort();
check("step 0 is staggered, not simultaneous", step0[step0.length - 1]! - step0[0]! > 10_000,
  `spread ${Math.round((step0[step0.length - 1]! - step0[0]!) / 1000)}s`);

check("re-enrolling the same group adds nothing", (await enrolGroup(USER, seq!.id, grp!.id, "ad")).enrolled === 0, "idempotent");

// ── The allowance is shared ───────────────────────────────────────
await clean();
const [c1] = await db.insert(contactGroupsTable).values({ userId: USER, name: "g" }).returning();
const [camp] = await db.insert(campaignsTable).values({ userId: USER, name: "حملة", message: "x", contactGroupId: c1!.id }).returning();

const before = await getDailySentCount(USER);
await db.insert(messageLogs).values(Array.from({ length: 30 }, (_, i) => ({
  campaignId: camp!.id, phone: `9715${i}`, status: "sent", sentAt: new Date(),
})));
const afterCampaign = await getDailySentCount(USER);
check("campaign sends counted", afterCampaign === before + 30, `${before} → ${afterCampaign}`);

const [s2] = await db.insert(followUpSequencesTable).values({
  userId: USER, name: "s", isActive: true, steps: [{ offsetMinutes: 60, message: "m" }] as any,
}).returning();
await db.insert(followUpJobsTable).values(Array.from({ length: 12 }, (_, i) => ({
  userId: USER, sequenceId: s2!.id, phone: `97166${i}`, stepIndex: i,
  dueAt: new Date(), status: "sent", sentAt: new Date(),
})));
const withFollowUps = await getDailySentCount(USER);
check("follow-up sends counted in the SAME budget", withFollowUps === afterCampaign + 12, `${afterCampaign} → ${withFollowUps}`);

const limit = await getEffectiveDailyLimit(USER);
const remaining = await getDailyRemaining(USER);
check("remaining = limit − both kinds of send", remaining === Math.max(0, limit - withFollowUps), `limit ${limit}, used ${withFollowUps}, left ${remaining}`);

await clean();
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
