// Orders and bookings against the real tables: the server's price wins over
// whatever the browser sends, a sold-out item cannot be ordered, the order
// becomes real when its WhatsApp message arrives, two people racing for the
// last booking slot get one booking, a booked guest checks in at the front of
// the queue, and the menu becomes the agent's knowledge.

import { and, eq } from "drizzle-orm";
import { db, ordersTable, notificationsTable, branchItemOverridesTable, knowledgeBaseTable, menuItemsTable, bookingSettingsTable } from "@workspace/db";
import { zonedToUtc, localDate, addDays } from "@workspace/menu-shared";
import { createOrder, setOrderStatus, orderView } from "../orders/service";
import { createBooking, slotsFor, setBookingStatus, checkIn } from "../booking/service";
import { publicMenu } from "../menu/service";
import { handleCustomerMessage } from "../notify/inbound";
import { rebuild } from "../menu/knowledge-sync";
import { ticketView } from "../queue/engine";
import { parseSheet } from "../menu/import";
import { cleanup, makeShop } from "./menu-fixtures";
import * as XLSX from "xlsx";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

await cleanup("o");
const shop = await makeShop("o");
const [burger, kunafa] = shop.items;

// ── Orders ───────────────────────────────────────────────────────
const o = await createOrder(shop.org, shop.branch, {
  type: "dine_in", tableLabel: "5", customerName: "خالد",
  lines: [
    { itemId: burger!.id, qty: 2, selections: [{ group: "الحجم", choices: ["دبل"] }], ...({ unitPrice: 1, lineTotal: 1 } as any) },
    { itemId: kunafa!.id, qty: 1, note: "بدون سكر زيادة" },
  ],
});
check("the order is priced by the server", Number(o.subtotal) === 2 * 42 + 18, o.subtotal);
check("it starts pending until WhatsApp confirms it", o.status === "pending" && !o.phoneVerified);
const view = (await orderView(o))!;
check("the WhatsApp link carries the order and its code", !!view.waLink && decodeURIComponent(view.waLink).includes(`#${o.code}`) && decodeURIComponent(view.waLink).includes("طاولة 5"));

await db.insert(branchItemOverridesTable).values({ branchId: shop.branch.id, itemId: kunafa!.id, isAvailable: false });
let err = "";
try { await createOrder(shop.org, shop.branch, { lines: [{ itemId: kunafa!.id, qty: 1 }] }); } catch (e) { err = (e as Error).message; }
check("a sold-out item cannot be ordered", err.includes("غير متوفر"), err);
const menu = await publicMenu(shop.org, shop.branch);
check("…and shows as unavailable on the menu", menu.items.find((i) => i.id === kunafa!.id)?.available === false);
await db.delete(branchItemOverridesTable).where(eq(branchItemOverridesTable.itemId, kunafa!.id));

err = "";
try { await createOrder(shop.org, shop.branch, { type: "delivery", lines: [{ itemId: kunafa!.id, qty: 1 }] }); } catch (e) { err = (e as Error).message; }
check("delivery needs an address", err.includes("عنوان"), err);
err = "";
try { await createOrder(shop.org, shop.branch, { type: "preorder", lines: [{ itemId: kunafa!.id, qty: 1 }] }); } catch (e) { err = (e as Error).message; }
check("a pre-order needs a pickup time", err.includes("موعد"));
const pre = await createOrder(shop.org, shop.branch, { type: "preorder", scheduledFor: new Date(Date.now() + 2 * 24 * 3_600_000).toISOString(), lines: [{ itemId: kunafa!.id, qty: 3 }] });
check("a tray for Thursday is an order with a time", !!pre.scheduledFor && Number(pre.subtotal) === 54);

const phone = "971500003333";
check("the order message arriving is ours", await handleCustomerMessage(shop.branch.waUserId, phone, `🧾 طلب جديد #${o.code}\n...`));
const [confirmed] = await db.select().from(ordersTable).where(eq(ordersTable.id, o.id));
check("…it is now received, with the customer's number", confirmed!.status === "received" && confirmed!.phone === phone && confirmed!.phoneVerified);
let notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.refType, "order"), eq(notificationsTable.refId, o.id)));
check("…and the receipt is queued as a reply", notes.length === 1 && notes[0]!.kind === "order_received" && notes[0]!.class === "replied");
await setOrderStatus(shop.org.id, [shop.branch.id], o.id, "ready");
notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.refType, "order"), eq(notificationsTable.refId, o.id)));
check("«جاهز» tells the customer", notes.some((n) => n.kind === "order_ready"));
err = "";
try { await setOrderStatus(shop.org.id + 999, [shop.branch.id], o.id, "completed"); } catch (e) { err = (e as Error).message; }
check("another org cannot touch the order", err.includes("غير موجود"));

// ── Bookings ─────────────────────────────────────────────────────
const tz = shop.org.timezone;
const day = addDays(localDate(tz), 2);
await db.update((await import("@workspace/db")).branchesTable).set({ hours: { ["0"]: { open: "10:00", close: "14:00" }, ["1"]: { open: "10:00", close: "14:00" }, ["2"]: { open: "10:00", close: "14:00" }, ["3"]: { open: "10:00", close: "14:00" }, ["4"]: { open: "10:00", close: "14:00" }, ["5"]: { open: "10:00", close: "14:00" }, ["6"]: { open: "10:00", close: "14:00" } } })
  .where(eq((await import("@workspace/db")).branchesTable.id, shop.branch.id));
const branch = (await db.select().from((await import("@workspace/db")).branchesTable).where(eq((await import("@workspace/db")).branchesTable.id, shop.branch.id)))[0]!;
let slots = await slotsFor(shop.org, branch, day, { partySize: 2 });
check("four slots on an open day", slots.length === 4, slots.length);
const at = zonedToUtc(tz, day, "11:00").toISOString();
const race = await Promise.allSettled([
  createBooking(shop.org, branch, { startsAt: at, customerName: "أ", partySize: 2 }),
  createBooking(shop.org, branch, { startsAt: at, customerName: "ب", partySize: 2 }),
]);
const won = race.filter((r) => r.status === "fulfilled");
check("two people racing for the last place: one booking", won.length === 1, race.map((r) => r.status));
check("…the other is told it just went", race.some((r) => r.status === "rejected" && String((r as PromiseRejectedResult).reason?.message).includes("الموعد")));
slots = await slotsFor(shop.org, branch, day, { partySize: 2 });
check("…and the slot is no longer offered", slots.length === 3 && !slots.some((s) => s.start === at));
err = "";
try { await createBooking(shop.org, branch, { startsAt: zonedToUtc(tz, day, "11:20").toISOString(), customerName: "ج" }); } catch (e) { err = (e as Error).message; }
check("a time the page never offered is refused", err.includes("الموعد"), err);
err = "";
try { await createBooking(shop.org, branch, { startsAt: zonedToUtc(tz, day, "12:00").toISOString(), customerName: "د", partySize: 40 }); } catch (e) { err = (e as Error).message; }
check("a party above the maximum is refused", err.includes("أقصى"), err);

const bk = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createBooking>>>).value;
check("the booking confirmation code is ours", await handleCustomerMessage(branch.waUserId, "971500004444", `تأكيد حجز\nرمز ${bk.code}`));
notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.refType, "booking"), eq(notificationsTable.refId, bk.id)));
check("…and confirms the booking on WhatsApp", notes.some((n) => n.kind === "booking_confirmed"));
const ticket = await checkIn((await db.select().from((await import("@workspace/db")).bookingsTable).where(eq((await import("@workspace/db")).bookingsTable.id, bk.id)))[0]!, null);
check("a booked guest checks in at the front of the queue", !!ticket && ticket.priority === 5 && ticket.source === "booking");
check("…with nobody ahead", (await ticketView(ticket!))!.ahead === 0);
const cancelled = await setBookingStatus(bk, "cancelled", { byCustomer: false });
check("staff can cancel", cancelled.status === "cancelled");

await db.update(bookingSettingsTable).set({ enabled: false }).where(eq(bookingSettingsTable.branchId, branch.id));
check("bookings off: no slots", (await slotsFor(shop.org, branch, day)).length === 0);

// ── The menu is the knowledge ────────────────────────────────────
const n = await rebuild(shop.org.id);
let kb = await db.select().from(knowledgeBaseTable).where(and(eq(knowledgeBaseTable.userId, shop.org.ownerUserId), eq(knowledgeBaseTable.category, "menu")));
check("knowledge entries are written for the menu", n === kb.length && kb.length >= 5, kb.length);
check("the kunafa entry carries its price", kb.some((k) => k.title.includes("كنافة") && k.content.includes("18 د.إ")));
await db.update(menuItemsTable).set({ price: "21.00" }).where(eq(menuItemsTable.id, kunafa!.id));
await rebuild(shop.org.id);
kb = await db.select().from(knowledgeBaseTable).where(and(eq(knowledgeBaseTable.userId, shop.org.ownerUserId), eq(knowledgeBaseTable.category, "menu")));
check("a price change replaces the entry, not adds one", kb.filter((k) => k.title.includes("كنافة")).length === 1 && kb.some((k) => k.content.includes("21 د.إ")));
await db.insert(knowledgeBaseTable).values({ userId: shop.org.ownerUserId, title: "سياسة الاسترجاع", content: "لا يوجد استرجاع", category: "policy" });
await rebuild(shop.org.id);
const hand = await db.select().from(knowledgeBaseTable).where(and(eq(knowledgeBaseTable.userId, shop.org.ownerUserId), eq(knowledgeBaseTable.category, "policy")));
check("what the owner wrote by hand is left alone", hand.length === 1);
const { retrieve } = await import("../knowledge");
const hits = await retrieve(shop.org.ownerUserId, "بكم الكنافة؟");
check("«بكم الكنافة؟» finds the kunafa entry first", hits[0]?.entry.title.includes("كنافة") ?? false, hits.map((h) => h.entry.title));
const hits2 = await retrieve(shop.org.ownerUserId, "كم سعر كنافة");
check("…and so does «كم سعر كنافة» without ال", hits2[0]?.entry.title.includes("كنافة") ?? false, hits2.map((h) => h.entry.title));
const none = await retrieve(shop.org.ownerUserId, "عندكم سوشي؟");
check("a dish not on the menu finds nothing to invent from", !none.some((h) => h.entry.title.startsWith("طبق")), none.map((h) => h.entry.title));

// ── Spreadsheet import ───────────────────────────────────────────
const ws = XLSX.utils.aoa_to_sheet([["قائمة الأسعار"], ["الصنف", "السعر", "القسم", "English"], ["شاورما", "15 درهم", "ساندويتشات", "Shawarma"], ["فلافل", "٨", "ساندويتشات", ""], ["بدون سعر", "", "x", ""]]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const parsed = parseSheet(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
check("a sheet with a title row is read by its headers", parsed.rows.length === 2 && parsed.rows[0]!.price === 15 && parsed.rows[0]!.nameEn === "Shawarma", parsed.rows);
check("Arabic-Indic prices are read", parsed.rows[1]!.price === 8);
check("a row without a price is reported, not guessed", parsed.skipped.length === 1);

await cleanup("o");
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
