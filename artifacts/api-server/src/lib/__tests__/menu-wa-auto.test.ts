// WhatsApp, finished for shops: an order with a typed number is real at once
// and the customer and the shop are both told; ticks land on the notification
// that carries the message; audiences are only ever people who agreed, minus
// those who said stop; a campaign's results become a retarget list; the weekly
// campaign prepares itself, waits for approval, and never starts while the
// number may not send; a scheduled campaign that missed its day is not sent late.

import { and, eq } from "drizzle-orm";
import {
  db, customersTable, notificationsTable, branchesTable, unsubscribedPhonesTable, campaignsTable, messageLogs, incomingMessagesTable,
  contactGroupsTable, contactsTable, waAutopilotTable, waAutopilotRunsTable, usersTable, offersTable,
} from "@workspace/db";
import { createOrder } from "../orders/service";
import { applyReceipt } from "../notify/receipts";
import { cleanAlertPhones } from "../notify/alerts";
import { laneFor } from "../notify/outbox";
import { audience, segmentCounts, toList, retargetPhones } from "../wa-auto/audience";
import { startGate, startCampaignSafely, runScheduledCampaigns } from "../wa-auto/start";
import { isDue, guardMessage, fallbackMessage, cleanAutopilotPatch, getAutopilot, runAutopilot, approveRun, rejectRun, gatherFacts, OPT_OUT_LINE, type Facts } from "../wa-auto/autopilot";
import { cleanup, makeShop } from "./menu-fixtures";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

// ── Pure rules ───────────────────────────────────────────────────
const NOW = new Date("2026-10-01T13:30:00Z"); // Thursday 17:30 in Dubai
const gate = { connected: true, ageHours: 100, minHours: 48, sentToday: 0, dailyLimit: 50, holdUntil: null as Date | null };
check("a campaign may start from a healthy number", startGate(gate, NOW).ok);
check("…not while WhatsApp is unlinked (and it waits)", !startGate({ ...gate, connected: false }, NOW).ok && startGate({ ...gate, connected: false }, NOW).retry === true);
check("…not during the officer's hold", !startGate({ ...gate, holdUntil: new Date(NOW.getTime() + 60_000) }, NOW).ok);
check("…an expired hold does not block", startGate({ ...gate, holdUntil: new Date(NOW.getTime() - 60_000) }, NOW).ok);
check("…not in the number's first 48 hours (and it does not wait)", !startGate({ ...gate, ageHours: 10 }, NOW).ok && !startGate({ ...gate, ageHours: 10 }, NOW).retry);
check("…not past today's allowance", !startGate({ ...gate, sentToday: 50 }, NOW).ok);

const cfg = { enabled: true, weekday: 4, hour: 17, lastRunAt: null as Date | null };
check("the weekly campaign is due on its day at its hour", isDue(cfg, "Asia/Dubai", NOW));
check("…not before the hour", !isDue(cfg, "Asia/Dubai", new Date("2026-10-01T12:30:00Z")));
check("…not on another day", !isDue(cfg, "Asia/Dubai", new Date("2026-10-02T13:30:00Z")));
check("…not late in the evening", !isDue(cfg, "Asia/Dubai", new Date("2026-10-01T17:30:00Z")));
check("…not twice in a week", !isDue({ ...cfg, lastRunAt: new Date(NOW.getTime() - 3_600_000) }, "Asia/Dubai", NOW));
check("…not when switched off", !isDue({ ...cfg, enabled: false }, "Asia/Dubai", NOW));

const facts: Facts = {
  shop: "بيت الشامي", link: "https://example.test/m/bait", offers: [{ title: "خصم 20% على المشاوي", body: "كل خميس" }],
  items: [{ name: "كنافة", price: "18 د.إ", tag: "جديد" }], text: "بيت الشامي خصم 20% على المشاوي كل خميس كنافة 18",
};
let v = guardMessage("أهلاً {الاسم}، خصم 20% على المشاوي هذا الخميس", facts);
check("a message from the shop's own offer passes", v.ok, v.problems);
check("…and gets the menu link and the opt-out line", v.message.includes(facts.link) && v.message.includes(OPT_OUT_LINE));
v = guardMessage("أهلاً {الاسم}، خصم 50% على كل شيء", facts);
check("an invented discount is refused", !v.ok && /50/.test(v.problems.join()), v.problems);
v = guardMessage("آخر فرصة! خصم 20% على المشاوي", facts);
check("manufactured urgency is refused", !v.ok);
check("an empty message is refused", !guardMessage("  ", facts).ok);
const plain = fallbackMessage(facts);
check("the plain message is built from the offer and passes its own guard", plain.includes("خصم 20% على المشاوي") && guardMessage(plain, facts).ok);
check("with no offers it lists the menu", fallbackMessage({ ...facts, offers: [] }).includes("كنافة"));

check("alert phones are cleaned to international digits", JSON.stringify(cleanAlertPhones(["050 123 4567", "abc", "+971 50 123 4567", "00966512345678"])) === JSON.stringify(["971501234567", "966512345678"]), cleanAlertPhones(["050 123 4567", "abc", "+971 50 123 4567", "00966512345678"]));
check("…at most five", cleanAlertPhones(Array.from({ length: 9 }, (_, i) => `05012345${10 + i}`)).length === 5);
const patch = cleanAutopilotPatch({ enabled: true, weekday: 9, hour: 3, audience: "everyone", mode: "auto", maxRecipients: 99999, restDays: 0, fixedMessage: " مرحبا " });
check("autopilot settings are bounded", patch.enabled === true && patch.weekday === undefined && patch.hour === undefined && patch.audience === undefined && patch.mode === "auto" && patch.maxRecipients === 1500 && patch.restDays === 3 && patch.fixedMessage === "مرحبا", patch);
check("a typed number travels the consented lane; a stranger travels none", laneFor(null, true) === "consented" && laneFor(null, false) === null && laneFor(new Date(), false) === "replied");

// ── Against the tables ───────────────────────────────────────────
await cleanup("w");
const shop = await makeShop("w");
const uid = shop.branch.waUserId;
const DAY = 24 * 3_600_000;

// An order with a typed number: real at once, customer and shop both told.
await db.update(branchesTable).set({ alertPhones: ["971509990001"] }).where(eq(branchesTable.id, shop.branch.id));
const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, shop.branch.id));
const o = await createOrder(shop.org, branch!, { type: "pickup", customerName: "سارة", phone: "0501112233", lines: [{ itemId: shop.items[1]!.id, qty: 2 }] });
check("an order with a typed number is received at once", o.status === "received" && o.phone === "971501112233", o.status);
let notes = await db.select().from(notificationsTable).where(eq(notificationsTable.orgId, shop.org.id));
const conf = notes.find((x) => x.kind === "order_received");
check("…the customer's confirmation is queued on the consented lane", conf?.status === "queued" && conf.class === "consented" && conf.phone === "971501112233", conf?.status);
const alert = notes.find((x) => x.kind === "alert_order");
check("…and the shop's own phone is alerted, on the staff lane", alert?.status === "queued" && alert.class === "staff" && alert.phone === "971509990001" && alert.text.includes(o.code), alert?.class);
const o2 = await createOrder(shop.org, branch!, { type: "pickup", customerName: "بدون رقم", lines: [{ itemId: shop.items[1]!.id, qty: 1 }] });
check("an order with no number still waits for its WhatsApp message", o2.status === "pending");

// Ticks.
await db.update(notificationsTable).set({ status: "sent", sentAt: new Date(), waMessageId: `TEST-W-${o.id}` }).where(eq(notificationsTable.id, conf!.id));
await applyReceipt(`TEST-W-${o.id}`, 3);
let [n1] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, conf!.id));
check("a delivery tick lands on the notification", !!n1!.deliveredAt && !n1!.readAt);
await applyReceipt(`TEST-W-${o.id}`, 4);
[n1] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, conf!.id));
check("…and so does the read tick", !!n1!.readAt);
await applyReceipt("TEST-W-unknown", 4);
check("a tick for a message we did not send changes nothing", true);

// Audiences.
const ago = (d: number) => new Date(Date.now() - d * DAY);
await db.delete(customersTable).where(eq(customersTable.orgId, shop.org.id));
await db.insert(customersTable).values([
  { orgId: shop.org.id, phone: "971500000101", name: "دائم", marketingOptIn: true, visits: 2, ordersCount: 2, firstSeenAt: ago(90), lastSeenAt: ago(2) },
  { orgId: shop.org.id, phone: "971500000102", name: "غائب", marketingOptIn: true, visits: 1, firstSeenAt: ago(80), lastSeenAt: ago(45) },
  { orgId: shop.org.id, phone: "971500000103", name: "جديد", marketingOptIn: true, visits: 1, firstSeenAt: ago(3), lastSeenAt: ago(3) },
  { orgId: shop.org.id, phone: "971500000104", name: "لم يوافق", marketingOptIn: false, visits: 9, firstSeenAt: ago(90), lastSeenAt: ago(1) },
  { orgId: shop.org.id, phone: "971500000105", name: "قال توقف", marketingOptIn: true, visits: 4, firstSeenAt: ago(90), lastSeenAt: ago(1) },
]);
await db.insert(unsubscribedPhonesTable).values({ userId: uid, phone: "971500000105" }).onConflictDoNothing();
const counts = await segmentCounts(shop.org.id);
check("segments count only those who agreed", counts.opted_in === 4 && counts.regulars === 2 && counts.inactive === 1 && counts.new === 1, counts);
let people = await audience(shop.org, uid, "opted_in");
check("an audience leaves out who did not agree and who said stop", people.length === 3 && !people.some((p) => ["971500000104", "971500000105"].includes(p.phone)), people.map((p) => p.name));
check("the inactive segment is who stopped coming", (await audience(shop.org, uid, "inactive")).map((p) => p.name).join() === "غائب");
const l1 = await toList(uid, "اختبار شريحة", "x", people);
const l2 = await toList(uid, "اختبار شريحة", "x", people);
check("a segment becomes one contact list, topped up not duplicated", !!l1.groupId && l1.added === 3 && l2.groupId === l1.groupId && l2.added === 0, [l1, l2]);

// Retargeting from a campaign's results.
const [camp] = await db.insert(campaignsTable).values({ userId: uid, name: "حملة اختبار", status: "completed", message: "x", contactGroupId: l1.groupId, sentCount: 4 }).returning();
const sentAt = new Date(Date.now() - 3_600_000);
await db.insert(messageLogs).values([
  { campaignId: camp!.id, phone: "971500000101", status: "sent", sentAt, deliveredAt: sentAt },
  { campaignId: camp!.id, phone: "971500000102", status: "sent", sentAt, deliveredAt: sentAt, readAt: sentAt },
  { campaignId: camp!.id, phone: "971500000103", status: "sent", sentAt, deliveredAt: sentAt, readAt: sentAt },
  { campaignId: camp!.id, phone: "971500000106", status: "sent", sentAt },
  { campaignId: camp!.id, phone: "971500000107", status: "failed" },
]);
await db.insert(incomingMessagesTable).values({ userId: uid, phone: "971500000102", text: "كم السعر؟", messageId: `TEST-W-IN-${camp!.id}` });
const rt = async (who: "unread" | "read_no_reply" | "undelivered") => ((await retargetPhones(uid, camp!.id, who)) ?? []).map((p) => p.phone).join();
check("retarget: delivered but not opened", (await rt("unread")) === "971500000101", await rt("unread"));
check("retarget: opened and did not reply", (await rt("read_no_reply")) === "971500000103", await rt("read_no_reply"));
check("retarget: never delivered (failed sends are not chased)", (await rt("undelivered")) === "971500000106", await rt("undelivered"));
check("retarget: names come from the campaign's list", (await retargetPhones(uid, camp!.id, "unread"))![0]!.name === "دائم");
check("another account's campaign is not reachable", (await retargetPhones(uid + 999_999, camp!.id, "unread")) === null);
people = await audience(shop.org, uid, "opted_in", { restDays: 6 });
check("rest days leave out whoever a campaign reached this week", people.length === 0, people.length);

// The weekly campaign.
await db.delete(messageLogs).where(eq(messageLogs.campaignId, camp!.id));
await db.insert(offersTable).values({ orgId: shop.org.id, title: "خصم 20% على البرجر", body: "كل خميس", isActive: true });
const f2 = await gatherFacts(shop.org, branch!);
check("the facts carry the shop's offers, items and menu link", f2.offers[0]?.title === "خصم 20% على البرجر" && f2.items.length > 0 && f2.link.includes(shop.org.slug), f2.link);
await getAutopilot(shop.org, uid);
await db.update(waAutopilotTable).set({ source: "fixed", fixedMessage: "أهلاً {الاسم} 👋 خصم 20% على البرجر كل خميس", mode: "auto" }).where(eq(waAutopilotTable.waUserId, uid));
let run = await runAutopilot(uid, { manual: true });
check("«جهّز حملة الآن» prepares a campaign that waits for approval", run?.status === "awaiting_approval" && run.recipients === 3 && !!run.campaignId && run.writtenBy === "owner", run?.status);
check("…its message carries the link and the opt-out line", !!run?.message?.includes(f2.link) && !!run?.message?.includes(OPT_OUT_LINE));
let [draft] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, run!.campaignId!));
check("…as a draft in the campaign engine, on its own list", draft?.status === "draft" && draft.contactGroupId === run!.groupId);
const listed = await db.select().from(contactsTable).where(eq(contactsTable.groupId, run!.groupId!));
check("…of exactly the people who agreed", listed.length === 3 && !listed.some((c) => c.phone.includes("0104") || c.phone.includes("0105")), listed.length);
const again = await runAutopilot(uid, { manual: true });
check("a second press returns the one already waiting", again?.id === run!.id);
const ap = await approveRun(uid, run!.id, "أهلاً {الاسم}، خصم 20% على البرجر اليوم");
check("approving while WhatsApp is unlinked does not start it", !ap.ok && /واتساب/.test(ap.reason ?? ""), ap.reason);
[draft] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, run!.campaignId!));
check("…the campaign stays a draft, with the owner's edit kept", draft?.status === "draft" && draft.message.includes("اليوم") && draft.message.includes(OPT_OUT_LINE));
check("…and the same gate holds for a direct start", !(await startCampaignSafely(uid, run!.campaignId!)).ok);
check("rejecting removes the draft and its list", (await rejectRun(uid, run!.id)) === true
  && (await db.select().from(campaignsTable).where(eq(campaignsTable.id, run!.campaignId!))).length === 0
  && (await db.select().from(contactGroupsTable).where(eq(contactGroupsTable.id, run!.groupId!))).length === 0);
check("…and it cannot be rejected twice", (await rejectRun(uid, run!.id)) === false);

// The clock's own run: auto mode, but the number cannot send → waits, and the shop is told.
run = await runAutopilot(uid, { now: NOW });
const [after] = await db.select().from(waAutopilotRunsTable).where(eq(waAutopilotRunsTable.id, run!.id));
check("in auto mode a campaign that cannot start waits for the owner", after?.status === "awaiting_approval" && /لم تبدأ/.test(after.note ?? ""), after?.note);
const [cfgRow] = await db.select().from(waAutopilotTable).where(eq(waAutopilotTable.waUserId, uid));
check("…the week is marked as run", cfgRow?.lastRunAt?.getTime() === NOW.getTime());
notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "alert_campaign")));
check("…and the owner's phone hears about it", notes.length === 1 && notes[0]!.class === "staff");
const skipped = await runAutopilot(uid, { now: NOW });
check("next week's does not pile onto one still waiting", skipped?.status === "skipped" && /بانتظار/.test(skipped.note ?? ""), skipped?.note);
await rejectRun(uid, run!.id);

await db.update(usersTable).set({ plan: "basic" }).where(eq(usersTable.id, shop.user.id));
const noPlan = await runAutopilot(uid, { manual: true });
check("a plan without campaigns prepares nothing", noPlan?.status === "skipped" && /خطة/.test(noPlan.note ?? ""), noPlan?.note);
await db.update(usersTable).set({ plan: "pro" }).where(eq(usersTable.id, shop.user.id));
await db.update(customersTable).set({ marketingOptIn: false }).where(and(eq(customersTable.orgId, shop.org.id), eq(customersTable.phone, "971500000101")));
const few = await runAutopilot(uid, { manual: true });
check("fewer than three people: no campaign", few?.status === "skipped" && few.recipients === 2, few?.note);

// Scheduled campaigns.
const [late] = await db.insert(campaignsTable).values({ userId: uid, name: "متأخرة", status: "draft", message: "x", contactGroupId: l1.groupId, scheduledAt: ago(2) }).returning();
const [due] = await db.insert(campaignsTable).values({ userId: uid, name: "حان وقتها", status: "draft", message: "x", contactGroupId: l1.groupId, scheduledAt: new Date(Date.now() - 60_000) }).returning();
const started = await runScheduledCampaigns(new Date(), uid);
const [late2] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, late!.id));
const [due2] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, due!.id));
check("a campaign that missed its day is not sent late", started === 0 && late2?.status === "draft" && late2.scheduledAt === null && /فات موعد/.test(late2.autoPauseReason ?? ""), late2?.autoPauseReason);
check("a due campaign waits for WhatsApp rather than being dropped", due2?.status === "draft" && !!due2.scheduledAt);

await db.delete(incomingMessagesTable).where(eq(incomingMessagesTable.messageId, `TEST-W-IN-${camp!.id}`));
await cleanup("w");
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
