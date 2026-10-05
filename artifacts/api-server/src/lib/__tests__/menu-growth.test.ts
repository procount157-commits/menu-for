// Growth features, one block each: the weekly report to the owner's phone.

import { and, eq, sql } from "drizzle-orm";
import { db, notificationsTable, ownerReportsTable, branchesTable, usersTable, customersTable, orgsTable } from "@workspace/db";
import { createOrder, setOrderStatus } from "../orders/service";
import { weekWindow, reportDue, formatReport, tipFor, ownerPhone, cleanPrefs, computeWeek, sendReport, runWeeklyReports, type WeekStats } from "../growth/weekly-report";
import { cleanReviewUrl, reviewStats } from "../growth/reviews";
import { handleCustomerMessage } from "../notify/inbound";
import { reorderLines, lastOrderOf, orderView } from "../orders/service";
import { queueCommand, dealOpen, dealDiscount, bestAutoDeal, normaliseCode, type Deal } from "@workspace/menu-shared";
import { cleanDeal, resolveDeal, createPersonalCode, liveDeals } from "../growth/deals";
import { orderMessage } from "../orders/service";
import { shopDealsTable } from "@workspace/db";
import { fold, record, menuReport, lookedNotBought } from "../growth/menu-stats";
import { createGift, giftByCode, giftProblem, spendGift, giftMessage, giftView, listGifts } from "../growth/gifts";
import { giftCardsTable, ordersTable } from "@workspace/db";
import { referralCodeFor, friendDiscount, referralStats } from "../growth/referrals";
import { customerReferralsTable } from "@workspace/db";
import { churnRisk, type ChurnInput } from "../growth/churn";
import { nudges, suggestedPlan, usageOf, requestUpgrade } from "../growth/upgrade";
import { isPrivateAddress, cleanMenuUrl, pageText, UrlImportError } from "../menu/import-url";
import { shopReferralCode, setReferredBy, rewardShopReferral, shopReferralStats } from "../growth/shop-referrals";
import { subscriptionLeadsTable } from "@workspace/db";
import { validBirthday, shouldAskBirthday, saveBirthday, birthdayToday, birthdayMessage, runBirthdays } from "../growth/birthday";
import { createOrg, DEFAULT_FEATURES } from "../tenancy/org";
import { buildPairs, oneTap, pairsFor } from "../growth/upsell";
import { platformMetrics, monthly } from "../growth/platform-metrics";
import { resolvePlan, loadPlans, invalidatePlans, menuPlan, DEFAULT_TRIAL, cleanTrialSettings } from "../plans";
import { takeMessage, allowance, kindOf, monthKey } from "../growth/quota";
import { startTrial, earnsExtension, maybeExtendTrial } from "../growth/trial";
import { bulletsFor, DEFAULT_PLANS, type PlanDef } from "@workspace/menu-shared";
import { orgUsageTable, subscriptionPlansTable } from "@workspace/db";
import { addStamp, loyaltyFor, loyaltyStats, rewardText, loyaltyPrefs } from "../growth/loyalty";
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

// ── 4. Coupons and timed deals ────────────────────────────────────
const D = (x: Partial<Deal>): Deal => ({ id: 1, code: null, title: "ساعة سعيدة", kind: "pct", value: 15, minSubtotal: 0, maxDiscount: null, days: [], fromTime: null, toTime: null, startsAt: null, endsAt: null, maxUses: null, uses: 0, isActive: true, ...x });
const TZ = "Asia/Dubai";
const thu = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00+04:00`); // a Thursday
check("a 15:00–18:00 deal runs at 16:30", dealOpen(D({ fromTime: "15:00", toTime: "18:00" }), TZ, thu("16:30")));
check("…not at 18:00 or 14:59", !dealOpen(D({ fromTime: "15:00", toTime: "18:00" }), TZ, thu("18:00")) && !dealOpen(D({ fromTime: "15:00", toTime: "18:00" }), TZ, thu("14:59")));
check("a late-night window wraps past midnight, counted to the day it opened", dealOpen(D({ fromTime: "22:00", toTime: "02:00", days: [4] }), TZ, new Date("2026-10-02T01:00:00+04:00")) && !dealOpen(D({ fromTime: "22:00", toTime: "02:00", days: [5] }), TZ, new Date("2026-10-02T01:00:00+04:00")));
check("days limit it", !dealOpen(D({ days: [0, 1] }), TZ, thu("12:00")) && dealOpen(D({ days: [4] }), TZ, thu("12:00")));
check("an ended, used-up or switched-off deal does not run", !dealOpen(D({ endsAt: thu("10:00") }), TZ, thu("12:00")) && !dealOpen(D({ maxUses: 5, uses: 5 }), TZ, thu("12:00")) && !dealOpen(D({ isActive: false }), TZ, thu("12:00")));
check("15% of 80 is 12; nothing below the minimum; capped at its maximum", dealDiscount(D({}), 80) === 12 && dealDiscount(D({ minSubtotal: 100 }), 80) === 0 && dealDiscount(D({ maxDiscount: 10 }), 80) === 10);
check("an amount off never exceeds the order", dealDiscount(D({ kind: "amount", value: 50 }), 30) === 30);
check("the best automatic deal wins; coded and personal ones never apply alone", bestAutoDeal([D({ id: 1, value: 10 }), D({ id: 2, value: 20 }), D({ id: 3, value: 50, code: "X" }), D({ id: 4, value: 60, phone: "971" })], 100, TZ, thu("12:00"))?.deal.id === 2);
check("codes are typed any way", normaliseCode(" ramadan 20 ") === "RAMADAN20");
check("the owner's form: a deal with no code needs hours, days or an end", !cleanDeal({ title: "خصم", value: 10 }).ok && cleanDeal({ title: "خصم", value: 10, fromTime: "15:00", toTime: "18:00" }).ok);
check("…a percentage stays under 90, both hours or neither", !cleanDeal({ title: "x", value: 95, code: "AB1" }).ok && !cleanDeal({ title: "x", value: 10, code: "AB1", fromTime: "15:00" }).ok);
check("…and the code is cleaned", (cleanDeal({ title: "x", value: 10, code: "eid 25" }) as any).row.code === "EID25");

await db.update(usersTable).set({ plan: "pro" }).where(eq(usersTable.id, shop.user.id));
const [hh] = await db.insert(shopDealsTable).values({ orgId: shop.org.id, title: "خصم الأسبوع", kind: "pct", value: "10", endsAt: new Date(Date.now() + 86_400_000) }).returning();
const live = await liveDeals(org0!, shop.branch.id);
check("a running automatic deal is on the public menu", live.length === 1 && live[0]!.title === "خصم الأسبوع" && live[0]!.label === "خصم 10%");
const o10 = await createOrder(org0!, shop.branch, { type: "pickup", lines: [{ itemId: shop.items[1]!.id, qty: 5 }] });
check("with no code, the automatic deal applies by itself", Number(o10.discount) === 9 && o10.dealTitle === "خصم الأسبوع" && Number(o10.subtotal) === 90);
check("the WhatsApp order shows the discount and what to pay", orderMessage(o10, org0!).includes("خصم الأسبوع: −9") && orderMessage(o10, org0!).includes("الإجمالي: 81"));
await db.insert(shopDealsTable).values({ orgId: shop.org.id, code: "EID25", title: "عرض العيد", kind: "amount", value: "25", minSubtotal: "50", maxUses: 2, oncePerPhone: true });
let rd = await resolveDeal(org0!, shop.branch.id, 40, { code: "eid25", phone: "971500000501" });
check("a code below its minimum says so", !!rd && "error" in rd && /الحد الأدنى/.test(rd.error), rd);
rd = await resolveDeal(org0!, shop.branch.id, 90, { code: "EID25" });
check("a once-per-phone code needs the number", !!rd && "error" in rd && /رقم/.test(rd.error));
const oc = await createOrder(org0!, shop.branch, { type: "pickup", phone: "0500000501", couponCode: "eid25", lines: [{ itemId: shop.items[1]!.id, qty: 5 }] });
check("a typed code replaces the automatic deal", Number(oc.discount) === 25 && oc.dealTitle === "عرض العيد");
let threw = "";
try { await createOrder(org0!, shop.branch, { type: "pickup", phone: "0500000501", couponCode: "EID25", lines: [{ itemId: shop.items[1]!.id, qty: 5 }] }); } catch (e) { threw = (e as Error).message; }
check("…and the same phone cannot use it twice", /من قبل/.test(threw), threw);
await createOrder(org0!, shop.branch, { type: "pickup", phone: "0500000502", couponCode: "EID25", lines: [{ itemId: shop.items[1]!.id, qty: 5 }] });
threw = "";
try { await createOrder(org0!, shop.branch, { type: "pickup", phone: "0500000503", couponCode: "EID25", lines: [{ itemId: shop.items[1]!.id, qty: 5 }] }); } catch (e) { threw = (e as Error).message; }
check("a code limited to 2 uses stops at 2", /انتهى/.test(threw), threw);
threw = "";
try { await createOrder(org0!, shop.branch, { type: "pickup", couponCode: "NOPE", lines: [{ itemId: shop.items[1]!.id, qty: 1 }] }); } catch (e) { threw = (e as Error).message; }
check("a wrong code stops the order with a reason (not a silent full price)", /غير صحيح/.test(threw));
const pc = await createPersonalCode(shop.org.id, "971500000504", { title: "هدية", kind: "pct", value: 20, days: 7, source: "birthday", prefix: "BD" });
rd = await resolveDeal(org0!, shop.branch.id, 90, { code: pc.code, phone: "971500000505" });
check("a personal code works only for its own phone", !!rd && "error" in rd && /رقم آخر/.test(rd.error));
rd = await resolveDeal(org0!, shop.branch.id, 90, { code: pc.code!, phone: "971500000504" });
check("…and does for it", !!rd && !("error" in rd) && rd.discount === 18);
await db.update(shopDealsTable).set({ isActive: false }).where(eq(shopDealsTable.id, hh!.id));

// ── 5. Menu analytics ─────────────────────────────────────────────
const valid = new Set([shop.items[0]!.id, shop.items[1]!.id]);
const T0 = Date.now();
let fc = fold("sidA", [{ k: "menu" }, { k: "menu" }, { k: "item", id: shop.items[1]!.id }, { k: "item", id: shop.items[1]!.id }, { k: "add", id: shop.items[1]!.id }, { k: "add", id: shop.items[1]!.id }, { k: "item", id: 999999 }, { k: "cart" }], valid, T0);
check("a session's menu and item looks count once; every add counts", fc.get(0)?.views === 1 && fc.get(0)?.carts === 1 && fc.get(shop.items[1]!.id)?.views === 1 && fc.get(shop.items[1]!.id)?.adds === 2);
check("…an item from another shop is ignored", !fc.has(999999));
check("…and the same session half an hour later counts again", fold("sidA", [{ k: "menu" }], valid, T0 + 31 * 60_000).get(0)?.views === 1 && !fold("sidA", [{ k: "menu" }], valid, T0 + 5 * 60_000).size);
await record(org0!, shop.branch.id, fc);
await record(org0!, shop.branch.id, fold("sidB", [{ k: "menu" }, { k: "item", id: shop.items[0]!.id }], valid, T0));
for (let i = 0; i < 12; i++) await record(org0!, shop.branch.id, fold(`v${i}`, [{ k: "item", id: shop.items[0]!.id }], valid, T0));
const mr = await menuReport(org0!, [shop.branch.id], 7);
check("the funnel adds up: two menus opened, item looks, adds, a cart", mr.funnel.menuViews === 2 && mr.funnel.itemViews === 14 && mr.funnel.adds === 2 && mr.funnel.carts === 1, mr.funnel);
const burgerRow = mr.items.find((i) => i.item_id === shop.items[0]!.id);
check("the burger was looked at 13 times and ordered once", burgerRow?.views === 13 && burgerRow.ordered === 1, burgerRow);
check("looked at a lot, rarely ordered, is flagged", lookedNotBought([{ views: 40, ordered: 1, n: "a" }, { views: 40, ordered: 10, n: "b" }, { views: 5, ordered: 0, n: "c" }] as any).map((x: any) => x.n).join() === "a");
check("orders by hour are there for the peak", mr.byHour.reduce((a, h) => a + h.orders, 0) === mr.funnel.orders);

// ── 6. Gift cards ─────────────────────────────────────────────────
await db.update(branchesTable).set({ alertPhones: [] }).where(eq(branchesTable.id, shop.branch.id));
const gc = await createGift(org0!, shop.branch, { amount: 100, recipientName: "نورة", recipientPhone: "0500000601", buyerName: "أختها", message: "كل عام وأنتِ بخير" }, "صاحب المحل");
check("a gift card has a code, its full balance and a year of life", /^G[A-Z0-9]{6}$/.test(gc.code) && Number(gc.balance) === 100 && !!gc.expiresAt && gc.expiresAt.getTime() > Date.now() + 300 * 86_400_000);
const gn = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "gift_card")));
check("…and is sent to the recipient's WhatsApp with the buyer's words and the link", gn.length === 1 && gn[0]!.phone === "971500000601" && gn[0]!.class === "consented" && gn[0]!.text.includes("كل عام وأنتِ بخير") && gn[0]!.text.includes(`/g/${gc.token}`) && gn[0]!.text.includes("من أختها"));
check("the message names the amount", giftMessage(gc, org0!).includes("100 د.إ"));
let threw2 = "";
try { await createGift(org0!, shop.branch, { amount: 0 }, "x"); } catch (e) { threw2 = (e as Error).message; }
check("a zero card is refused", /بين/.test(threw2));
check("the code is found however it is typed", (await giftByCode(shop.org.id, gc.code.toLowerCase()))?.id === gc.id && (await giftByCode(shop.org.id, "NOTACODE")) === null);
check("spending at the counter takes it off", !!(await spendGift(gc.id, 30, { note: "كاشير" })) && Number((await giftByCode(shop.org.id, gc.code))!.balance) === 70);
check("…and never more than is there", (await spendGift(gc.id, 71)) === null);
await db.update(shopDealsTable).set({ isActive: false }).where(eq(shopDealsTable.orgId, shop.org.id));
const og = await createOrder(org0!, shop.branch, { type: "pickup", couponCode: gc.code, lines: [{ itemId: shop.items[1]!.id, qty: 2 }] });
check("in the cart, the card pays the order", Number(og.giftAmount) === 36 && og.giftCardId === gc.id && Number((await giftByCode(shop.org.id, gc.code))!.balance) === 34);
check("…and the WhatsApp order shows it and leaves nothing to pay", orderMessage(og, org0!).includes("بطاقة هدية: −36") && orderMessage(og, org0!).includes("الإجمالي: 0"));
const og2 = await createOrder(org0!, shop.branch, { type: "pickup", couponCode: gc.code, lines: [{ itemId: shop.items[1]!.id, qty: 3 }] });
check("a bigger order uses what is left, and the rest is paid", Number(og2.giftAmount) === 34 && Number((await giftByCode(shop.org.id, gc.code))!.balance) === 0 && (await giftByCode(shop.org.id, gc.code))!.status === "used");
threw2 = "";
try { await createOrder(org0!, shop.branch, { type: "pickup", couponCode: gc.code, lines: [{ itemId: shop.items[1]!.id, qty: 1 }] }); } catch (e) { threw2 = (e as Error).message; }
check("an empty card says so", /صفر/.test(threw2));
await setOrderStatus(shop.org.id, [shop.branch.id], og2.id, "cancelled");
const back = (await giftByCode(shop.org.id, gc.code))!;
check("cancelling the order gives the card its amount back", Number(back.balance) === 34 && back.status === "active");
await db.update(giftCardsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(giftCardsTable.id, gc.id));
check("an expired card cannot be spent", giftProblem((await giftByCode(shop.org.id, gc.code))!) === "انتهت صلاحية البطاقة" && (await spendGift(gc.id, 1)) === null);
const gv = await giftView(gc.token);
check("the card's page shows the balance, the message and the problem", gv?.balance === 34 && gv.message === "كل عام وأنتِ بخير" && gv.problem === "انتهت صلاحية البطاقة");
const lg = await listGifts(shop.org.id);
check("the shop sees what was sold and what is still owed", lg.stats.sold === 100 && lg.stats.outstanding === 0 && lg.stats.count === 1, lg.stats);

// ── 7. Birthday gift ──────────────────────────────────────────────
check("real dates only, 29 February allowed", !!validBirthday(2, 29) && !validBirthday(2, 30) && !validBirthday(13, 1) && !validBirthday(4, 31) && validBirthday("6", "15")?.day === 15);
check("a 29 February birthday is greeted on the 28th in a common year", birthdayToday(2, 29, { month: 2, day: 28, year: 2027 }) && !birthdayToday(2, 29, { month: 2, day: 28, year: 2028 }));
check("the greeting carries the code, the gift and the link", birthdayMessage({ name: "سالم", shop: "الفارس", pct: 15, days: 7, code: "BDXYZ12", link: "https://x/m", services: true }).includes("BDXYZ12") && birthdayMessage({ name: "سالم", shop: "الفارس", pct: 15, days: 7, code: "BDXYZ12", link: "https://x/m", services: true }).includes("خصم 15%"));
await db.insert(customersTable).values({ orgId: shop.org.id, phone: "971500000701", name: "سالم" }).onConflictDoNothing();
check("nobody is asked while the gift is off", !(await shouldAskBirthday({ id: shop.org.id, features: {} }, "971500000701")));
check("a known customer is asked when it is on", await shouldAskBirthday({ id: shop.org.id, features: { birthday: true } }, "971500000701"));
await db.update(orgsTable).set({ features: { birthday: true } }).where(eq(orgsTable.id, shop.org.id));
const now7 = new Date(); // today, 11:00-ish local is needed: pick a moment at 12:00 Dubai today
const noonDubai = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now7)}T12:00:00+04:00`);
const md = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dubai", month: "numeric", day: "numeric" }).formatToParts(noonDubai);
await saveBirthday(shop.org.id, "971500000701", Number(md.find((x) => x.type === "month")!.value), Number(md.find((x) => x.type === "day")!.value));
check("…and not again once the date is known", !(await shouldAskBirthday({ id: shop.org.id, features: { birthday: true } }, "971500000701")));
const sentB = await runBirthdays(noonDubai);
const bn = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "birthday")));
check("on the day, the greeting is queued with a personal code", sentB >= 1 && bn.length === 1 && bn[0]!.phone === "971500000701" && /BD[A-Z0-9]{5}/.test(bn[0]!.text) && bn[0]!.class === "consented");
const code7 = bn[0]!.text.match(/BD[A-Z0-9]{5}/)![0];
const [bdDeal] = await db.select().from(shopDealsTable).where(and(eq(shopDealsTable.orgId, shop.org.id), eq(shopDealsTable.code, code7)));
check("…the code is for that phone, once, for a week", bdDeal?.phone === "971500000701" && bdDeal.maxUses === 1 && bdDeal.source === "birthday" && !!bdDeal.endsAt && bdDeal.endsAt.getTime() < Date.now() + 8 * 86_400_000);
await runBirthdays(noonDubai);
check("…and the same year is never greeted twice", (await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "birthday")))).length === 1);
check("nothing goes out at night", (await runBirthdays(new Date(noonDubai.getTime() + 11 * 3_600_000))) === 0);

// ── 8. «ادعُ صديقاً» ──────────────────────────────────────────────
await db.update(orgsTable).set({ features: { referral: true }, growthPrefs: { referral: { friendPct: 10, rewardPct: 20, rewardDays: 30 } } }).where(eq(orgsTable.id, shop.org.id));
const [org8] = await db.select().from(orgsTable).where(eq(orgsTable.id, shop.org.id));
const referrer = await createOrder(org8!, shop.branch, { type: "pickup", phone: "0500000801", lines: [{ itemId: shop.items[1]!.id, qty: 1 }] });
const rcode = (await referralCodeFor(shop.org.id, "971500000801"))!;
check("a customer gets a share code once", /^[A-Z0-9]{6}$/.test(rcode) && (await referralCodeFor(shop.org.id, "971500000801")) === rcode);
const rv = (await orderView(referrer))!;
check("their order page carries the share link and what it gives", !!rv.referral && rv.referral.link.includes(`?ref=${rcode}`) && rv.referral.friendPct === 10 && rv.referral.rewardPct === 20);
check("nobody is their own friend", (await friendDiscount(org8!, rcode, "971500000801", 100)) === null);
check("a customer the shop already knows is not a new friend", (await friendDiscount(org8!, rcode, "971500000501", 100)) === null);
const fo = await createOrder(org8!, shop.branch, { type: "pickup", phone: "0500000802", referralCode: rcode.toLowerCase(), lines: [{ itemId: shop.items[1]!.id, qty: 5 }] });
check("a new friend's first order gets the friend's discount", Number(fo.discount) === 9 && fo.dealTitle === "هدية من صديقك", { d: fo.discount, t: fo.dealTitle });
const [refRow] = await db.select().from(customerReferralsTable).where(and(eq(customerReferralsTable.orgId, shop.org.id), eq(customerReferralsTable.friendPhone, "971500000802")));
check("…and the referral is recorded against that order", refRow?.referrerPhone === "971500000801" && refRow.orderId === fo.id && refRow.status === "pending");
const fo2 = await createOrder(org8!, shop.branch, { type: "pickup", phone: "0500000802", referralCode: rcode, lines: [{ itemId: shop.items[1]!.id, qty: 5 }] });
check("a friend's second order is full price", Number(fo2.discount) === 0);
await setOrderStatus(shop.org.id, [shop.branch.id], fo.id, "completed");
const rw = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "referral_reward")));
check("when the friend's order is completed, the inviter gets a code on WhatsApp", rw.length === 1 && rw[0]!.phone === "971500000801" && /RF[A-Z0-9]{5}/.test(rw[0]!.text) && rw[0]!.text.includes("20%"));
await setOrderStatus(shop.org.id, [shop.branch.id], fo.id, "ready");
await setOrderStatus(shop.org.id, [shop.branch.id], fo.id, "completed");
check("…once, even if the order is completed again", (await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "referral_reward")))).length === 1);
const fo3 = await createOrder(org8!, shop.branch, { type: "pickup", phone: "0500000803", referralCode: rcode, lines: [{ itemId: shop.items[1]!.id, qty: 2 }] });
await setOrderStatus(shop.org.id, [shop.branch.id], fo3.id, "cancelled");
const [void3] = await db.select().from(customerReferralsTable).where(eq(customerReferralsTable.orderId, fo3.id));
check("a cancelled friend's order earns nothing", void3?.status === "void");
const rst = await referralStats(shop.org.id);
check("the owner sees friends, rewards and their sales", rst.friends === 2 && rst.rewarded === 1 && rst.sales === 81, rst);

// ── 9. Shops about to leave ───────────────────────────────────────
const NOWC = Date.parse("2026-10-04T12:00:00Z");
const ago9 = (d: number) => new Date(NOWC - d * 86_400_000).toISOString();
const healthy: ChurnInput = { status: "active", plan: "pro", plan_expires_at: ago9(-30), last_login_at: ago9(1), created_at: ago9(60), onboarded_at: ago9(59), items: 20, tickets_7d: 40, orders_7d: 12, bookings_7d: 3, wa: { linked: 1, total: 1 } };
check("a busy shop is fine", churnRisk(healthy, NOWC).level === "ok");
check("an expired paid plan is high risk", churnRisk({ ...healthy, plan_expires_at: ago9(2) }, NOWC).reasons[0] === "انتهت الخطة ولم تُجدّد" && churnRisk({ ...healthy, plan_expires_at: ago9(2) }, NOWC).level === "high");
check("a plan ending in 5 days is one to watch", churnRisk({ ...healthy, plan_expires_at: ago9(-5) }, NOWC).level === "watch" && /5 أيام/.test(churnRisk({ ...healthy, plan_expires_at: ago9(-5) }, NOWC).reasons[0]!));
check("no login for 20 days is high; 9 days is watch", churnRisk({ ...healthy, last_login_at: ago9(20) }, NOWC).level === "high" && churnRisk({ ...healthy, last_login_at: ago9(9) }, NOWC).level === "watch");
check("a week with no orders, queue or bookings is high", churnRisk({ ...healthy, tickets_7d: 0, orders_7d: 0, bookings_7d: 0 }, NOWC).reasons.includes("لا طلبات ولا دور ولا حجوزات منذ 7 أيام"));
check("WhatsApp never linked and an empty menu are named", churnRisk({ ...healthy, wa: { linked: 0, total: 1 }, items: 1 }, NOWC).reasons.join() === "واتساب غير مربوط,المنيو شبه فارغ");
check("a shop that never finished setting up is one to watch", churnRisk({ ...healthy, onboarded_at: null, created_at: ago9(5) }, NOWC).reasons.includes("لم يكمل تجهيز المحل"));
check("a suspended shop is not chased", churnRisk({ ...healthy, status: "suspended", plan_expires_at: ago9(9) }, NOWC).level === "ok");

// ── 10. Upgrade at the limit ──────────────────────────────────────
const nz = nudges({ branches: 3, items: 10, staff: 8 }, { branches: 3, items: -1, staff: 10 });
check("limits at 80% or more are named, fullest first; unlimited never", nz.map((x) => `${x.key}:${x.full}`).join() === "branches:true,staff:false", nz);
check("the next plan up is suggested", suggestedPlan("free") === "pro" && suggestedPlan("basic") === "pro" && suggestedPlan("pro") === "business" && suggestedPlan("business") === null);
const us = await usageOf(shop.org.id);
check("usage counts the shop's branches, items and staff", us.branches === 1 && us.items === 3 && us.staff === 0, us);
await requestUpgrade(org8!, "business", "وصلت الفروع لحد خطتك");
await requestUpgrade(org8!, "business", "مرة ثانية");
const [ownerU] = await db.select().from(usersTable).where(eq(usersTable.id, shop.user.id));
const leads = await db.select().from(subscriptionLeadsTable).where(and(eq(subscriptionLeadsTable.phone, ownerU!.phone), eq(subscriptionLeadsTable.source, "in_app")));
check("«اطلب الترقية» lands in the admin's requests with the shop and the reason — once", leads.length === 1 && leads[0]!.planName === "الباقة الكاملة" && leads[0]!.notes!.includes(shop.org.slug) && leads[0]!.notes!.includes("مرة ثانية"));
await db.delete(subscriptionLeadsTable).where(eq(subscriptionLeadsTable.phone, ownerU!.phone));

// ── 11. Shop brings shop ──────────────────────────────────────────
const shop2 = await makeShop("g", { plan: "free" });
const [o1] = await db.select().from(orgsTable).where(eq(orgsTable.id, shop.org.id));
const sc = await shopReferralCode(o1!);
check("a shop gets one invitation code", /^M[A-Z0-9]{5}$/.test(sc) && (await shopReferralCode({ id: shop.org.id, referralCode: null })) === sc);
check("a shop cannot bring itself", !(await setReferredBy(shop.org.id, sc)));
check("the new shop remembers who brought it", await setReferredBy(shop2.org.id, sc.toLowerCase()));
check("…only the first time", !(await setReferredBy(shop2.org.id, sc)));
await db.update(branchesTable).set({ alertPhones: ["971509990011"] }).where(eq(branchesTable.id, shop.branch.id));
const before1 = (await db.select().from(usersTable).where(eq(usersTable.id, shop.user.id)))[0]!.planExpiresAt;
check("when the brought shop first pays, both get a month", await rewardShopReferral(shop2.org.id));
const after1 = (await db.select().from(usersTable).where(eq(usersTable.id, shop.user.id)))[0]!.planExpiresAt!;
const after2 = (await db.select().from(usersTable).where(eq(usersTable.id, shop2.user.id)))[0]!.planExpiresAt!;
const base1 = Math.max(Date.now(), before1?.getTime() ?? 0);
check("…30 days on top of what each had", Math.abs(after1.getTime() - base1 - 30 * 86_400_000) < 120_000 && Math.abs(after2.getTime() - Date.now() - 30 * 86_400_000) < 120_000, { after1, after2 });
const ra = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "alert_referral")));
check("…and the shop that brought it is told on WhatsApp", ra.length === 1 && ra[0]!.text.includes(shop2.org.name));
check("…once", !(await rewardShopReferral(shop2.org.id)));
const ss = await shopReferralStats(shop.org.id);
check("the owner sees who they brought and the days earned", ss.brought === 1 && ss.rewarded === 1 && ss.freeDays === 30, ss);

// ── 12. The shop's own menu link ──────────────────────────────────
check("private, loopback and metadata addresses are refused", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.10", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"].every(isPrivateAddress));
check("…public ones are not", !isPrivateAddress("8.8.8.8") && !isPrivateAddress("172.32.0.1") && !isPrivateAddress("2a00:1450::1"));
const refused = (u: string) => { try { cleanMenuUrl(u); return false; } catch (e) { return e instanceof UrlImportError; } };
check("links to the server's own network are refused before any fetch", ["http://localhost/menu", "http://127.0.0.1/", "https://10.1.2.3/x", "ftp://example.com/m.pdf", "https://user:pw@example.com/", "https://example.com:8080/", "http://router.local/"].every(refused));
check("a normal link is made https when typed bare", cleanMenuUrl("example.com/menu").toString() === "https://example.com/menu");
const html = `<html><head><style>.x{}</style><script>var a=1</script><script type="application/ld+json">{"@type":"Menu","hasMenuSection":[{"name":"مشاوي","hasMenuItem":[{"name":"شيش طاووق","offers":{"price":"32"}}]}]}</script></head><body><h1>منيو المطعم</h1><div>كنافة نابلسية&nbsp;— 18 درهم</div><p>شاي كرك 5</p></body></html>`;
const pt = pageText(html);
check("a page's text keeps the menu data and the visible words, not scripts or styles", pt.includes("شيش طاووق") && pt.includes("كنافة نابلسية — 18 درهم") && pt.includes("شاي كرك 5") && !pt.includes("var a=1") && !pt.includes(".x{}"));

// ── 13. Smart defaults for a new shop ─────────────────────────────
await db.delete(usersTable).where(eq(usersTable.phone, "971509998877"));
const [nu] = await db.insert(usersTable).values({ phone: "971509998877", passwordHash: "!", plan: "pro" }).returning();
const fresh = await createOrg(nu!.id, { name: "محل جديد للاختبار", vertical: "cafe" } as any);
check("a new shop starts with reviews, the birthday gift and the stamp card on", fresh.org.features.reviews === true && fresh.org.features.birthday === true && fresh.org.features.loyalty === true && JSON.stringify(DEFAULT_FEATURES) === JSON.stringify({ reviews: true, birthday: true, loyalty: true }));
check("…the owner's phone is told about orders from the first day", JSON.stringify(fresh.branch.alertPhones) === JSON.stringify(["971509998877"]));
const [welcome] = await db.select().from(shopDealsTable).where(and(eq(shopDealsTable.orgId, fresh.org.id), eq(shopDealsTable.code, "WELCOME10")));
check("…and, on a plan with offers, a first-order code", welcome?.oncePerPhone === true && Number(welcome.value) === 10 && Number(welcome.maxDiscount) === 20);
await db.delete(orgsTable).where(eq(orgsTable.id, fresh.org.id));
await db.update(usersTable).set({ plan: "basic", orgId: null }).where(eq(usersTable.id, nu!.id));
const fresh2 = await createOrg(nu!.id, { name: "محل أساسي للاختبار" } as any);
check("a plan without offers gets no code", (await db.select().from(shopDealsTable).where(eq(shopDealsTable.orgId, fresh2.org.id))).length === 0);
await db.delete(orgsTable).where(eq(orgsTable.id, fresh2.org.id));
await db.delete(usersTable).where(eq(usersTable.id, nu!.id));

// ── 14. The stamp card ────────────────────────────────────────────
await db.update(usersTable).set({ plan: "pro" }).where(eq(usersTable.id, shop.user.id));
await db.update(orgsTable).set({ features: { loyalty: true }, growthPrefs: { loyalty: { target: 3, rewardKind: "amount", rewardValue: 15, rewardDays: 30 } } }).where(eq(orgsTable.id, shop.org.id));
const [o14] = await db.select().from(orgsTable).where(eq(orgsTable.id, shop.org.id));
check("the reward is said in words, or in the owner's own", rewardText(loyaltyPrefs(o14!), "AED") === "هدية بقيمة 15 د.إ" && rewardText({ ...loyaltyPrefs(o14!), rewardLabel: "قهوة مجانية" }, "AED") === "قهوة مجانية");
await db.insert(customersTable).values({ orgId: shop.org.id, phone: "971500001401", name: "ماجد" }).onConflictDoNothing();
const d1 = new Date("2026-10-05T12:00:00+04:00"), d2 = new Date("2026-10-06T12:00:00+04:00"), d3 = new Date("2026-10-07T12:00:00+04:00");
let st = await addStamp(o14!, shop.branch, "971500001401", d1);
check("a visit gives a stamp", st?.stamps === 1 && st.target === 3 && !st.rewarded);
check("…but only one a day", (await addStamp(o14!, shop.branch, "971500001401", new Date(d1.getTime() + 3_600_000))) === null);
check("the customer's pages show the card", JSON.stringify(await loyaltyFor(o14!, "971500001401")) === JSON.stringify({ stamps: 1, target: 3, reward: "هدية بقيمة 15 د.إ" }));
await addStamp(o14!, shop.branch, "971500001401", d2);
st = await addStamp(o14!, shop.branch, "971500001401", d3);
check("the third stamp fills the card and starts a new one", st?.rewarded === true && st.stamps === 0);
const lr = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "loyalty_reward")));
check("…and the gift goes to their WhatsApp with a code of their own", lr.length === 1 && lr[0]!.phone === "971500001401" && /LY[A-Z0-9]{5}/.test(lr[0]!.text) && lr[0]!.text.includes("هدية بقيمة 15"));
const lyCode = lr[0]!.text.match(/LY[A-Z0-9]{5}/)![0];
const rd14 = await resolveDeal(o14!, shop.branch.id, 50, { code: lyCode, phone: "971500001401" });
check("…which takes the gift off their next order", !!rd14 && !("error" in rd14) && rd14.discount === 15);
await db.update(customersTable).set({ lastStampDay: null }).where(and(eq(customersTable.orgId, shop.org.id), eq(customersTable.phone, "971500001401")));
const o14o = await createOrder(o14!, shop.branch, { type: "pickup", phone: "0500001401", lines: [{ itemId: shop.items[1]!.id, qty: 1 }] });
await setOrderStatus(shop.org.id, [shop.branch.id], o14o.id, "completed");
check("a completed order gives a stamp too", (await loyaltyFor(o14!, "971500001401"))?.stamps === 1);
const ls = await loyaltyStats(shop.org.id);
check("the owner sees members and completed cards", ls.members >= 1 && ls.rewards === 1, ls);
await db.update(orgsTable).set({ features: {} }).where(eq(orgsTable.id, shop.org.id));
check("switched off, nobody is stamped", (await addStamp({ ...o14!, features: {} }, shop.branch, "971500001401", new Date("2026-10-09T12:00:00+04:00"))) === null);

// ── 15. «يُطلب معه» ───────────────────────────────────────────────
const PI = (id: number, cat: number, x: Partial<any> = {}) => ({ id, categoryId: cat, kind: "product", name: `i${id}`, nameEn: null, description: null, descriptionEn: null, price: 10 + id, compareAtPrice: null, durationMin: null, images: [], options: [], tags: [], calories: null, allergens: [], available: true, ...x }) as any;
const menuItems = [PI(1, 1), PI(2, 1), PI(3, 2, { tags: ["popular"] }), PI(4, 2), PI(5, 3, { options: [{ name: "الحجم", required: true, min: 1, max: 1, choices: [] }] }), PI(6, 3, { available: false })];
check("an item with required choices or sold out is never a one-tap suggestion", !oneTap(menuItems[4]) && !oneTap(menuItems[5]) && oneTap(menuItems[0]));
const together = new Map<number, Array<[number, number]>>([[1, [[4, 5], [2, 1], [5, 9]]]]);
const bp = buildPairs(menuItems, together, new Map([[3, 7]]));
check("what customers ordered together comes first (twice or more, one tap only)", bp[1]![0] === 4 && !bp[1]!.includes(5), bp[1]);
check("…then popular items from another section", bp[1]!.includes(3) && bp[1]!.length === 3);
const cold = buildPairs(menuItems, new Map(), new Map())[1] ?? [];
check("a new shop with no orders still gets suggestions, other sections first", cold.length === 3 && cold.slice(0, 2).every((id) => menuItems.find((m: any) => m.id === id)!.categoryId !== 1) && cold[0] === 3, cold);
const spread = buildPairs([PI(1, 1), PI(2, 2, { tags: ["popular"] }), PI(3, 2, { tags: ["popular"] }), PI(4, 3), PI(5, 4)], new Map(), new Map())[1] ?? [];
check("suggestions take one from each other section before a second from any", new Set(spread.map((id) => [0, 1, 2, 2, 3, 4][id])).size === 3, spread);
const pubMenuItems = (await import("../menu/service")).publicMenu;
const pm = await pubMenuItems(o14!, shop.branch);
check("the public menu carries the suggestions", typeof pm.pairs === "object" && Object.keys(pm.pairs).length > 0, Object.keys(pm.pairs).length);
const fu = fold("sidUp", [{ k: "upsell", id: shop.items[1]!.id }], new Set([shop.items[1]!.id]), Date.now());
check("an add from the suggestion counts as an add and as an upsell", fu.get(shop.items[1]!.id)?.adds === 1 && fu.get(shop.items[1]!.id)?.upsells === 1);
await record(o14!, shop.branch.id, fu);
check("…and shows in the menu analytics", (await menuReport(o14!, [shop.branch.id], 7)).funnel.upsells === 1);

// ── 21. The platform in numbers ───────────────────────────────────
check("a yearly price counts monthly", monthly(1200, "yearly") === 100 && monthly(199, "monthly") === 199);
const pmx = await platformMetrics();
check("the funnel runs from signing up to paying, never growing", pmx.funnel.length === 6 && pmx.funnel[0]!.key === "signed" && pmx.funnel.at(-1)!.key === "paying" && pmx.funnel[1]!.n <= pmx.funnel[0]!.n && pmx.funnel[5]!.n <= pmx.funnel[0]!.n, pmx.funnel.map((f) => f.n));
check("monthly revenue is the paying shops' plan prices", pmx.money.paying >= 1 && pmx.money.mrr >= 99 && pmx.money.arr === pmx.money.mrr * 12, pmx.money);
check("six signup months, thirty days of activity", pmx.cohorts.length === 6 && pmx.daily.length === 30);
check("adoption counts the shops that switched each tool on", pmx.adoption.length === 7 && pmx.adoption.every((a) => a.n >= 0));

// ── The plan matrix, the month's messages, the trial ──────────────
const P = (key: string, over: Partial<PlanDef> = {}): PlanDef => ({ key, name: DEFAULT_PLANS[key]!.name, nameEn: null, priceMonthly: DEFAULT_PLANS[key]!.priceMonthly, priceYearly: null, extraBranchPrice: null, contactSales: false, isPublic: true, isActive: true, isFeatured: false, badge: null, badgeEn: null, sort: 0, limits: { ...DEFAULT_PLANS[key]!.limits }, toggles: { ...DEFAULT_PLANS[key]!.toggles }, bullets: [], bulletsEn: [], ...over });
const FREE = P("free"), PRO = P("pro"), TRIAL = P("trial");
let rp = resolvePlan(PRO, FREE, null, false, null);
check("a plan resolves to its own switches and limits", rp.features.coupons && !rp.features.gifts && rp.limits.messagesMonthly === 1500 && rp.planName === "احترافي");
rp = resolvePlan(PRO, FREE, new Date(Date.now() - 1000), false, null);
check("an expired plan becomes the «after» plan, named as expired", rp.expired && !rp.features.notify && rp.limits.messagesMonthly === 0 && /منتهية/.test(rp.planName));
rp = resolvePlan(TRIAL, FREE, new Date(Date.now() + 86_400_000), false, null);
check("a running trial has everything on", rp.trial && rp.features.autopilot && rp.features.gifts && rp.limits.messagesMonthly === 100);
rp = resolvePlan(PRO, FREE, null, false, { branches: 10, items: 5, messagesMonthly: -1 });
check("the admin's overrides only ever widen a limit", rp.limits.branches === 10 && rp.limits.items === -1 && rp.limits.messagesMonthly === -1);
check("an admin is never limited", resolvePlan(FREE, FREE, null, true, null).features.gifts && resolvePlan(FREE, FREE, null, true, null).limits.items === -1);
const bl = bulletsFor(PRO);
check("the home-page bullets are written from the matrix", bl.some((b) => b.includes("1,500 رسالة")) && bl.some((b) => b.includes("حتى 3 فروع")) && !bl.some((b) => b.includes("بطاقات هدايا")));
check("the trial settings are bounded", cleanTrialSettings({ days: 9999, extensionDays: -5, afterPlan: " basic " }, DEFAULT_TRIAL).days === 365 && cleanTrialSettings({ extensionDays: -5 }, DEFAULT_TRIAL).extensionDays === 0 && cleanTrialSettings({ afterPlan: " basic " }, DEFAULT_TRIAL).afterPlan === "basic");
check("message kinds: a turn is operational, a win-back is marketing", kindOf("queue_turn") === "operational" && kindOf("winback") === "marketing" && kindOf("birthday") === "marketing");

// The database matrix: a cell changed there is what the server enforces.
await db.update(subscriptionPlansTable).set({ limits: sql`limits || '{"messagesMonthly": 3}'::jsonb` }).where(eq(subscriptionPlansTable.planKey, "pro"));
invalidatePlans();
await db.update(usersTable).set({ plan: "pro", planExpiresAt: null }).where(eq(usersTable.id, shop.user.id));
check("the server reads the matrix from the database", (await loadPlans()).get("pro")!.limits.messagesMonthly === 3 && (await menuPlan(shop.user.id)).limits.messagesMonthly === 3);
const [orgQ] = await db.select().from(orgsTable).where(eq(orgsTable.id, shop.org.id));
await db.delete(orgUsageTable).where(eq(orgUsageTable.orgId, shop.org.id));
await db.update(orgsTable).set({ messageCredits: 0 }).where(eq(orgsTable.id, shop.org.id));
const takes = [];
for (let i = 0; i < 3; i++) takes.push(await takeMessage(orgQ!, "operational"));
check("three messages fit a quota of three", takes.every((t) => t.ok));
let t4 = await takeMessage(orgQ!, "marketing");
check("the fourth, marketing, waits", !t4.ok && t4.reason === "quota_marketing");
t4 = await takeMessage(orgQ!, "operational");
check("…but a turn gets the grace (a tenth, at least one)", t4.ok);
t4 = await takeMessage(orgQ!, "operational");
check("…and then stops too", !t4.ok && t4.reason === "quota");
await db.update(orgsTable).set({ messageCredits: 2 }).where(eq(orgsTable.id, shop.org.id));
t4 = await takeMessage(orgQ!, "marketing");
check("a credit lets marketing through, one per message", t4.ok && (t4 as any).fromCredit === true && (await db.select().from(orgsTable).where(eq(orgsTable.id, shop.org.id)))[0]!.messageCredits === 1);
const al = await allowance(orgQ!);
check("the dashboard sees used, monthly, credits and what is left", al.monthly === 3 && al.used === 5 && al.credits === 1 && al.remaining === 1 && al.month === monthKey(orgQ!.timezone), al);
await db.update(subscriptionPlansTable).set({ limits: sql`limits - 'messagesMonthly'` }).where(eq(subscriptionPlansTable.planKey, "pro"));
invalidatePlans();
check("removing the cell falls back to the built-in default", (await loadPlans()).get("pro")!.limits.messagesMonthly === 1500);

// The trial.
await db.delete(usersTable).where(eq(usersTable.phone, "971509998866"));
const [tu] = await db.insert(usersTable).values({ phone: "971509998866", passwordHash: "!" }).returning();
check("a new sign-up starts on the trial for the configured days", await startTrial(tu!.id) && (await db.select().from(usersTable).where(eq(usersTable.id, tu!.id)))[0]!.plan === "trial");
const tExp = (await db.select().from(usersTable).where(eq(usersTable.id, tu!.id)))[0]!.planExpiresAt!;
check("…about 30 days from now", Math.abs(tExp.getTime() - Date.now() - DEFAULT_TRIAL.days * 86_400_000) < 120_000);
const ts = DEFAULT_TRIAL;
check("the extension is earned inside the first week with WhatsApp linked and a real menu", earnsExtension({ createdAt: new Date(Date.now() - 3 * 86_400_000), trialExtendedAt: null }, true, 12, ts));
check("…not without WhatsApp, not with a thin menu, not after the week, not twice", !earnsExtension({ createdAt: new Date(Date.now() - 3 * 86_400_000), trialExtendedAt: null }, false, 12, ts) && !earnsExtension({ createdAt: new Date(Date.now() - 3 * 86_400_000), trialExtendedAt: null }, true, 4, ts) && !earnsExtension({ createdAt: new Date(Date.now() - 9 * 86_400_000), trialExtendedAt: null }, true, 12, ts) && !earnsExtension({ createdAt: new Date(Date.now() - 3 * 86_400_000), trialExtendedAt: new Date() }, true, 12, ts));
const torg = await createOrg(tu!.id, { name: "محل تجريبي للاختبار" } as any);
check("a trial shop with no WhatsApp is not extended from the dashboard", (await maybeExtendTrial((await db.select().from(orgsTable).where(eq(orgsTable.id, torg.org.id)))[0]!)) === 0);
await db.delete(orgsTable).where(eq(orgsTable.id, torg.org.id));
await db.delete(usersTable).where(eq(usersTable.id, tu!.id));

await cleanup("g");
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
