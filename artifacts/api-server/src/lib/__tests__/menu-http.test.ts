// The API over HTTP, as a browser would use it: two owners each make a shop,
// and every new route is tried with the other shop's ids and must not reach
// them; a member of staff signs in and reaches the queue but not the
// campaigns, the WhatsApp link or the owner's settings; the public pages work
// with no session at all and carry no phone numbers.

import type { AddressInfo } from "node:net";
import { eq, like, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { cleanup } from "./menu-fixtures";

process.env["OPEN_REGISTRATION"] = "true";
const { default: app } = await import("../../app");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const r = await fetch(base + path, {
      method, redirect: "manual",
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const kv = c.split(";")[0]!;
      const name = kv.split("=")[0];
      this.cookie = [...this.cookie.split("; ").filter((x) => x && !x.startsWith(`${name}=`)), kv].join("; ");
    }
    let json: any = null;
    const text = await r.text();
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  }
  get(p: string) { return this.req("GET", p); }
  post(p: string, b?: unknown) { return this.req("POST", p, b ?? {}); }
  patch(p: string, b?: unknown) { return this.req("PATCH", p, b ?? {}); }
  del(p: string) { return this.req("DELETE", p); }
}

await cleanup("7");
const tag = String(Date.now()).slice(-6);
async function owner(n: string) {
  const c = new Client();
  const phone = `999007${n === "a" ? 1 : 2}${tag}`;
  const r = await c.post("/api/auth/register", { phone, password: "secret123", displayName: `owner ${n}` });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.json)}`);
  await db.update(usersTable).set({ plan: "business" }).where(eq(usersTable.phone, phone));
  return c;
}
const A = await owner("a");
const B = await owner("b");
{
  // A sign-up with no invite starts on the trial.
  const T = new Client();
  const tr = await T.post("/api/auth/register", { phone: `9990074${tag}`, password: "secret123", displayName: "trial" });
  const trow = (await db.select().from(usersTable).where(eq(usersTable.phone, `9990074${tag}`)))[0];
  check("a shop that signs up by itself starts on the trial", tr.status === 201 && trow?.plan === "trial" && !!trow.planExpiresAt, trow?.plan);
  await db.delete(usersTable).where(eq(usersTable.phone, `9990074${tag}`));
}

let r = await A.get("/api/tenancy/me");
check("a new owner is asked to make their shop", r.json?.needsOnboarding === true, r.json);
r = await A.post("/api/onboarding/org", { name: "مطعم أ", nameEn: "Alpha", vertical: "restaurant", slug: `alpha-${tag}` });
check("owner A makes a shop", r.status === 201 && r.json.org.slug === `alpha-${tag}`, r.status);
r = await B.post("/api/onboarding/org", { name: "صالون ب", nameEn: "Beta", vertical: "beauty", slug: `beta-${tag}` });
check("owner B makes a shop", r.status === 201, r.status);
r = await B.post("/api/onboarding/org", { name: "ثاني" });
check("one shop per owner", r.status === 409);
r = await A.get(`/api/onboarding/slug?s=beta-${tag}`);
check("a taken address is reported", r.json.ok === false);
r = await A.get(`/api/onboarding/slug?s=dashboard`);
check("a reserved address is refused", r.json.ok === false && /محجوز/.test(r.json.error));

const meA = (await A.get("/api/tenancy/me")).json;
const meB = (await B.get("/api/tenancy/me")).json;
check("each owner sees their own shop", meA.org.slug === `alpha-${tag}` && meB.org.slug === `beta-${tag}`);
check("the beauty shop speaks of services", meB.vocab.item[0] === "خدمة");

// ── Build a little of each shop ──────────────────────────────────
const catA = (await A.post("/api/menu/categories", { name: "مشويات" })).json;
const itemA = (await A.post("/api/menu/items", { name: "مشاوي مشكل", price: 55, categoryId: catA.id })).json;
check("A adds an item", !!itemA.id && Number(itemA.price) === 55, itemA);
const itemB = (await B.post("/api/menu/items", { name: "صبغة", price: 150, kind: "service", durationMin: 90 })).json;
const qA = (await A.get("/api/queue")).json[0];
const qB = (await B.get("/api/queue")).json[0];
check("each shop has its queue", !!qA?.id && !!qB?.id && qA.id !== qB.id);

// ── Cross-tenant: B must not reach A's rows ──────────────────────
const tries: Array<[string, Promise<{ status: number; json: any }>]> = [
  ["edit A's item", B.patch(`/api/menu/items/${itemA.id}`, { price: 1 })],
  ["delete A's item", B.del(`/api/menu/items/${itemA.id}`)],
  ["rename A's category", B.patch(`/api/menu/categories/${catA.id}`, { name: "hacked" })],
  ["mark A's item sold out", B.patch(`/api/menu/availability`, { itemId: itemA.id, available: false })],
  ["read A's queue", B.get(`/api/queue/${qA.id}`)],
  ["call next in A's queue", B.post(`/api/queue/${qA.id}/next`)],
  ["change A's queue settings", B.patch(`/api/queues/${qA.id}`, { maxWaiting: 1 })],
  ["switch into A's branch", B.post(`/api/tenancy/branch`, { branchId: meA.branch.id })],
  ["edit A's branch", B.patch(`/api/branches/${meA.branch.id}`, { name: "hacked" })],
  ["file B's item under A's category", B.patch(`/api/menu/items/${itemB.id}`, { categoryId: catA.id })],
];
for (const [what, p] of tries) {
  const x = await p;
  check(`B cannot ${what}`, [400, 403, 404].includes(x.status) || (x.status === 200 && x.json?.ok === true && what === "delete A's item"), `${x.status}`);
}
const stillA = (await A.get("/api/menu/items")).json.find((i: any) => i.id === itemA.id);
check("…and A's item is untouched", stillA && Number(stillA.price) === 55 && stillA.branch.available === true && stillA.categoryId === catA.id, stillA);
const catStill = (await A.get("/api/menu/categories")).json.find((c: any) => c.id === catA.id);
check("…and A's category keeps its name", catStill?.name === "مشويات");

// ── Public pages, no session ─────────────────────────────────────
const anon = new Client();
r = await anon.get(`/api/public/m/alpha-${tag}`);
check("the menu opens with no sign-up", r.status === 200 && r.json.items.some((i: any) => i.name === "مشاوي مشكل"));
check("…with its queue", r.json.queues.length === 1 && r.json.queues[0].waiting === 0);
r = await anon.post(`/api/public/queues/${qA.id}/join`, { name: "ريم", partySize: 3, phone: "0501112233" });
check("anyone with the link joins the queue", r.status === 201 && /^A-\d+$/.test(r.json.displayCode), r.json);
const tok = r.json.token;
r = await anon.post(`/api/public/queues/${qA.id}/join`, { name: "ريم مرة ثانية" });
check("the same browser joining again keeps its ticket", r.json.token === tok);
r = await anon.get(`/api/public/tickets/${tok}`);
check("the ticket page shows place and wait", r.status === 200 && r.json.ahead === 0 && r.json.status === "waiting");
check("…and no phone number anywhere", !JSON.stringify(r.json).includes("501112233"));
r = await anon.get(`/api/public/tickets/not-a-real-token`);
check("a made-up token is 404", r.status === 404);
r = await anon.post(`/api/public/orders`, { slug: `alpha-${tag}`, lines: [{ itemId: itemA.id, qty: 2, unitPrice: 0.01 }], type: "pickup" });
check("an order is priced by the server, not the request", r.status === 201 && r.json.subtotal === 110, r.json);
r = await anon.post(`/api/public/orders`, { slug: `alpha-${tag}`, lines: [{ itemId: itemB.id, qty: 1 }] });
check("another shop's item cannot be ordered here", r.status === 400);
r = await anon.get(`/api/queue/${qA.id}`);
check("the staff queue needs a session", r.status === 401);

// ── Staff ────────────────────────────────────────────────────────
r = await A.post("/api/staff", { name: "سالم", username: `salem${tag}`, password: "pass1234", role: "staff" });
check("A adds a member of staff", r.status === 201, r.json);
const S = new Client();
r = await S.post("/api/staff-auth/login", { shop: `alpha-${tag}`, username: `salem${tag}`, password: "wrong" });
check("a wrong password is refused", r.status === 401);
r = await S.post("/api/staff-auth/login", { shop: `beta-${tag}`, username: `salem${tag}`, password: "pass1234" });
check("…and so is the right password at the wrong shop", r.status === 401);
r = await S.post("/api/staff-auth/login", { shop: `alpha-${tag}`, username: `salem${tag}`, password: "pass1234" });
check("staff sign in with shop + username + password", r.status === 200 && r.json.role === "staff");
r = await S.get("/api/auth/me");
check("…and are not admins, whoever owns the branch", r.json.isAdmin === false && r.json.role === "staff");
r = await S.get(`/api/queue/${qA.id}`);
check("staff reach the queue", r.status === 200 && r.json.counts.waiting === 1, r.json?.counts);
r = await S.post(`/api/queue/${qA.id}/next`);
check("…and can call next", r.status === 200 && r.json.called?.displayCode);
r = await S.patch(`/api/menu/availability`, { itemId: itemA.id, available: false });
check("…and can mark an item sold out", r.status === 200);
for (const [what, p] of [
  ["open the campaigns", S.get("/api/campaigns")],
  ["unlink WhatsApp", S.post("/api/whatsapp/logout")],
  ["read the contact lists", S.get("/api/contacts")],
  ["edit the shop", S.patch("/api/org", { name: "x" })],
  ["add staff", S.post("/api/staff", { name: "x", username: "xxxx", password: "123456" })],
  ["edit the menu", S.patch(`/api/menu/items/${itemA.id}`, { price: 1 })],
  ["read the email section", S.get("/api/email/contacts")],
  ["change queue settings", S.patch(`/api/queues/${qA.id}`, { maxWaiting: 1 })],
  ["open the admin pages", S.get("/api/admin/users")],
  ["edit message templates", S.req("PUT", "/api/wa-templates/queue_turn", { textAr: "x" })],
  ["open the WhatsApp automation", S.get("/api/wa-auto")],
  ["change the shop's alert phones", S.patch("/api/wa-auto/alerts", { phones: ["0501234567"] })],
  ["prepare a campaign", S.post("/api/wa-auto/autopilot/run")],
  ["read the platform's model keys", S.get("/api/admin/orgs/llm-keys")],
  ["open the coupons", S.get("/api/deals")],
  ["list the gift cards", S.get("/api/gifts")],
  ["ask for an upgrade", S.post("/api/tenancy/upgrade-request", { plan: "pro" })],
  ["sell a gift card", S.post("/api/gifts", { amount: 50 })],
  ["open the weekly report", S.get("/api/growth/report")],
] as const) {
  const x = await p;
  check(`staff cannot ${what}`, x.status === 403, `${x.status}`);
}

// ── A manager can do settings, not ownership ─────────────────────
await A.post("/api/staff", { name: "منى", username: `mona${tag}`, password: "pass1234", role: "manager" });
const M = new Client();
await M.post("/api/staff-auth/login", { shop: `alpha-${tag}`, username: `mona${tag}`, password: "pass1234" });
r = await M.patch(`/api/queues/${qA.id}`, { avgServiceMin: 7 });
check("a manager can change queue settings", r.status === 200 && r.json.avgServiceMin === 7);
r = await M.post(`/api/menu/items`, { name: "جديد", price: 10 });
check("…and edit the menu", r.status === 201);
r = await M.patch(`/api/org`, { name: "x" });
check("…but not the shop itself", r.status === 403);
r = await M.get(`/api/campaigns`);
check("…nor the campaigns", r.status === 403);
r = await M.get(`/api/wa-auto`);
check("…nor the WhatsApp automation", r.status === 403);
r = await anon.post("/api/public/events", { slug: `alpha-${tag}`, sid: "httptest1", events: [{ k: "menu" }, { k: "item", id: itemA.id }, { k: "add", id: itemA.id }] });
check("the menu reports what is looked at, anonymously", r.status === 204);
r = await A.get("/api/growth/menu-stats?days=7");
check("…and the business owner sees it in menu analytics", r.status === 200 && r.json.locked === false && r.json.funnel.menuViews >= 1 && r.json.funnel.adds >= 1, r.json?.funnel);
r = await S.get("/api/gifts/code/GABCDEF");
check("staff can look a gift card up at the counter", r.status === 404 && /رمز/.test(r.json.error));
r = await A.post("/api/gifts", { amount: 75, recipientName: "سعاد" });
check("the business owner sells a gift card", r.status === 201 && /^G[A-Z0-9]{6}$/.test(r.json.code) && r.json.url.includes("/g/"), r.json);
const giftCode = r.json.code, giftId = r.json.id;
r = await S.post(`/api/gifts/${giftId}/redeem`, { amount: 25 });
check("…and staff take an amount off it", r.status === 200 && r.json.balance === 50, r.json);
r = await anon.post("/api/public/deals/check", { slug: `alpha-${tag}`, code: giftCode.toLowerCase(), subtotal: 30 });
check("the cart recognises a gift card code", r.status === 200 && r.json.kind === "gift" && r.json.discount === 30, r.json);
r = await M.post("/api/menu/import-url", { url: "http://169.254.169.254/latest/meta-data/" });
check("a menu link into the server's own network is refused", r.status === 200 && r.json.rows.length === 0 && /غير مدعوم/.test(r.json.error), r.json);
r = await M.get(`/api/deals`);
check("a manager runs the coupons", r.status === 200 && Array.isArray(r.json.deals));

// ── WhatsApp, as the owner runs it ───────────────────────────────
await A.patch(`/api/menu/availability`, { itemId: itemA.id, available: true });
r = await anon.post(`/api/public/orders`, { slug: `alpha-${tag}`, type: "pickup", customerName: "ريم", phone: "0503334444", lines: [{ itemId: itemA.id, qty: 1 }] });
check("an order with a typed WhatsApp number is confirmed at once", r.status === 201 && r.json.status === "received", r.json);
r = await anon.post(`/api/public/orders`, { slug: `alpha-${tag}`, type: "pickup", phone: "12", lines: [{ itemId: itemA.id, qty: 1 }] });
check("…and a number that is not a phone is refused", r.status === 400);
r = await A.get("/api/wa-auto");
check("the owner sees the WhatsApp automation page", r.status === 200 && r.json.segments.length === 4 && r.json.whatsapp.connected === false && r.json.autopilot.enabled === false && !!r.json.protection.lanes, r.status);
check("…with the customer's confirmation counted", r.json.notifications.funnel.some((f: any) => f.kind === "order_received"), r.json.notifications?.funnel);
r = await A.patch("/api/wa-auto/alerts", { phones: ["050 123 4567", "nope"] });
check("alert phones are saved clean", r.status === 200 && r.json.phones.join() === "971501234567", r.json);
r = await A.patch("/api/wa-auto/autopilot", { enabled: true, weekday: 5, hour: 3, mode: "approval" });
check("the weekly campaign is switched on within bounds", r.status === 200 && r.json.enabled === true && r.json.weekday === 5 && r.json.hour === 17, r.json);
r = await A.post("/api/wa-auto/segment-list", { segment: "everyone" });
check("an unknown segment is refused", r.status === 400);
r = await A.post("/api/wa-auto/retarget", { campaignId: 999_999_999, who: "unread" });
check("retargeting another account's campaign finds nothing", r.status === 404);
r = await B.get("/api/wa-auto");
check("each owner sees their own automation", r.status === 200 && r.json.autopilot.enabled === false && r.json.alerts.phones.length === 0);
r = await A.get("/api/admin/orgs/llm-keys");
check("model keys are the platform admin's only", r.status === 403);

// ── Branches ─────────────────────────────────────────────────────
r = await A.post("/api/branches", { name: "فرع العين", nameEn: "Al Ain" });
check("A opens a second branch", r.status === 201 && r.json.slug === "al-ain", r.json);
const b2 = r.json;
r = await A.post("/api/tenancy/branch", { branchId: b2.id });
const me2 = (await A.get("/api/tenancy/me")).json;
check("switching branch moves the session there", r.status === 200 && me2.branch.id === b2.id);
check("…on the main number unless it has its own", me2.branch.ownNumber === false && me2.branch.waUserId === meA.branch.waUserId);
r = await A.post("/api/branches", { name: "فرع دبي", ownNumber: true });
check("a branch with its own number gets its own WhatsApp account", r.status === 201 && r.json.waUserId !== meA.branch.waUserId);
r = await A.post("/api/tenancy/branch", { branchId: r.json.id });
r = await A.get("/api/auth/me");
check("…and the owner stays themselves there", r.json.displayName === "owner a" && r.json.role === "owner");
r = await anon.get(`/api/public/m/alpha-${tag}/al-ain`);
check("the second branch has its own menu address", r.status === 200 && r.json.branch.slug === "al-ain" && r.json.branches.length === 3);

// ── Offers reach only those who agreed ───────────────────────────
r = await A.post("/api/customers/to-list");
check("no opted-in customers yet: no list", r.status === 400);
await new Client().post(`/api/public/queues/${qA.id}/join`, { name: "منى", phone: "0507778888", marketingOptIn: true });
r = await A.post("/api/customers/to-list");
check("opted-in customers become a campaign list", r.status === 200 && r.json.added === 1 && r.json.total === 1, r.json);
r = await A.post("/api/customers/to-list");
check("…and running it again does not duplicate them", r.status === 200 && r.json.added === 0, r.json);

// ── The platform admin makes a shop for a customer ───────────────
r = await B.post("/api/admin/orgs", { name: "محل", ownerPhone: `9990073${tag}`, password: "secret123" });
check("an owner cannot create shops on the platform", r.status === 403);
await db.update(usersTable).set({ isAdmin: true }).where(like(usersTable.phone, `9990071${tag}%`));
await A.get("/api/auth/me"); // the session picks up the admin flag
const refOfB = (await B.get("/api/growth/shop-referral")).json;
check("every owner has a link that brings other shops", /^M[A-Z0-9]{5}$/.test(refOfB.code) && refOfB.link.includes(`?ref=${refOfB.code}`), refOfB);
r = await A.post("/api/admin/orgs", { name: "صالون جديد", nameEn: "New Salon", vertical: "beauty", ownerPhone: `9990073${tag}`, ownerName: "هدى", password: "secret123", plan: "pro", planDays: 30, referralCode: refOfB.code });
check("the admin creates a shop with its owner and plan", r.status === 201 && r.json.org.vertical === "beauty" && /new-salon/.test(r.json.org.slug), r.json?.org?.slug ?? r.json);
const madeSlug = r.json.org.slug;
r = await A.get("/api/plans/admin/matrix");
check("the admin sees the whole matrix: plans, rows, the trial", r.status === 200 && r.json.plans.some((p: any) => p.key === "trial") && r.json.rows.toggles.length > 15 && r.json.trial.days > 0, r.json?.plans?.map((p: any) => p.key));
r = await A.req("PUT", "/api/plans/admin/matrix/basic", { toggles: { queue: true }, limits: { staff: 7 }, priceYearly: 990 });
check("…and edits any cell", r.status === 200);
r = await anon.get("/api/plans");
const basicPub = r.json.find((p: any) => p.plan_key === "basic");
check("the home page reads the same matrix, with bullets written from it", basicPub && Number(basicPub.price_yearly) === 990 && basicPub.features.some((f: string) => f.includes("7 حسابات موظفين")) && basicPub.toggles.queue === true, basicPub?.features);
check("…and never shows the trial plan", !r.json.some((p: any) => p.plan_key === "trial"));
await A.req("PUT", "/api/plans/admin/matrix/basic", { toggles: { queue: false }, limits: { staff: 3 }, priceYearly: "" });
r = await B.get("/api/plans/admin/matrix");
check("an owner cannot open the matrix", r.status === 403);
r = await A.get("/api/admin/orgs/metrics");
check("the admin sees the platform in numbers", r.status === 200 && typeof r.json.money.mrr === "number" && r.json.funnel.length === 6, r.json?.money);
r = await B.get("/api/admin/orgs/metrics");
check("…and an owner does not", r.status === 403);
const bStats = (await B.get("/api/growth/shop-referral")).json.stats;
check("a shop created by the admin with that code on a paid plan earns both a month", bStats.brought === 1 && bStats.rewarded === 1, bStats);
r = await A.get("/api/admin/orgs");
check("the admin list says which shops are at risk of leaving, and why", r.status === 200 && r.json.every((o: any) => o.risk && Array.isArray(o.risk.reasons)), r.json?.[0]?.risk);
r = await A.get("/api/admin/orgs/llm-keys");
check("the admin sees the model keys per channel, never a whole key", r.status === 200 && Array.isArray(r.json.providers) && r.json.providers.length > 0 && !JSON.stringify(r.json.keys).includes("apiKey"), r.json?.providers);
r = await A.post("/api/admin/orgs/llm-keys", { channel: "sms", provider: r.json.providers[0], apiKey: "x".repeat(20) });
check("…a key needs a known channel", r.status === 400);
r = await A.post("/api/admin/orgs/llm-keys", { channel: "whatsapp", provider: "nobody", apiKey: "x".repeat(20) });
check("…and a known provider", r.status === 400);
r = await A.post("/api/admin/orgs", { name: "مكرر", ownerPhone: `9990073${tag}`, password: "secret123" });
check("the same owner phone twice is refused", r.status === 409);
const N = new Client();
r = await N.post("/api/auth/login", { phone: `9990073${tag}`, password: "secret123" });
const meN = (await N.get("/api/tenancy/me")).json;
check("the new owner signs in straight into their shop, on the plan sold", r.status === 200 && meN.org?.slug === madeSlug && meN.plan.plan === "pro", meN.plan);
r = await anon.get(`/api/public/m/${madeSlug}`);
check("…and its menu address is live", r.status === 200 && r.json.org.vertical === "beauty");
r = await anon.get("/api/plans");
check("the home page gets its plans", r.status === 200 && Array.isArray(r.json) && r.json.length >= 3, r.json?.length);
r = await anon.post("/api/leads", { name: "زائر", phone: "0501231234", planName: "الاحترافية", businessType: "مطعم" });
check("a sign-up request from the home page is recorded", r.status === 201);
await db.execute(sql`delete from subscription_leads where phone = '0501231234'`);
await db.update(usersTable).set({ isAdmin: false }).where(like(usersTable.phone, `9990071${tag}%`));

// ── Plan limits ──────────────────────────────────────────────────
await db.update(usersTable).set({ plan: "basic" }).where(like(usersTable.phone, `9990072${tag}%`));
r = await B.post("/api/branches", { name: "فرع ثاني" });
check("the basic plan stops at one branch", r.status === 402 && r.json.plan === true, r.json);
r = await B.patch("/api/booking-settings", { enabled: true });
check("…and has no bookings", r.status === 402);
r = await B.get("/api/tenancy/me");
check("the shop knows how close it is to each limit", r.json.usage?.branches === 1 && r.json.plan.limits.branches === 1, r.json.usage);
r = await B.post("/api/branches", { name: "فرع ثالث" });
check("hitting a limit answers «higher plan», which opens the upgrade dialog", r.status === 402 && r.json.plan === true);
r = await B.post("/api/tenancy/upgrade-request", { plan: "pro", reason: "الفروع" });
check("…and the owner can ask for it", r.status === 200 && r.json.plan === "pro");
await db.execute(sql`delete from subscription_leads where source = 'in_app' and notes like ${"%beta-" + tag + "%"}`);
r = await B.post("/api/campaigns", { name: "x", message: "x" });
check("…and no campaigns", r.status === 402 || r.status === 400, `${r.status}`);
r = await B.patch("/api/wa-auto/autopilot", { enabled: true });
check("…nor the weekly campaign", r.status === 402 && r.json.plan === true, r.json);

server.close();
await cleanup("7");
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
