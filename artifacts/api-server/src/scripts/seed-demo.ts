// Demo data for local development: a platform admin who owns a restaurant,
// a second shop (sweets), a menu with options, a member of staff, a few
// people in the queue and bookings enabled. Safe to re-run: it replaces the
// demo shops, nothing else.
//
//   node --env-file=.env --import tsx artifacts/api-server/src/scripts/seed-demo.ts
//
// Test credentials (local only — change them anywhere real):
//   platform admin       phone 500000000   password demo1234   (no shop: /admin/orgs)
//   restaurant owner     phone 500000001   password demo1234
//   sweets owner         phone 500000002   password demo1234
//   salon owner          phone 500000003   password demo1234
//   staff (restaurant)   shop  bait-shami  username cashier  password demo1234
//   staff (salon)        shop  lamsa-salon username reception password demo1234

import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  db, customersTable, usersTable, orgsTable, branchesTable, menuCategoriesTable, menuItemsTable, offersTable, staffTable,
  queuesTable, bookingSettingsTable,
} from "@workspace/db";
import { createOrg } from "../lib/tenancy/org";
import { queueCtx, join, callNext } from "../lib/queue/engine";
import { rebuild } from "../lib/menu/knowledge-sync";
import { storeImage } from "../lib/menu/images";

// Demo photos live in seed-assets/ (generated once, committed as WebP) and go
// through the same pipeline as an owner's upload.
const ASSETS = path.resolve(import.meta.dirname, "../../seed-assets");
const cache = new Map<string, Awaited<ReturnType<typeof storeImage>>>();
async function photo(key: string, kind: "menu" | "logo" | "cover" | "offer" = "menu") {
  const hit = cache.get(key);
  if (hit) return hit;
  const file = path.join(ASSETS, `${key}.webp`);
  if (!fs.existsSync(file)) return null;
  const img = await storeImage(fs.readFileSync(file), kind);
  cache.set(key, img);
  return img;
}
const images = async (key: string) => { const i = await photo(key); return i ? [{ url: i.url, sm: i.sm, md: i.md, blur: i.blur }] : []; };

const PASSWORD = process.env["DEMO_PASSWORD"] ?? "demo1234";
const OWNERS = [
  { phone: "500000001", name: "أبو خالد", admin: false, plan: "business" },
  { phone: "500000002", name: "ريم", admin: false, plan: "pro" },
  { phone: "500000003", name: "نورة", admin: false, plan: "pro" },
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

// Demo customers, so «الزبائن» and «واتساب الآلي» have people in them: the
// numbers are made up (050 000 0xxx), most have agreed to offers.
async function demoCustomers(orgId: number, names: string[]) {
  const day = 24 * 3_600_000;
  await db.insert(customersTable).values(names.map((name, i) => ({
    orgId, phone: `97150000${String(100 + (orgId % 9) * 100 + i).padStart(4, "0")}`, name,
    marketingOptIn: i % 4 !== 3, optInAt: i % 4 !== 3 ? new Date(Date.now() - (i + 2) * day) : null,
    visits: 1 + (i % 5), ordersCount: i % 3, bookingsCount: i % 2, totalSpent: String(40 + i * 35),
    firstSeenAt: new Date(Date.now() - (i % 3 === 0 ? 12 : 70) * day), lastSeenAt: new Date(Date.now() - (i % 5 === 4 ? 45 : i + 1) * day),
  }))).onConflictDoNothing();
}

async function restaurant() {
  const u = await owner(OWNERS[0]!);
  const { org, branch } = await createOrg(u.id, {
    name: "البيت الشامي", nameEn: "Bait Shami", vertical: "restaurant", slug: "bait-shami",
    tagline: "مشاوي ومناقيش على الفحم منذ 1998", address: "شارع الشيخ زايد، دبي", displayPhone: "04 000 0000",
    withDefaultCategories: false,
  });
  const logo = await photo("logo-shami", "logo"), cover = await photo("cover-restaurant", "cover");
  await db.update(orgsTable).set({
    taglineEn: "Charcoal grills and manakish since 1998",
    about: "مطعم شامي عائلي منذ 1998 — المشاوي على الفحم، الخبز من التنور، والمقبلات تُحضّر كل صباح. نستقبلكم للجلسات العائلية والعزائم.",
    logoUrl: logo?.md ?? null, coverUrl: cover?.url ?? null,
    socials: { instagram: "baitshami.demo", tiktok: "baitshami.demo" },
    // A restaurant starts with neither; the demo shows both switched on.
    onboardedAt: new Date(), features: { reviews: true, queue: true, booking: true },
  }).where(eq(orgsTable.id, org.id));
  await db.update(branchesTable).set({
    waPhone: "971500000001", nameEn: "Sheikh Zayed Rd",
    mapUrl: "https://maps.google.com/?q=Sheikh+Zayed+Road+Dubai",
    hours: { "0": { open: "11:00", close: "00:00" }, "1": { open: "11:00", close: "00:00" }, "2": { open: "11:00", close: "00:00" }, "3": { open: "11:00", close: "00:00" }, "4": { open: "11:00", close: "01:00" }, "5": { open: "13:00", close: "01:00" }, "6": { open: "11:00", close: "01:00" } },
  }).where(eq(branchesTable.id, branch.id));
  const catImg = async (key: string) => (await photo(key))?.md ?? null;
  const cats = await db.insert(menuCategoriesTable).values([
    { orgId: org.id, name: "المقبلات", nameEn: "Mezze", sort: 0, imageUrl: await catImg("hummus") },
    { orgId: org.id, name: "المشاوي", nameEn: "Grills", sort: 1, imageUrl: await catImg("mixed-grill") },
    { orgId: org.id, name: "المناقيش", nameEn: "Manakish", sort: 2, imageUrl: await catImg("zaatar-manousheh") },
    { orgId: org.id, name: "الحلويات", nameEn: "Desserts", sort: 3, imageUrl: await catImg("kunafa") },
    { orgId: org.id, name: "المشروبات", nameEn: "Drinks", sort: 4, imageUrl: await catImg("mint-lemonade") },
  ]).returning();
  const [mezze, grills, manakish, dessert, drinks] = cats;
  const items = [
    { k: "hummus", categoryId: mezze!.id, name: "حمص بيروتي", nameEn: "Beiruti hummus", price: "22", calories: 320, allergens: ["سمسم"],
      description: "حمص ناعم بالطحينة والكمون وزيت الزيتون البكر، يُقدّم مع خبز التنور الساخن", descriptionEn: "Silky hummus with tahini, cumin and extra-virgin olive oil, served with hot tannour bread", tags: ["vegetarian", "popular"] },
    { k: "moutabal", categoryId: mezze!.id, name: "متبل", nameEn: "Moutabal", price: "22", calories: 260, allergens: ["سمسم"],
      description: "باذنجان مشوي على الفحم بالطحينة واللبن وحب الرمان", descriptionEn: "Charcoal-smoked aubergine with tahini, yoghurt and pomegranate", tags: ["vegetarian"] },
    { k: "fattoush", categoryId: mezze!.id, name: "فتوش", nameEn: "Fattoush", price: "24", calories: 210, allergens: ["قمح"],
      description: "خضار طازجة مع خبز محمّص، سماق ودبس الرمان", descriptionEn: "Crisp vegetables, toasted bread, sumac and pomegranate molasses", tags: ["vegetarian", "new"] },
    { k: "kibbeh", categoryId: mezze!.id, name: "كبة مقلية", nameEn: "Fried kibbeh", price: "28", calories: 410, allergens: ["قمح", "صنوبر"],
      description: "4 قطع محشوة لحم غنم وصنوبر، تُقدّم مع لبن بالخيار", descriptionEn: "Four pieces stuffed with lamb and pine nuts, with cucumber yoghurt", options: extras },
    { k: "mixed-grill", categoryId: grills!.id, name: "مشاوي مشكل", nameEn: "Mixed grill", price: "79", compareAtPrice: "89", calories: 980,
      description: "شيش طاووق، كباب حلبي وأوصال لحم على الفحم — مع الخبز والثومية والمخلل", descriptionEn: "Shish tawook, Aleppo kebab and lamb cubes over charcoal — with bread, toum and pickles", tags: ["chef", "popular"], options: size },
    { k: "shish-tawook", categoryId: grills!.id, name: "شيش طاووق", nameEn: "Shish tawook", price: "45", calories: 620,
      description: "صدر دجاج متبّل باللبن والليمون على الفحم، مع ثومية وبطاطا", descriptionEn: "Chicken breast marinated in yoghurt and lemon, with toum and fries", tags: ["popular"], options: [...size, ...extras] },
    { k: "aleppo-kebab", categoryId: grills!.id, name: "كباب حلبي", nameEn: "Aleppo kebab", price: "52", calories: 700,
      description: "لحم غنم مفروم بالفليفلة الحلبية، مع بصل بالسماق وطماطم مشوية", descriptionEn: "Minced lamb with Aleppo pepper, sumac onions and grilled tomato", tags: ["spicy"], options: size },
    { k: "zaatar-manousheh", categoryId: manakish!.id, name: "منقوشة زعتر", nameEn: "Zaatar manousheh", price: "12", calories: 340, allergens: ["قمح", "سمسم"],
      description: "زعتر بلدي وزيت زيتون على عجينة تُخبز عند الطلب", descriptionEn: "Wild thyme and olive oil on dough baked to order", tags: ["vegetarian"] },
    { k: "cheese-manousheh", categoryId: manakish!.id, name: "منقوشة جبنة", nameEn: "Cheese manousheh", price: "16", calories: 430, allergens: ["قمح", "حليب"],
      description: "جبنة عكاوي ذائبة مع حبة البركة", descriptionEn: "Melted akkawi cheese with nigella seeds", tags: ["popular"], options: extras },
    { k: "lahm-bi-ajeen", categoryId: manakish!.id, name: "لحم بعجين", nameEn: "Lahm bi ajeen", price: "18", calories: 460, allergens: ["قمح", "صنوبر"],
      description: "لحم غنم مفروم مع طماطم وصنوبر على عجينة رقيقة، مع عصرة ليمون", descriptionEn: "Minced lamb, tomato and pine nuts on thin dough, with a squeeze of lemon" },
    { k: "kunafa", categoryId: dessert!.id, name: "كنافة نابلسية", nameEn: "Nabulsi kunafa", price: "26", calories: 520, allergens: ["قمح", "حليب", "فستق"],
      description: "بالجبنة النابلسية والقطر والفستق الحلبي — تُقدّم ساخنة", descriptionEn: "Nabulsi cheese, syrup and pistachio — served hot", tags: ["popular"] },
    { k: "muhallabia", categoryId: dessert!.id, name: "مهلبية", nameEn: "Muhallabia", price: "18", calories: 240, allergens: ["حليب", "فستق"],
      description: "مهلبية بماء الورد والفستق", descriptionEn: "Milk pudding with rose water and pistachio", tags: ["new"] },
    { k: "mint-lemonade", categoryId: drinks!.id, name: "ليموناضة بالنعناع", nameEn: "Mint lemonade", price: "16", calories: 140,
      description: "ليمون طازج ونعناع مثلّج", descriptionEn: "Fresh lemon blended with mint and ice", tags: ["popular"], options: size },
    { k: "ayran", categoryId: drinks!.id, name: "عيران", nameEn: "Ayran", price: "9", calories: 90, allergens: ["حليب"],
      description: "لبن بارد بالنعناع", descriptionEn: "Chilled yoghurt drink with mint" },
  ];
  const rows = [];
  for (const [n, { k, ...i }] of items.entries()) {
    const [row] = await db.insert(menuItemsTable).values({ orgId: org.id, sort: n, images: await images(k), ...i } as any).returning();
    rows.push(row!);
  }
  await db.insert(offersTable).values([
    { orgId: org.id, title: "غداء العائلة", titleEn: "Family lunch", body: "مشاوي مشكل كبير + مقبلتين + 4 مشروبات", bodyEn: "Large mixed grill, two mezze and four drinks", imageUrl: (await photo("offer-family", "offer"))?.url ?? null, itemId: rows[4]!.id, sort: 0 },
    { orgId: org.id, title: "الكنافة علينا", titleEn: "Kunafa on us", body: "كنافة نابلسية مع كل طلب مشاوي يوم الجمعة", bodyEn: "A kunafa with every grill order on Fridays", itemId: rows[10]!.id, sort: 1 },
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
  const logo = await photo("logo-sweets", "logo"), cover = await photo("cover-sweets", "cover");
  await db.update(orgsTable).set({
    onboardedAt: new Date(), taglineEn: "Trays and Arabic sweets for every occasion",
    about: "حلويات شرقية تُحضّر يومياً، وصواني للمناسبات بالطلب المسبق.",
    logoUrl: logo?.md ?? null, coverUrl: cover?.url ?? null, socials: { instagram: "alreem.sweets.demo" },
    features: { queue: true, booking: true },
  }).where(eq(orgsTable.id, org.id));
  await db.update(branchesTable).set({ waPhone: "971500000002", address: "العين — شارع خليفة", mapUrl: "https://maps.google.com/?q=Al+Ain" }).where(eq(branchesTable.id, branch.id));
  const cats = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, org.id));
  const trays = cats.find((c) => c.name === "الصواني")!;
  const cakes = cats.find((c) => c.name === "الكيك")!;
  await db.insert(menuItemsTable).values([
    { orgId: org.id, categoryId: trays.id, name: "صينية كنافة", nameEn: "Kunafa tray", price: "180", description: "كنافة بالجبنة والفستق — تكفي 15 شخص، تُطلب قبل يوم", descriptionEn: "Cheese kunafa with pistachio — serves 15, order a day ahead", tags: ["preorder", "popular"], allergens: ["قمح", "حليب", "فستق"], images: await images("kunafa-tray"), options: [{ name: "الحجم", nameEn: "Size", required: true, min: 1, max: 1, choices: [{ name: "وسط (10 أشخاص)", priceDelta: -50 }, { name: "كبير (15 شخص)", priceDelta: 0 }, { name: "عائلي (25 شخص)", priceDelta: 90 }] }] },
    { orgId: org.id, categoryId: trays.id, name: "صينية لقيمات", nameEn: "Luqaimat tray", price: "120", description: "لقيمات مقرمشة بدبس التمر والسمسم", descriptionEn: "Crisp luqaimat with date syrup and sesame", tags: ["preorder", "popular"], allergens: ["قمح", "سمسم"], images: await images("luqaimat-tray") },
    { orgId: org.id, categoryId: cakes.id, name: "كيكة زعفران", nameEn: "Saffron cake", price: "140", description: "بالزعفران والهيل — اكتب الاسم في الملاحظات", descriptionEn: "Saffron and cardamom — write the name in the notes", tags: ["new"], allergens: ["قمح", "حليب", "بيض"], images: await images("saffron-cake") },
  ] as any);
  await db.update(bookingSettingsTable).set({ enabled: true }).where(eq(bookingSettingsTable.branchId, branch.id));
  await rebuild(org.id);
  return org;
}

async function salon() {
  const u = await owner(OWNERS[2]!);
  const { org, branch } = await createOrg(u.id, {
    name: "صالون لمسة", nameEn: "Lamsa Ladies Salon", vertical: "beauty", slug: "lamsa-salon",
    tagline: "صالون نسائي — شعر، أظافر، بشرة ومكياج", address: "أبوظبي — شارع المرور", displayPhone: "02 000 0000",
    withDefaultCategories: true,
  });
  const logo = await photo("logo-salon", "logo"), cover = await photo("cover-salon", "cover");
  await db.update(orgsTable).set({
    taglineEn: "Ladies salon — hair, nails, skin and makeup",
    about: "صالون نسائي بخصوصية تامة. نستقبلكِ بموعد مسبق أو بالدور، وفريقنا يهتم بالتفاصيل.",
    logoUrl: logo?.md ?? null, coverUrl: cover?.url ?? null,
    socials: { instagram: "lamsa.salon.demo", snapchat: "lamsa.salon.demo" }, onboardedAt: new Date(), features: { reviews: true, queue: true, booking: true },
  }).where(eq(orgsTable.id, org.id));
  await db.update(branchesTable).set({
    waPhone: "971500000003", nameEn: "Al Muroor", mapUrl: "https://maps.google.com/?q=Al+Muroor+Abu+Dhabi",
    hours: { "0": { open: "10:00", close: "21:00" }, "1": { open: "10:00", close: "21:00" }, "2": { open: "10:00", close: "21:00" }, "3": { open: "10:00", close: "21:00" }, "4": { open: "10:00", close: "22:00" }, "5": { open: "14:00", close: "22:00" }, "6": { open: "10:00", close: "22:00" } },
  }).where(eq(branchesTable.id, branch.id));
  const cats = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, org.id));
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const length = [{ name: "طول الشعر", nameEn: "Hair length", required: true, min: 1, max: 1, choices: [{ name: "قصير", nameEn: "Short", priceDelta: 0 }, { name: "متوسط", nameEn: "Medium", priceDelta: 30 }, { name: "طويل", nameEn: "Long", priceDelta: 60 }] }];
  const services = [
    { k: "salon-haircut", categoryId: cat("الشعر"), name: "قص وتصفيف", nameEn: "Cut & blow-dry", price: "120", durationMin: 45, description: "قص حسب شكل الوجه مع غسيل وسشوار", descriptionEn: "A cut to suit your face, with wash and blow-dry", tags: ["popular"], options: length },
    { k: "salon-color", categoryId: cat("الشعر"), name: "صبغة وهايلايت", nameEn: "Colour & highlights", price: "350", durationMin: 120, description: "صبغة كاملة أو بالياج بألوان خالية من الأمونيا", descriptionEn: "Full colour or balayage with ammonia-free colour", tags: ["chef"], options: length },
    { k: "salon-keratin", categoryId: cat("الشعر"), name: "كيراتين وبروتين", nameEn: "Keratin treatment", price: "450", compareAtPrice: "550", durationMin: 150, description: "علاج لتنعيم الشعر يدوم حتى 3 أشهر", descriptionEn: "A smoothing treatment that lasts up to three months", tags: ["offer"], options: length },
    { k: "salon-manicure", categoryId: cat("الأظافر"), name: "مانيكير جل", nameEn: "Gel manicure", price: "90", durationMin: 45, description: "تنظيف وبرد وطلاء جل يدوم أسبوعين", descriptionEn: "Clean, shape and gel polish that lasts two weeks", tags: ["popular"] },
    { k: "salon-pedicure", categoryId: cat("الأظافر"), name: "باديكير سبا", nameEn: "Spa pedicure", price: "110", durationMin: 60, description: "نقع بالأملاح، تقشير، تدليك وطلاء", descriptionEn: "Salt soak, scrub, massage and polish" },
    { k: "salon-facial", categoryId: cat("البشرة"), name: "تنظيف بشرة عميق", nameEn: "Deep cleansing facial", price: "220", durationMin: 60, description: "بخار، تقشير، ماسك وترطيب حسب نوع البشرة", descriptionEn: "Steam, exfoliation, mask and hydration for your skin type", tags: ["new"] },
    { k: "salon-makeup", categoryId: cat("المكياج"), name: "مكياج سهرة", nameEn: "Evening makeup", price: "300", durationMin: 60, description: "مكياج كامل مع تثبيت ورموش", descriptionEn: "Full makeup with setting and lashes", tags: ["popular"] },
    { k: "salon-bridal", categoryId: cat("المكياج"), name: "باقة العروس", nameEn: "Bridal package", price: "1800", durationMin: 240, description: "مكياج وتسريحة العروس مع تجربة مسبقة — بالحجز المسبق", descriptionEn: "Bridal makeup and hair with a trial beforehand — by booking", tags: ["preorder", "chef"] },
  ];
  for (const [n, { k, ...i }] of services.entries()) {
    await db.insert(menuItemsTable).values({ orgId: org.id, kind: "service", sort: n, images: await images(k), ...i } as any);
  }
  await db.insert(offersTable).values([
    { orgId: org.id, title: "باقة الدلال", titleEn: "Pamper package", body: "مانيكير + باديكير + تنظيف بشرة بسعر خاص أيام الأسبوع", bodyEn: "Manicure, pedicure and facial at a special weekday price", imageUrl: (await photo("salon-manicure"))?.url ?? null, sort: 0 },
  ]);
  await db.insert(staffTable).values({ orgId: org.id, branchId: branch.id, name: "استقبال", username: "reception", passwordHash: await bcrypt.hash(PASSWORD, 10), role: "staff" });
  await db.update(bookingSettingsTable).set({ enabled: true, capacityPerSlot: 3, slotMin: 30, leadTimeMin: 60 }).where(eq(bookingSettingsTable.branchId, branch.id));
  const [q] = await db.select().from(queuesTable).where(eq(queuesTable.branchId, branch.id));
  const ctx = (await queueCtx(q!.id))!;
  for (const [i, n] of ["مريم", "هند", "Sara"].entries()) await join(ctx, { name: n, partySize: 1, deviceId: `seed-salon-${i}` });
  await rebuild(org.id);
  return org;
}

// The platform admin: runs the platform, owns no shop.
await db.insert(usersTable).values({ phone: "500000000", passwordHash: await bcrypt.hash(PASSWORD, 10), displayName: "مدير المنصة", isAdmin: true, plan: "business" })
  .onConflictDoUpdate({ target: usersTable.phone, set: { passwordHash: await bcrypt.hash(PASSWORD, 10), isAdmin: true, displayName: "مدير المنصة" } });

const a = await restaurant();
const b = await sweets();
const c = await salon();
await demoCustomers(a.id, ["خالد", "سارة", "محمد", "نورة", "عبدالله", "ريم", "فيصل", "هدى", "سلطان", "مها", "يوسف", "لطيفة"]);
await demoCustomers(b.id, ["أم راشد", "منى", "حمد", "شيخة", "علي", "عائشة", "ناصر", "فاطمة"]);
await demoCustomers(c.id, ["مريم", "هند", "دانة", "العنود", "شهد", "جواهر", "لمى", "روان", "غادة", "أمل"]);
console.log(`seeded: /${a.slug}, /${b.slug} and /${c.slug}`);
process.exit(0);
