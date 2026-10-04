// Growth features, one block each: the weekly report to the owner's phone.

import { and, eq } from "drizzle-orm";
import { db, notificationsTable, ownerReportsTable, branchesTable, usersTable, customersTable, orgsTable } from "@workspace/db";
import { createOrder, setOrderStatus } from "../orders/service";
import { weekWindow, reportDue, formatReport, tipFor, ownerPhone, cleanPrefs, computeWeek, sendReport, runWeeklyReports, type WeekStats } from "../growth/weekly-report";
import { cleanReviewUrl, reviewStats } from "../growth/reviews";
import { handleCustomerMessage } from "../notify/inbound";
import { reorderLines, lastOrderOf, orderView } from "../orders/service";
import { queueCommand } from "@workspace/menu-shared";
import { cleanup, makeShop } from "./menu-fixtures";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

// ── 1. The weekly report ──────────────────────────────────────────
const SUN = new Date("2026-10-04T07:00:00Z"); // Sunday 11:00 in Dubai
const w = weekWindow("Asia/Dubai", SUN);
check("the report covers the seven service days that ended this morning", w.from === "2026-09-27" && w.to === "2026-10-03", w);
check("…each day starting at 04:00 local", w.start.toISOString() === "2026-09-27T00:00:00.000Z" && w.end.toISOString() === "2026-10-04T00:00:00.000Z");
check("due on its day after its hour", reportDue({ enabled: true, weekday: 0, hour: 10 }, "Asia/Dubai", SUN));
check("…not before the hour, not another day, not when off", !reportDue({ enabled: true, weekday: 0, hour: 12 }, "Asia/Dubai", SUN) && !reportDue({ enabled: true, weekday: 1, hour: 10 }, "Asia/Dubai", SUN) && !reportDue({ enabled: false, weekday: 0, hour: 10 }, "Asia/Dubai", SUN));
check("…on by default (Sunday 10:00) when never set", reportDue(null, "Asia/Dubai", SUN));
check("prefs are bounded", JSON.stringify(cleanPrefs({ enabled: false, weekday: 9, hour: 3 }, null)) === JSON.stringify({ enabled: false, weekday: 0, hour: 10 }));
check("the owner's phone in any local form becomes international", ownerPhone("0501234567") === "971501234567" && ownerPhone("501234567") === "971501234567" && ownerPhone("+966 512345678") === "966512345678" && ownerPhone("12345") === null);

const base: WeekStats = {
  from: "2026-09-27", to: "2026-10-03", orders: 42, revenue: 3150, prevOrders: 34, prevRevenue: 2500, abandoned: 0,
  newCustomers: 12, returning: 18, optedIn: 5, joined: 110, served: 96, left: 7, noShows: 3, avgWait: 14,
  bookings: 14, bookingNoShows: 1, topItem: { name: "كنافة نابلسية", qty: 31 }, sent: 210, read: 164, avgRating: 4.6, reviewsOn: true, autopilotOn: false, googleOn: true,
};
const o = { shop: "بيت الشامي", currency: "AED", vertical: "restaurant", reportsUrl: "https://x.test/reports", menuUrl: "https://x.test/m" };
const txt = formatReport(base, o);
check("the report says the orders and the change from last week", txt.includes("الطلبات: 42") && txt.includes("↑ 8"), txt.split("\n")[3]);
check("…the sales and the average order", txt.includes("3150") && txt.includes("75"));
check("…who came back and who is new", txt.includes("12 جديد") && txt.includes("18 رجعوا"));
check("…who the queue lost, with an estimate of what they were worth", txt.includes("خسرتم من الصف: 10") && txt.includes("750"));
check("…the best item and how often messages were opened", txt.includes("كنافة نابلسية (31)") && txt.includes("فُتح 78%"));
check("a salon is not told a queue loss in money", !formatReport(base, { ...o, vertical: "barber" }).includes("فرص ضائعة"));
const quiet = formatReport({ ...base, orders: 0, revenue: 0, prevOrders: 0, joined: 0, served: 0, left: 0, noShows: 0, bookings: 0, newCustomers: 0, returning: 0, topItem: null, sent: 0 }, o);
check("a quiet week says so and offers the menu link", quiet.includes("أسبوع هادئ") && quiet.includes(o.menuUrl) && !quiet.includes("الطلبات"));
check("the tip points at abandoned orders first", /لم تكتمل/.test(tipFor({ ...base, abandoned: 4 }) ?? ""));
check("…then at people the queue lost", /قرّب دورك/.test(tipFor(base) ?? ""));
check("…then at turning on reviews", /التقييم/.test(tipFor({ ...base, left: 0, noShows: 0, reviewsOn: false }) ?? ""));
check("…then at adding the Google link when reviews are on", /Google/.test(tipFor({ ...base, left: 0, noShows: 0, googleOn: false }) ?? ""));
check("…then at the weekly campaign", /الحملة الأسبوعية/.test(tipFor({ ...base, left: 0, noShows: 0, optedIn: 30 }) ?? ""));

await cleanup("g");
const shop = await makeShop("g", { plan: "basic" });
await db.update(orgsTable).set({ onboardedAt: new Date() }).where(eq(orgsTable.id, shop.org.id));
const [org0] = await db.select().from(orgsTable).where(eq(orgsTable.id, shop.org.id));
const order = await createOrder(org0!, shop.branch, { type: "pickup", customerName: "سارة", lines: [{ itemId: shop.items[1]!.id, qty: 3 }] });
await setOrderStatus(shop.org.id, [shop.branch.id], order.id, "received");
const stats = await computeWeek(org0!, new Date(Date.now() + 7 * 24 * 3_600_000));
check("the week's orders, sales and best item come from the tables", stats.orders === 1 && stats.revenue === 54 && stats.topItem?.name === "كنافة" && stats.topItem.qty === 3, stats);
let r = await sendReport(org0!, { now: new Date(Date.now() + 7 * 24 * 3_600_000) });
check("with no alert phone and a test owner number, nobody is messaged", r.ok && r.to.length === 0);
await db.delete(ownerReportsTable).where(eq(ownerReportsTable.orgId, shop.org.id));
await db.update(branchesTable).set({ alertPhones: ["971509990002"] }).where(eq(branchesTable.id, shop.branch.id));
r = await sendReport(org0!, { now: new Date(Date.now() + 7 * 24 * 3_600_000) });
const sentRows = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "owner_report")));
check("the report goes to the alert phone, queued on the staff lane", r.ok && sentRows.length === 1 && sentRows[0]!.class === "staff" && sentRows[0]!.status === "queued" && sentRows[0]!.phone === "971509990002", sentRows[0]?.status);
check("…even on the basic plan (it is the owner's own phone)", sentRows[0]!.reason === null);
r = await sendReport(org0!, { now: new Date(Date.now() + 7 * 24 * 3_600_000) });
check("the same week is not sent twice by the clock", !r.ok);
r = await sendReport(org0!, { manual: true, now: new Date(Date.now() + 7 * 24 * 3_600_000) });
check("…but «أرسله لي الآن» always sends", r.ok && r.to.length === 1);
await db.update(orgsTable).set({ reportPrefs: { enabled: false, weekday: 0, hour: 10 } }).where(eq(orgsTable.id, shop.org.id));
check("a shop that switched it off is skipped by the clock", (await runWeeklyReports(SUN)) >= 0 && (await db.select().from(ownerReportsTable).where(and(eq(ownerReportsTable.orgId, shop.org.id), eq(ownerReportsTable.weekStart, w.from)))).length === 0);

// ── 2. Google reviews ─────────────────────────────────────────────
check("a Google review link is accepted and made https", cleanReviewUrl("g.page/r/CabcXYZ/review") === "https://g.page/r/CabcXYZ/review");
check("…and a Maps share link", cleanReviewUrl("https://maps.app.goo.gl/AbC123") === "https://maps.app.goo.gl/AbC123");
check("anything that is not Google is refused", cleanReviewUrl("https://evil.example/google.com") === null && cleanReviewUrl("https://google.com.evil.io/x") === null && cleanReviewUrl("not a url") === null);
await db.update(orgsTable).set({ googleReviewUrl: "https://g.page/r/test/review", features: { reviews: true } }).where(eq(orgsTable.id, shop.org.id));
const asked = (phone: string) => db.insert(customersTable).values({ orgId: shop.org.id, phone, name: "x", reviewAskedAt: new Date() })
  .onConflictDoUpdate({ target: [customersTable.orgId, customersTable.phone], set: { reviewAskedAt: new Date() } });
await asked("971500000301");
check("a rating is ours", await handleCustomerMessage(shop.branch.waUserId, "971500000301", "5"));
let rn = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.phone, "971500000301")));
check("a 5 is answered with the Google review link", rn.length === 1 && rn[0]!.kind === "review_google" && rn[0]!.text.includes("https://g.page/r/test/review"), rn[0]?.text);
const [c5] = await db.select().from(customersTable).where(and(eq(customersTable.orgId, shop.org.id), eq(customersTable.phone, "971500000301")));
check("…and the customer is marked as invited, with when they rated", !!c5?.googleInvitedAt && !!c5.ratedAt && c5.ratingLast === 5);
await asked("971500000302");
await handleCustomerMessage(shop.branch.waUserId, "971500000302", "2");
rn = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.phone, "971500000302")));
check("a 2 is never sent to Google", rn.length === 1 && !rn[0]!.text.includes("g.page") && rn[0]!.kind === "status_reply", rn[0]?.text);
const alerts = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "alert_rating")));
check("…it reaches the owner's phone instead", alerts.length === 1 && alerts[0]!.text.includes("2/5"));
await db.update(orgsTable).set({ googleReviewUrl: null }).where(eq(orgsTable.id, shop.org.id));
await asked("971500000303");
await handleCustomerMessage(shop.branch.waUserId, "971500000303", "4");
rn = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.phone, "971500000303")));
check("with no Google link, a 4 is simply thanked", rn.length === 1 && rn[0]!.kind === "status_reply" && !rn[0]!.text.includes("Google"));
const rs = await reviewStats(shop.org.id);
check("the panel counts ratings, the average and who went to Google", rs.rated === 3 && rs.happy === 2 && rs.unhappy === 1 && rs.toGoogle === 1 && rs.avg === 3.7, rs);

// ── 3. «نفس الطلب» ────────────────────────────────────────────────
check("«نفس الطلب» and its cousins are recognised", ["نفس الطلب", "المعتاد", "طلبي المعتاد؟", "كرر الطلب", "same again", "Reorder"].every((x) => queueCommand(x) === "reorder"));
check("…and a normal sentence is not", queueCommand("ابي نفس الطلب بس بدون بصل") === null && queueCommand("الطلب وصل") === null);
const rl = reorderLines({ items: [{ itemId: 7, name: "برجر", qty: 2, unitPrice: 42, options: [{ group: "الحجم", choice: "دبل", priceDelta: 10 }, { group: "إضافات", choice: "جبنة", priceDelta: 3 }, { group: "إضافات", choice: "بطاطا", priceDelta: 7 }], note: "بدون بصل", lineTotal: 104 }] } as any);
check("an order's lines become cart lines, options grouped back", JSON.stringify(rl) === JSON.stringify([{ itemId: 7, qty: 2, selections: [{ group: "الحجم", choices: ["دبل"] }, { group: "إضافات", choice: undefined, choices: ["جبنة", "بطاطا"] }].map((x: any) => ({ group: x.group, choices: x.choices })), note: "بدون بصل" }]), rl);
const burger = shop.items[0]!;
const ro = await createOrder(org0!, shop.branch, { type: "pickup", customerName: "منى", phone: "0500000401", lines: [{ itemId: burger.id, qty: 1, selections: [{ group: "الحجم", choices: ["دبل"] }] }, { itemId: shop.items[1]!.id, qty: 2 }] });
check("the last order of a phone is found", (await lastOrderOf(shop.org.id, "971500000401"))?.id === ro.id);
const view = (await orderView(ro))!;
check("the public order carries its lines for reordering", view.reorder.length === 2 && view.reorder[0]!.itemId === burger.id && view.reorder[0]!.selections[0]!.choices[0] === "دبل");
await handleCustomerMessage(shop.branch.waUserId, "971500000401", "نفس الطلب");
let rr = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.phone, "971500000401"), eq(notificationsTable.kind, "reorder_link")));
check("on WhatsApp, «نفس الطلب» is answered with a link that refills the cart", rr.length === 1 && rr[0]!.text.includes(`?reorder=${ro.token}`) && rr[0]!.text.includes("2× كنافة"), rr[0]?.text);
await handleCustomerMessage(shop.branch.waUserId, "971500000499", "المعتاد");
rr = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.phone, "971500000499")));
check("…and a number with no past order gets the menu instead", rr.length === 1 && !rr[0]!.text.includes("reorder=") && rr[0]!.text.includes("ما لقينا"));

await cleanup("g");
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
