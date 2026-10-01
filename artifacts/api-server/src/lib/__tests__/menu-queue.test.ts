// The queue against the real tables: numbers handed out under concurrent
// joins, «التالي» pressed by two staff at once, the wait and position moving,
// the device that taps twice, a paused and a full queue, and the WhatsApp
// side — a join code arriving, «كم قدامي», «إلغاء الدور», and the "your turn"
// that goes out (or is dropped as stale).

import { and, eq, inArray } from "drizzle-orm";
import { db, queueTicketsTable, notificationsTable, queuesTable, customersTable } from "@workspace/db";
import { queueCtx, join, callNext, transition, ticketView, staffView, snapshot, setQueueState, adjustEta, QueueError, sweep } from "../queue/engine";
import { handleCustomerMessage } from "../notify/inbound";
import { isClaimed, claimInbound } from "../inbound-claims";
import { cleanup, makeShop } from "./menu-fixtures";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

await cleanup("q");
const shop = await makeShop("q");
const ctx = (await queueCtx(shop.queue.id))!;

// ── Numbers under concurrent joins ───────────────────────────────
const joined = await Promise.all(Array.from({ length: 20 }, (_, i) => join(ctx, { name: `زبون ${i + 1}`, partySize: 2, deviceId: `dev-${i}` })));
const numbers = joined.map((t) => t.number).sort((a, b) => a - b);
check("20 concurrent joins get 20 different numbers", new Set(numbers).size === 20 && numbers[0] === 1 && numbers[19] === 20, numbers.join(","));
check("display codes carry the prefix", joined.every((t) => t.displayCode === `A-${t.number}`));
check("every ticket has its own unguessable token", new Set(joined.map((t) => t.token)).size === 20 && joined.every((t) => t.token.length >= 20));
check("join codes are unique too", new Set(joined.map((t) => t.joinCode)).size === 20);

const again = await join(ctx, { name: "زبون 1", deviceId: "dev-0" });
check("the same device tapping again gets its own ticket back", again.id === joined.find((t) => t.deviceId === "dev-0")!.id);

// ── Positions ────────────────────────────────────────────────────
const last = joined.find((t) => t.number === 20)!;
let v = (await ticketView(last))!;
check("number 20 has 19 ahead", v.ahead === 19, v.ahead);
check("…and a real wait", !v.eta.soon && v.eta.high > v.eta.low, v.eta);
check("the public view carries no phone and no other names", !JSON.stringify(v).includes("زبون 2") && !("phone" in v));

// ── Two staff press «التالي» together, twenty times ──────────────
const calls = await Promise.all(Array.from({ length: 20 }, (_, i) => callNext(ctx, i % 2 ? 101 : 102)));
const calledIds = calls.filter(Boolean).map((t) => t!.id);
check("20 presses call 20 different people", new Set(calledIds).size === 20, calledIds.length);
check("a 21st press calls nobody", (await callNext(ctx, 101)) === null);
const s = await snapshot(ctx);
check("nobody is left waiting", s.waiting.length === 0 && s.called.length === 20);

// ── Transitions ──────────────────────────────────────────────────
const one = calls[0]!;
let t = await transition(ctx, one.id, "recall", 101);
check("a recall counts", t.recallCount === 1);
await transition(ctx, one.id, "recall", 101);
let refused = false;
try { await transition(ctx, one.id, "recall", 101); } catch (e) { refused = e instanceof QueueError; }
check("a third recall is refused", refused);
t = await transition(ctx, one.id, "arrived", 101, { finish: true });
check("arrived + finish is done", t.status === "done" && !!t.finishedAt);
const two = calls[1]!;
t = await transition(ctx, two.id, "no_show", 101);
check("no-show", t.status === "no_show");
t = await transition(ctx, two.id, "requeue", 101);
check("a no-show put back waits again, at the front", t.status === "waiting" && t.priority === 1);
const fresh = await join(ctx, { name: "متأخر", deviceId: "dev-late" });
const ahead = (await ticketView(fresh))!.ahead;
check("the requeued guest is ahead of a new joiner", ahead === 1, ahead);

// ── Pause, full, ETA adjust ──────────────────────────────────────
await setQueueState(ctx, "pause", 101);
let msg = "";
try { await join((await queueCtx(ctx.queue.id))!, { name: "x", deviceId: "dev-p" }); } catch (e) { msg = (e as Error).message; }
check("a paused queue refuses new joins", msg.includes("متوقف"), msg);
const walk = await join((await queueCtx(ctx.queue.id))!, { name: "", source: "staff" });
check("…but staff can still add a walk-in", walk.source === "staff");
await setQueueState((await queueCtx(ctx.queue.id))!, "resume", 101);
await db.update(queuesTable).set({ maxWaiting: 3 }).where(eq(queuesTable.id, ctx.queue.id));
msg = "";
try { await join((await queueCtx(ctx.queue.id))!, { name: "y", deviceId: "dev-full" }); } catch (e) { msg = (e as Error).message; }
check("a full queue says so", msg.includes("ممتلئ"), msg);
await db.update(queuesTable).set({ maxWaiting: 150 }).where(eq(queuesTable.id, ctx.queue.id));
const before = (await ticketView(fresh))!.eta.expected;
await adjustEta((await queueCtx(ctx.queue.id))!, 15, 101);
const after = (await ticketView(fresh))!.eta.expected;
check("+15 from the staff moves the customer's wait", after - before === 15, { before, after });
await adjustEta((await queueCtx(ctx.queue.id))!, null, 101);

const sv = await staffView((await queueCtx(ctx.queue.id))!);
check("the staff view counts what happened today", sv.counts.served >= 1 && sv.counts.noShows === 0 && sv.counts.waiting === 3, sv.counts);

// ── WhatsApp: a code arrives ─────────────────────────────────────
const c2 = (await queueCtx(ctx.queue.id))!;
const wa = await join(c2, { name: "سارة", deviceId: "dev-wa" });
const phone = "971500001111";
const handled = await handleCustomerMessage(shop.branch.waUserId, phone, `انضمام للصف ${wa.displayCode}\nرمز ${wa.joinCode}`);
const [linked] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, wa.id));
check("the join message is ours", handled);
check("…and links the sender's number to the ticket", linked!.phone === phone && linked!.phoneVerified);
let notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.refType, "ticket"), eq(notificationsTable.refId, wa.id)));
check("…and queues the confirmation as a reply", notes.length === 1 && notes[0]!.kind === "queue_joined" && notes[0]!.class === "replied" && notes[0]!.status === "queued", notes.map((n) => [n.kind, n.class, n.status]));
check("…which names the number and the wait", notes[0]!.text.includes(wa.displayCode) && notes[0]!.text.includes("/t/"));
const [cust] = await db.select().from(customersTable).where(and(eq(customersTable.orgId, shop.org.id), eq(customersTable.phone, phone)));
check("the customer is on the shop's list, with the thread open", !!cust?.lastInboundAt && cust.name === "سارة");

check("«كم قدامي» from that number is answered", await handleCustomerMessage(shop.branch.waUserId, phone, "كم قدامي؟"));
notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.orgId, shop.org.id), eq(notificationsTable.kind, "status_reply")));
check("…with the position", notes.length === 1 && notes[0]!.text.includes(wa.displayCode));
check("ordinary chat is left to the agent", !(await handleCustomerMessage(shop.branch.waUserId, phone, "عندكم توصيل للعين؟")));
check("a code nobody holds is left to the agent", !(await handleCustomerMessage(shop.branch.waUserId, phone, "رمز ZZZZ")));
check("another org's number does not see this ticket", !(await handleCustomerMessage(999_999, phone, `رمز ${wa.joinCode}`)));

// ── The turn ─────────────────────────────────────────────────────
// Call everyone ahead, then her.
let called = null as Awaited<ReturnType<typeof callNext>>;
for (let i = 0; i < 10 && called?.id !== wa.id; i++) called = await callNext((await queueCtx(ctx.queue.id))!, 101);
check("her turn comes", called?.id === wa.id);
notes = await db.select().from(notificationsTable).where(and(eq(notificationsTable.refType, "ticket"), eq(notificationsTable.refId, wa.id), eq(notificationsTable.kind, "queue_turn")));
check("«جاء دورك» is queued with a two-minute shelf life", notes.length === 1 && !!notes[0]!.expiresAt && notes[0]!.expiresAt.getTime() - notes[0]!.scheduledAt.getTime() === 120_000);
check("the page shows called", (await ticketView((await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, wa.id)))[0]!))!.status === "called");

// «إلغاء الدور» on a fresh ticket
const c3 = (await queueCtx(ctx.queue.id))!;
const leaver = await join(c3, { name: "منسحب", deviceId: "dev-leave" });
await handleCustomerMessage(shop.branch.waUserId, "971500002222", `رمز ${leaver.joinCode}`);
check("«إلغاء الدور» takes them out", await handleCustomerMessage(shop.branch.waUserId, "971500002222", "إلغاء الدور"));
const [gone] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, leaver.id));
check("…status left", gone!.status === "left");

// ── Claims ───────────────────────────────────────────────────────
claimInbound(5, "9715", "رمز X", Promise.resolve(true));
check("a claimed message is seen as claimed", await isClaimed(5, "9715", "رمز X"));
claimInbound(5, "9715", "رمز Y", Promise.resolve(false));
check("a released claim is not", !(await isClaimed(5, "9715", "رمز Y")) && !(await isClaimed(5, "9715", "مرحبا")));

// ── Sweeper ──────────────────────────────────────────────────────
await db.update(queuesTable).set({ autoNoShow: true, noShowMin: 1 }).where(eq(queuesTable.id, ctx.queue.id));
await db.update(queueTicketsTable).set({ calledAt: new Date(Date.now() - 5 * 60_000) }).where(eq(queueTicketsTable.id, wa.id));
const swept = await sweep();
const [ns] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, wa.id));
check("auto no-show after the grace", ns!.status === "no_show" && swept.noShows >= 1, swept);
await db.update(queueTicketsTable).set({ serviceDay: "2020-01-01", status: "waiting" }).where(eq(queueTicketsTable.id, fresh.id));
await sweep();
const [old] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, fresh.id));
check("a ticket from an earlier day is closed", old!.status === "left");

// ── Retention ────────────────────────────────────────────────────
const { forgetOldPhones } = await import("../queue/engine");
const { touchCustomer } = await import("../customers");
const c4 = (await queueCtx(ctx.queue.id))!;
const oldA = await join(c4, { name: "قديم", phone: "971500005555", source: "staff" });
const oldB = await join(c4, { name: "موافق", phone: "971500006666", source: "staff", marketingOptIn: true });
await touchCustomer(shop.org.id, "971500006666", { optIn: true });
await db.update(queueTicketsTable).set({ joinedAt: new Date(Date.now() - 40 * 24 * 3_600_000) }).where(inArray(queueTicketsTable.id, [oldA.id, oldB.id]));
await forgetOldPhones(new Date(), true);
const [ra] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, oldA.id));
const [rb] = await db.select().from(queueTicketsTable).where(eq(queueTicketsTable.id, oldB.id));
check("a ticket's phone is dropped after 30 days", ra!.phone === null);
check("…unless the customer agreed to hear from the shop", rb!.phone === "971500006666");

await cleanup("q");
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
