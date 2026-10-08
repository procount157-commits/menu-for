// The Menu For You sales employee: settings, the prompt, the guard, the
// cadence, and one full dry-run day on the database — openers within the
// quota, a follow-up with its tracked link, replies moving the stage and
// filling the memory, «توقف», a click, a sign-up. No model, nothing sent.

process.env["SALES_NO_MODEL"] = "1";

import { eq, and, sql } from "drizzle-orm";
import { db, usersTable, platformSettingsTable, salesProspectsTable, salesTouchesTable, unsubscribedPhonesTable, agentMemoryTable } from "@workspace/db";
import {
  cleanSalesSettings, guessVertical, parseProspects, guardMessage, numbersIn, askedIfBot, ruleFacts, mergeFacts, adviceFrom, sellerPrompt,
  templateOpener, prospectCard, taskFor, DEFAULT_SETTINGS, OPT_OUT_LINE,
} from "../sales/brief";
import { nextFollowAt, productFacts, saveSalesSettings, invalidateSalesSettings, handleSalesInbound, recordClick, markSalesSignup, sentToday, newToken, linkFor, salesSettings, composeFor, demoKey } from "../sales/service";
import { salesTick, openerGapMinutes, closedReason } from "../sales/engine";
import { salesStats } from "../sales/stats";
import { getDailySentCount } from "../daily-limit";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(66)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

// ── Settings ─────────────────────────────────────────────────────
let s = cleanSalesSettings({ dailyNew: 900, hourFrom: 18, hourTo: 9, steps: [{ day: 12, goal: "ج", link: "signup" }, { day: 2, goal: "أ", link: "x" }, { day: 2, goal: "مكرر" }], links: { restaurant: "javascript:alert(1)", signup: "https://x.test/join" }, evil: 1 });
check("the daily quota is bounded", s.dailyNew === 300, s.dailyNew);
check("hours that end before they start are mended", s.hourFrom === 18 && s.hourTo === 19, [s.hourFrom, s.hourTo]);
check("steps are sorted, a repeated day dropped, a bad link kind made none", s.steps.length === 2 && s.steps[0]!.day === 2 && s.steps[0]!.link === "none" && s.steps[1]!.link === "signup", s.steps);
check("a link that is not http(s) is refused; a good one kept", s.links.restaurant === "" && s.links.signup === "https://x.test/join");
check("untouched settings keep their value", cleanSalesSettings({ name: "ليلى" }, s).dailyNew === 300 && cleanSalesSettings({ name: "ليلى" }, s).name === "ليلى");
check("the program starts off, and in a dry run", DEFAULT_SETTINGS.active === false && DEFAULT_SETTINGS.dryRun === true && DEFAULT_SETTINGS.dailyNew === 40);
check("the follow-up reaches days 20 and 30", DEFAULT_SETTINGS.steps.some((x) => x.day === 20) && DEFAULT_SETTINGS.steps.some((x) => x.day === 30));

// ── Who a shop is ────────────────────────────────────────────────
check("a barber is a barber, a ladies' salon a salon", guessVertical("صالون الفارس للحلاقة") === "barber" && guessVertical("Lamsa Beauty Salon") === "salon");
check("…a café, sweets, a restaurant; unknown is null", guessVertical("Coffee Lab") === "cafe" && guessVertical("حلويات الريم") === "sweets" && guessVertical("مطعم البيت") === "restaurant" && guessVertical("شركة تجارية") === null);
const norm = (r: string) => { const d = r.replace(/\D/g, ""); return d.length >= 9 ? (d.startsWith("971") ? d : `971${d.replace(/^0/, "")}`) : null; };
const parsed = parseProspects("0501112233, أحمد, مطعم الساحل, دبي\n971501112233\tمكرر\nبلا رقم\n0559998877;كافيه الزاوية;cafe;العين", norm);
check("a pasted list: phones found in any column, duplicates and bad lines out", parsed.rows.length === 2 && parsed.bad === 1, parsed);
check("…the kind is read from a column or guessed from the name", parsed.rows[0]!.vertical === "restaurant" && parsed.rows[1]!.vertical === "cafe", parsed.rows.map((r) => r.vertical));
check("…the shop, the city and the person are told apart by what they look like", parsed.rows[0]!.business === "مطعم الساحل" && parsed.rows[0]!.city === "دبي" && parsed.rows[0]!.name === "أحمد" && parsed.rows[1]!.business === "كافيه الزاوية" && parsed.rows[1]!.city === "العين", parsed.rows);

// ── The guard ────────────────────────────────────────────────────
const allowed = new Set(["99", "199", "30"]);
const ctx = (o: any = {}) => ({ mode: "followup" as const, allowedUrls: ["https://m.test/s/abc/restaurant"], requiredUrl: null, allowedNumbers: allowed, previous: [], ...o });
let g = guardMessage("**مرحبا** شوف هذا https://evil.test/x و https://m.test/s/abc/restaurant", ctx());
check("an unknown link is removed, a given one kept, markdown stripped", g.ok && !g.text.includes("evil") && g.links.length === 1 && !g.text.includes("**"), g);
g = guardMessage("تجربتنا تستاهل، تبي تشوف؟", ctx({ requiredUrl: "https://m.test/s/abc/restaurant" }));
check("a required link left out is appended", g.text.endsWith("https://m.test/s/abc/restaurant") && g.links.length === 1);
g = guardMessage("أهلاً، معك سارة من منيو فور يو https://m.test/s/abc/restaurant كيف تستقبلون الطلبات؟", ctx({ mode: "opener" }));
check("…but no stop line when the stop is a real button", !guardMessage("أهلاً، معك سارة من منيو فور يو، كيف تستقبلون الطلبات؟", ctx({ mode: "opener", hasStopButton: true })).text.includes("توقف"));
check("the first message carries no link, and does carry the stop line", !g.text.includes("https://") && g.text.includes("توقف"), g.text);
check("an invented price fails", !guardMessage("الاشتراك 49 درهم بس", ctx()).ok);
check("…a real one passes, Arabic digits too", guardMessage("الأساسية ٩٩ درهم شهرياً", ctx()).ok && guardMessage("الاحترافية 199 درهم", ctx()).ok);
check("an invented percentage fails", !guardMessage("زادت مبيعاتهم 40% 🔥", ctx()).ok);
check("claiming to be a person fails", !guardMessage("لا لا أنا إنسان مو بوت 😄", ctx()).ok);
check("saying «AI» unprompted fails; when asked it may", !guardMessage("أنا مساعد بالذكاء الاصطناعي", ctx()).ok && guardMessage("أنا المساعد الرقمي لفريق منيو فور يو بالذكاء الاصطناعي، وزميل يقدر يكمل معك", ctx({ askedIfBot: true })).ok);
check("pressure fails", !guardMessage("العرض ينتهي اليوم، آخر فرصة!", ctx()).ok);
check("a repeat of an earlier message fails", !guardMessage("هلا، كيف الطلبات عندكم؟", ctx({ previous: ["هلا! كيف الطلبات عندكم"] })).ok);
g = guardMessage("أ".repeat(900), ctx({ requiredUrl: "https://m.test/s/abc/restaurant" }));
check("a long message is cut, and keeps its required link", g.text.length < 800 && g.text.includes("https://m.test/s/abc/restaurant"));
check("numbers in Arabic digits are read", numbersIn("١٩٩ و 30٪").join() === "199,30");
check("«انت بوت؟» is a question about being a bot", askedIfBot("انت بوت؟") && askedIfBot("are you a bot") && !askedIfBot("كم السعر"));

// ── Memory and advice ────────────────────────────────────────────
const rf = ruleFacts("عندنا طلبات وكيتا، ومنيو PDF، و3 فروع، وكلم المدير بعدين");
check("facts a reply states outright", rf.some((f) => f.includes("طلبات") && f.includes("كيتا")) && rf.some((f) => f.includes("PDF")) && rf.some((f) => f.includes("3 فروع")) && rf.includes("يفضّل التواصل لاحقاً"), rf);
const mf = mergeFacts([{ fact: "عنده منيو PDF أو ورقي", at: "x" }], ["عنده منيو PDF أو ورقي", "جديد"], new Date());
check("facts merge without duplicates", mf.length === 2 && mf[1]!.fact === "جديد");
check("advice waits for 30 shops", adviceFrom({ contacted: 5 } as any, DEFAULT_SETTINGS).length === 1);
const adv = adviceFrom({ contacted: 100, replied: 3, interested: 1, trial: 0, won: 0, lost: 1, stopped: 9, clicks: 12, optOuts: 9, perStep: [{ step: 0, sent: 40, replies: 8 }, { step: 1, sent: 30, replies: 1 }], openersSent: 100, openerReplies: 5, aiFallbacks: 10, aiTotal: 40 }, DEFAULT_SETTINGS);
check("…then names the weak reply rate, the stops, the best and worst step, the guard, the offer", adv.length >= 5 && adv.some((a) => a.includes("نسبة الرد")) && adv.some((a) => a.includes("رقم 1") && a.includes("رقم 2")) && adv.some((a) => a.includes("الحارس")), adv);

// ── The prompt ───────────────────────────────────────────────────
const sp = sellerPrompt({ s: { ...DEFAULT_SETTINGS, offer: "شهر مجاني هذا الأسبوع", instructions: ["لا تستخدم كلمة «عميلنا»"] }, product: "- الأساسية: 99 درهم", links: { restaurant: "https://m.test/a" }, card: "بطاقة", mode: "followup", task: "اكتب المتابعة" });
check("the prompt carries the facts, the offer, the links, the trainer, the card — the task last", sp.includes("99 درهم") && sp.includes("شهر مجاني") && sp.includes("https://m.test/a") && sp.includes("«عميلنا»") && sp.includes("بطاقة") && sp.trim().endsWith("علامات تنصيص."), sp.slice(-120));
check("…and forbids invented numbers and denying it is a bot", sp.includes("مخترعة") && sp.includes("فلا تنكر"));
check("the opener task asks for no link and one easy question", taskFor("opener", DEFAULT_SETTINGS).includes("بلا رابط"));
check("a shop named in English gets an English line too", templateOpener(DEFAULT_SETTINGS, { name: null, business: "Great Rasoi Restaurant", vertical: "restaurant" }).includes("Menu For You —") && !templateOpener(DEFAULT_SETTINGS, { name: null, business: "مطعم الساحل", vertical: "restaurant" }).includes("Hi "));
check("…and the model is told to write both", taskFor("opener", DEFAULT_SETTINGS, undefined, null, undefined, true).includes("بالإنجليزية"));
check("a template opener names the shop", templateOpener(DEFAULT_SETTINGS, { name: null, business: "مطعم الساحل", vertical: "restaurant" }).includes("مطعم الساحل"));
check("the card says what was sent already", prospectCard({ name: null, business: "س", vertical: "cafe", city: null, stage: "replied", step: 1, replies: 1, clicks: 2, facts: [], summary: null, linksSent: [{ key: "cafe" }] }).includes("تجربة كافيه"));

// ── Cadence ──────────────────────────────────────────────────────
const t0 = new Date("2026-10-04T08:00:00Z");
const st = { ...DEFAULT_SETTINGS };
check("the first follow-up is due two days after the opener", nextFollowAt(st, t0, 0, t0)!.getTime() === t0.getTime() + 2 * 86_400_000);
check("…never sooner than tomorrow", nextFollowAt(st, t0, 0, new Date(t0.getTime() + 3 * 86_400_000))!.getTime() === t0.getTime() + 4 * 86_400_000);
check("…and not on the heels of their reply", nextFollowAt(st, t0, 1, new Date(t0.getTime() + 4 * 86_400_000), new Date(t0.getTime() + 4.5 * 86_400_000))!.getTime() === t0.getTime() + 6.5 * 86_400_000);
check("after the last step there is none", nextFollowAt(st, t0, 5, t0) === null);
check("40 a day over 10 hours: one every ~15 minutes (±30%)", Math.abs(openerGapMinutes(st, 0) - 10.5) < 1e-9 && Math.abs(openerGapMinutes(st, 1) - 19.5) < 1e-9);
check("…never closer than two minutes", openerGapMinutes({ hourFrom: 9, hourTo: 10, dailyNew: 300 }, 0) === 2);
check("closed when off, on a day off, or outside hours", closedReason(st, t0) === "البرنامج متوقف"
  && closedReason({ ...st, active: true, waUserId: 1, days: [1] }, new Date("2026-10-04T08:00:00Z")) === "يوم إجازة"
  && closedReason({ ...st, active: true, waUserId: 1, days: [0], hourFrom: 13, hourTo: 20 }, new Date("2026-10-04T08:00:00Z")) === "خارج ساعات العمل");

// ── One dry-run day on the database ──────────────────────────────
const [orig] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "sales"));
const [u] = await db.insert(usersTable).values({ phone: `99977${Math.floor(Math.random() * 1e7)}`, passwordHash: "!", displayName: "sales test", isAdmin: true }).returning();
const W = u!.id;
try {
  s = await saveSalesSettings({ active: false, dryRun: true, waUserId: W, days: [0, 1, 2, 3, 4, 5, 6], hourFrom: 0, hourTo: 24, dailyNew: 2, openerMode: "template", steps: DEFAULT_SETTINGS.steps });
  const on = { ...s, active: true };
  const facts = await productFacts();
  check("product facts come from the plan matrix and the trial settings", /التجربة المجانية: \d+ يوماً/.test(facts.text) && facts.text.includes("درهم") && facts.numbers.size > 3, facts.text.slice(0, 120));
  const mk = (phone: string, business: string, vertical = "restaurant") => ({ waUserId: W, phone, business, vertical, token: newToken(), source: "test" });
  const ps = await db.insert(salesProspectsTable).values([mk("971500000101", "مطعم أ"), mk("971500000102", "كافيه ب", "cafe"), mk("971500000103", "حلويات ج", "sweets"), mk("971500000104", "مطعم د")]).returning();
  await db.insert(unsubscribedPhonesTable).values({ userId: W, phone: "971500000101", reason: "test" });
  const now = new Date();
  let r = await salesTick(now, { ignoreSpacing: true, maxOpeners: 5, settings: on });
  check("a tick sends today's quota of openers (2), and no more", r.openers === 2, r);
  const after = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.waUserId, W));
  const contacted = after.filter((p) => p.stage === "contacted");
  check("…never to a number that asked to stop", after.find((p) => p.phone === "971500000101")!.stage === "new" && contacted.length === 2);
  check("…each with its first follow-up due in two days", contacted.every((p) => Math.abs(p.nextAt!.getTime() - (now.getTime() + 2 * 86_400_000)) < 5_000));
  const ot = await db.select().from(salesTouchesTable).where(and(eq(salesTouchesTable.waUserId, W), eq(salesTouchesTable.kind, "opener")));
  check("…recorded as dry, from the template, with no link (the stop is a button)", ot.length === 2 && ot.every((t) => t.status === "dry" && t.by === "template" && !t.text!.includes("http")), ot.map((t) => t.text));
  r = await salesTick(now, { ignoreSpacing: true, maxOpeners: 5, settings: on });
  check("a second tick the same day opens nothing more", r.openers === 0, r);
  check("today's openers are counted in the seller's clock", (await sentToday(W, s.tz, ["opener"], now)) === 2);
  check("dry runs do not spend the number's daily allowance", (await getDailySentCount(W)) === 0);

  const A = contacted[0]!, B = contacted[1]!;
  await db.update(salesProspectsTable).set({ nextAt: new Date(now.getTime() - 60_000) }).where(eq(salesProspectsTable.id, A.id));
  r = await salesTick(now, { ignoreSpacing: true, maxOpeners: 0, settings: on });
  const [a1] = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, A.id));
  const [fu] = await db.select().from(salesTouchesTable).where(and(eq(salesTouchesTable.prospectId, A.id), eq(salesTouchesTable.kind, "followup")));
  // Whichever prospect the tick opened first — the sweets shop gets the sweets demo.
  const demo = linkFor(s, A, demoKey(s, A.vertical))!;
  check("a due follow-up goes out, step 1 of 5, with the demo link for its kind", r.followUps === 1 && a1!.step === 1 && fu?.text?.includes(demo) === true && demo.includes(`/s/${A.token}/`), { r, demo, text: fu?.text });
  check("…the link is remembered as sent", a1!.linksSent.length === 1);
  check("…and the next is due on day 5", Math.abs(a1!.nextAt!.getTime() - (a1!.firstSentAt!.getTime() + 5 * 86_400_000)) < 5_000 || a1!.nextAt!.getTime() >= now.getTime() + 86_400_000);

  check("a message from a number not on the list is not the seller's", !(await handleSalesInbound({ userId: W, phone: "971500009999", text: "مرحبا" }, { waitMs: 0 })));
  check("…nor one to another account", !(await handleSalesInbound({ userId: W + 100000, phone: A.phone, text: "مرحبا" }, { waitMs: 0 })));
  check("a reply from a shop on the list is", await handleSalesInbound({ userId: W, phone: A.phone, text: "هلا، عندنا طلبات وكيتا والطلبات بالتلفون" }, { waitMs: 0 }));
  const [a2] = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, A.id));
  check("…it moves to «replied», counts the reply, and pauses the chase", a2!.stage === "replied" && a2!.replies === 1 && a2!.nextAt!.getTime() >= Date.now() + 1.9 * 86_400_000, a2);
  check("…and what it said is remembered on the shop", a2!.facts.some((f) => f.fact.includes("طلبات")) && a2!.facts.some((f) => f.fact.includes("بالتلفون")), a2!.facts);
  const wins = await db.select().from(agentMemoryTable).where(and(eq(agentMemoryTable.userId, W), eq(agentMemoryTable.role, "sales"), eq(agentMemoryTable.kind, "win")));
  check("the message that earned the reply is kept as a win", wins.some((w) => w.content.startsWith("رسالة جلبت رداً")), wins.map((w) => w.content));
  await handleSalesInbound({ userId: W, phone: A.phone, text: "حلو، أبي أجرب" }, { waitMs: 0 });
  check("a buying signal moves it to «interested»", (await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, A.id)))[0]!.stage === "interested");

  await handleSalesInbound({ userId: W, phone: B.phone, text: "توقف" }, { waitMs: 0 });
  const [b2] = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, B.id));
  const unsub = await db.select().from(unsubscribedPhonesTable).where(and(eq(unsubscribedPhonesTable.userId, W), eq(unsubscribedPhonesTable.phone, B.phone)));
  check("«توقف» stops it for good, on the list and in the unsubscribed numbers", b2!.stage === "stopped" && b2!.nextAt === null && unsub.length === 1, b2);

  check("a link-preview robot is not a click", (await recordClick(A.token, "restaurant", "WhatsApp/2.23")) !== null && (await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, A.id)))[0]!.clicks === 0);
  const to = await recordClick(A.token, "restaurant", "Mozilla/5.0 (iPhone)");
  check("a person's click is counted and lands on the demo menu", to?.endsWith("/bait-shami") === true && (await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, A.id)))[0]!.clicks === 1, to);
  check("an unknown token still lands somewhere", (await recordClick("nope", "signup", "Mozilla")) !== null);

  const n = await markSalesSignup(`0${A.phone.slice(-9)}`);
  check("signing up with the same number in another format (0 + nine digits) puts it in its trial", n === 1 && (await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, A.id)))[0]!.stage === "trial");

  const stats = await salesStats(await salesSettings());
  check("the numbers: by stage, today against the quota, and advice", stats!.byStage.trial === 1 && stats!.byStage.stopped === 1 && stats!.today.openers === 2 && stats!.today.quota === 2 && stats!.advice.length >= 1, stats);

  const pv = await composeFor(s, (await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.phone, "971500000104")))[0]!, "opener");
  check("a preview of the next opener is written and guarded, not sent", pv.ok && pv.text.includes("مطعم د"));
} finally {
  await db.delete(usersTable).where(eq(usersTable.id, W));
  if (orig) await db.update(platformSettingsTable).set({ value: orig.value }).where(eq(platformSettingsTable.key, "sales"));
  else await db.delete(platformSettingsTable).where(eq(platformSettingsTable.key, "sales"));
  invalidateSalesSettings();
  await db.execute(sql`DELETE FROM sales_touches WHERE wa_user_id = ${W}`);
}

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
