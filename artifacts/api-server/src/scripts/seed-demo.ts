// Demo data for local development: a platform admin who owns a restaurant,
// a second shop (sweets), a menu with options, a member of staff, a few
// people in the queue and bookings enabled. Safe to re-run: it replaces the
// demo shops, nothing else.
//
//   node --env-file=.env --import tsx artifacts/api-server/src/scripts/seed-demo.ts
//
// Test credentials (local only — change them anywhere real):
//   owner / super admin  phone 500000001   password demo1234
//   sweets owner         phone 500000002   password demo1234
//   staff (restaurant)   shop  bait-shami  username cashier  password demo1234

import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  db, usersTable, orgsTable, branchesTable, menuCategoriesTable, menuItemsTable, offersTable, staffTable,
  queuesTable, bookingSettingsTable,
} from "@workspace/db";
import { createOrg } from "../lib/tenancy/org";
import { queueCtx, join, callNext } from "../lib/queue/engine";
import { rebuild } from "../lib/menu/knowledge-sync";

const PASSWORD = process.env["DEMO_PASSWORD"] ?? "demo1234";
const OWNERS = [
  { phone: "500000001", name: "صاحب المنصة", admin: true, plan: "business" },
  { phone: "500000002", name: "ريم", admin: false, plan: "pro" },
];

async function owner(o: typeof OWNERS[number]) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await db.insert(usersTable).values({ phone: o.phone, passwordHash: hash, displayName: o.name, isAdmin: o.admin, plan: o.plan })
    .onConflictDoUpdate({ target: usersTable.phone, set: { passwordHash: hash, isAdmin: o.admin, plan: o.plan, displayName: o.name } }).returning();
  const [old] = await db.select().from(orgsTable).where(eq(orgsTable.ownerUserId, u!.id));
  if (old) {
    const svc = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.orgId, old.id));
    await db.delete(orgsTable).where(eq(orgsTable.id, old.id));
    const ids = svc.map((s) => s.id).filter((id) => id !== u!.id);
    if (ids.length) await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
  return u!;
}

const size = [{ name: "الحجم", nameEn: "Size", required: true, min: 1, max: 1, choices: [{ name: "عادي", nameEn: "Regular", priceDelta: 0 }, { name: "كبير", nameEn: "Large", priceDelta: 8 }] }];
const extras = [{ name: "إضافات", nameEn: "Extras", required: false, min: 0, max: 3, choices: [{ name: "جبنة", nameEn: "Cheese", priceDelta: 3 }, { name: "صوص حار", nameEn: "Hot sauce", priceDelta: 0 }, { name: "بطاطا", nameEn: "Fries", priceDelta: 7 }] }];

async function restaurant() {
  const u = await owner(OWNERS[0]!);
  const { org, branch } = await createOrg(u.id, {
    name: "البيت الشامي", nameEn: "Bait Shami", vertical: "restaurant", slug: "bait-shami",
    tagline: "مشاوي ومناقيش على الفحم منذ 1998", address: "شارع الشيخ زايد، دبي", displayPhone: "04 000 0000",
    withDefaultCategories: false,
  });
  await db.update(orgsTable).set({ taglineEn: "Charcoal grills and manakish since 1998", about: "مطعم شامي عائلي — المشاوي على الفحم والخبز من التنور.", onboardedAt: new Date(), features: { reviews: true } }).where(eq(orgsTable.id, org.id));
  await db.update(branchesTable).set({ waPhone: "971500000001", nameEn: "Sheikh Zayed Rd" }).where(eq(branchesTable.id, branch.id));
  const cats = await db.insert(menuCategoriesTable).values([
    { orgId: org.id, name: "المقبلات", nameEn: "Mezze", sort: 0 },
    { orgId: org.id, name: "المشاوي", nameEn: "Grills", sort: 1 },
    { orgId: org.id, name: "المناقيش", nameEn: "Manakish", sort: 2 },
    { orgId: org.id, name: "الحلويات", nameEn: "Desserts", sort: 3 },
    { orgId: org.id, name: "المشروبات", nameEn: "Drinks", sort: 4 },
  ]).returning();
  const [mezze, grills, manakish, dessert, drinks] = cats;
  const items = [
    { categoryId: mezze!.id, name: "حمص بيروتي", nameEn: "Beiruti hummus", price: "22", description: "حمص ناعم بالطحينة والكمون وزيت الزيتون", tags: ["vegetarian", "popular"] },
    { categoryId: mezze!.id, name: "متبل", nameEn: "Moutabal", price: "22", description: "باذنجان مشوي على الفحم بالطحينة", tags: ["vegetarian"] },
    { categoryId: mezze!.id, name: "فتوش", nameEn: "Fattoush", price: "24", description: "خضار طازجة مع خبز محمّص ودبس الرمان", tags: ["vegetarian"] },
    { categoryId: mezze!.id, name: "كبة مقلية", nameEn: "Fried kibbeh", price: "28", description: "4 قطع محشوة لحم وصنوبر", options: extras },
    { categoryId: grills!.id, name: "مشاوي مشكل", nameEn: "Mixed grill", price: "79", compareAtPrice: "89", description: "شيش طاووق، كباب، لحم — مع الخبز والثومية", tags: ["chef", "popular"], options: size },
    { categoryId: grills!.id, name: "شيش طاووق", nameEn: "Shish tawook", price: "45", description: "صدر دجاج متبّل على الفحم", options: [...size, ...extras] },
    { categoryId: grills!.id, name: "كباب حلبي", nameEn: "Aleppo kebab", price: "52", description: "لحم غنم مفروم بالبهارات الحلبية", tags: ["spicy"], options: size },
    { categoryId: manakish!.id, name: "منقوشة زعتر", nameEn: "Zaatar manousheh", price: "12", tags: ["vegetarian"] },
    { categoryId: manakish!.id, name: "منقوشة جبنة", nameEn: "Cheese manousheh", price: "16", options: extras },
    { categoryId: manakish!.id, name: "لحم بعجين", nameEn: "Lahm bi ajeen", price: "18" },
    { categoryId: dessert!.id, name: "كنافة نابلسية", nameEn: "Nabulsi kunafa", price: "26", description: "بالجبنة النابلسية والقطر", tags: ["popular"] },
    { categoryId: dessert!.id, name: "مهلبية", nameEn: "Muhallabia", price: "18", tags: ["new"] },
    { categoryId: drinks!.id, name: "ليموناضة بالنعناع", nameEn: "Mint lemonade", price: "16", options: size },
    { categoryId: drinks!.id, name: "عيران", nameEn: "Ayran", price: "9" },
  ];
  const rows = await db.insert(menuItemsTable).values(items.map((i, n) => ({ orgId: org.id, sort: n, ...i } as any))).returning();
  await db.insert(offersTable).values([
    { orgId: org.id, title: "غداء العائلة", titleEn: "Family lunch", body: "مشاوي مشكل كبير + مقبلتين + مشروبات لـ4 بـ199 درهم", itemId: rows[4]!.id },
    { orgId: org.id, title: "كنافة على الحساب", titleEn: "Kunafa on us", body: "مع كل طلب فوق 150 درهم يوم الجمعة" },
  ]);
  await db.insert(staffTable).values({ orgId: org.id, branchId: branch.id, name: "سالم", username: "cashier", passwordHash: await bcrypt.hash(PASSWORD, 10), role: "staff" });
  await db.insert(staffTable).values({ orgId: org.id, name: "منى", username: "manager", passwordHash: await bcrypt.hash(PASSWORD, 10), role: "manager" });
  await db.update(bookingSettingsTable).set({ enabled: true, capacityPerSlot: 6, leadTimeMin: 30 }).where(eq(bookingSettingsTable.branchId, branch.id));
  const [q] = await db.select().from(queuesTable).where(eq(queuesTable.branchId, branch.id));
  await db.update(queuesTable).set({ avgServiceMin: 6 }).where(eq(queuesTable.id, q!.id));
  const ctx = (await queueCtx(q!.id))!;
  const names = ["أبو خالد", "سارة", "Michael", "فاطمة", "عائلة المنصوري", "يوسف", "نورة"];
  for (const [i, n] of names.entries()) await join(ctx, { name: n, partySize: (i % 4) + 1, deviceId: `seed-${i}` });
  await callNext((await queueCtx(q!.id))!, null);
  await callNext((await queueCtx(q!.id))!, null);
  await rebuild(org.id);
  return org;
}

async function sweets() {
  const u = await owner(OWNERS[1]!);
  const { org, branch } = await createOrg(u.id, {
    name: "حلويات الريم", nameEn: "Al Reem Sweets", vertical: "sweets", slug: "alreem-sweets",
    tagline: "صواني وحلويات شرقية للمناسبات", withDefaultCategories: true,
  });
  await db.update(orgsTable).set({ onboardedAt: new Date() }).where(eq(orgsTable.id, org.id));
  await db.update(branchesTable).set({ waPhone: "971500000002" }).where(eq(branchesTable.id, branch.id));
  const cats = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, org.id));
  const trays = cats.find((c) => c.name === "الصواني")!;
  const cakes = cats.find((c) => c.name === "الكيك")!;
  await db.insert(menuItemsTable).values([
    { orgId: org.id, categoryId: trays.id, name: "صينية كنافة", nameEn: "Kunafa tray", price: "180", description: "تكفي 15 شخص — تُطلب قبل يوم", tags: ["preorder", "popular"], options: [{ name: "الحجم", required: true, min: 1, max: 1, choices: [{ name: "وسط (10 أشخاص)", priceDelta: -50 }, { name: "كبير (15 شخص)", priceDelta: 0 }, { name: "عائلي (25 شخص)", priceDelta: 90 }] }] },
    { orgId: org.id, categoryId: trays.id, name: "صينية لقيمات", nameEn: "Luqaimat tray", price: "120", tags: ["preorder"] },
    { orgId: org.id, categoryId: cakes.id, name: "كيكة زعفران", nameEn: "Saffron cake", price: "140", description: "بالزعفران والهيل — اكتب الاسم في الملاحظات", tags: ["new"] },
  ] as any);
  await db.update(bookingSettingsTable).set({ enabled: true }).where(eq(bookingSettingsTable.branchId, branch.id));
  await rebuild(org.id);
  return org;
}

const a = await restaurant();
const b = await sweets();
console.log(`seeded: /${a.slug} and /${b.slug}`);
process.exit(0);
