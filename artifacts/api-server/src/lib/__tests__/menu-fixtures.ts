// A throwaway shop for the Menu For You suites: its own owner account (never
// user 1, which the Flow Hub suites own), an org, a branch, a queue, a few
// items. `cleanup()` removes all of it, cascading.

import { eq, like } from "drizzle-orm";
import { db, usersTable, orgsTable, menuItemsTable, menuCategoriesTable, bookingSettingsTable, queuesTable, branchesTable } from "@workspace/db";
import { createOrg } from "../tenancy/org";

export const TEST_PHONE_PREFIX = "99900";

export async function cleanup(tag: string) {
  const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.phone, `${TEST_PHONE_PREFIX}${tag}%`));
  for (const u of users) {
    const [o] = await db.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.ownerUserId, u.id));
    if (o) {
      // Branch service accounts first: they reference the org's branches.
      const svc = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.orgId, o.id));
      await db.delete(orgsTable).where(eq(orgsTable.id, o.id));
      for (const s of svc) if (s.id !== u.id) await db.delete(usersTable).where(eq(usersTable.id, s.id));
    }
    await db.delete(usersTable).where(eq(usersTable.id, u.id));
  }
}

export async function makeShop(tag: string, opts: { plan?: string; vertical?: string; slug?: string } = {}) {
  const [u] = await db.insert(usersTable).values({
    phone: `${TEST_PHONE_PREFIX}${tag}${Math.floor(Math.random() * 1e5)}`.slice(0, 20), passwordHash: "!", displayName: `test ${tag}`,
    plan: opts.plan ?? "pro",
  }).returning();
  const { org, branch } = await createOrg(u!.id, {
    name: `محل اختبار ${tag}`, nameEn: `Test ${tag}`, vertical: opts.vertical ?? "restaurant",
    slug: opts.slug ?? `test-${tag}-${Math.floor(Math.random() * 1e6)}`, withDefaultCategories: false,
  });
  await db.update(branchesTable).set({ waPhone: "971500000001", hours: {} }).where(eq(branchesTable.id, branch.id));
  const [cat] = await db.insert(menuCategoriesTable).values({ orgId: org.id, name: "رئيسي" }).returning();
  const items = await db.insert(menuItemsTable).values([
    { orgId: org.id, categoryId: cat!.id, name: "برجر", nameEn: "Burger", price: "32.00", options: [
      { name: "الحجم", required: true, min: 1, max: 1, choices: [{ name: "عادي", priceDelta: 0 }, { name: "دبل", priceDelta: 10 }] },
    ] },
    { orgId: org.id, categoryId: cat!.id, name: "كنافة", nameEn: "Kunafa", price: "18.00", description: "بالجبنة النابلسية" },
    { orgId: org.id, categoryId: cat!.id, name: "قص شعر", kind: "service", price: "60.00", durationMin: 45 },
  ]).returning();
  const [queue] = await db.select().from(queuesTable).where(eq(queuesTable.branchId, branch.id));
  await db.update(bookingSettingsTable).set({ enabled: true, leadTimeMin: 0, capacityPerSlot: 1, slotMin: 60, maxDaysAhead: 30 }).where(eq(bookingSettingsTable.branchId, branch.id));
  const [b2] = await db.select().from(branchesTable).where(eq(branchesTable.id, branch.id));
  return { user: u!, org, branch: b2!, queue: queue!, items, category: cat! };
}
