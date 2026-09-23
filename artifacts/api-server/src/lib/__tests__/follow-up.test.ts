import { extractReferral, recordLead, enrolLead, cancelPendingFollowUps } from "../follow-up-engine";
import {
  db, leadSourcesTable, followUpSequencesTable, followUpJobsTable,
  DEFAULT_FOLLOW_UP_OFFSETS,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(56)} ${d}`); };

// ── Referral detection ────────────────────────────────────────────
// These payload shapes are what a click-to-WhatsApp ad produces. They are the
// only way to exercise this path before a real ad has ever run.

const ctwaFull = { message: { extendedTextMessage: { text: "مرحبا", contextInfo: {
  entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram",
  externalAdReply: { title: "عرض الصيف", body: "خصم 40%", sourceType: "ad",
    sourceId: "120210000000000000", sourceUrl: "https://fb.me/abc", ctwaClid: "ARxYzClickId" },
} } } };

const ctwaIdOnly = { message: { extendedTextMessage: { text: "hi", contextInfo: {
  externalAdReply: { title: "إعلان", sourceId: "120299999999999999" } } } } };

const ctwaEntryOnly = { message: { conversation: "hi", extendedTextMessage: { contextInfo: {
  entryPointConversionSource: "ctwa_ad" } } } };

const ctwaOnImage = { message: { imageMessage: { caption: "هذا", contextInfo: {
  externalAdReply: { ctwaClid: "ARimageClick", sourceId: "1203" } } } } };

const plain = { message: { conversation: "السلام عليكم" } };

const quotedReply = { message: { extendedTextMessage: { text: "رد", contextInfo: {
  stanzaId: "ABC", participant: "9715@s.whatsapp.net",
  quotedMessage: { conversation: "الأصلية" } } } } };

const a = extractReferral(ctwaFull);
check("full CTWA payload detected as an ad", a.isAd, `clid=${a.ctwaClid}`);
check("  ad id, url and title captured", a.adSourceId === "120210000000000000" && a.adSourceUrl === "https://fb.me/abc" && a.adTitle === "عرض الصيف");
check("  entry point captured", a.entryPoint === "ctwa_ad");
check("  raw payload retained for inspection", !!a.raw && !!(a.raw as any).externalAdReply);

check("sourceId alone is enough", extractReferral(ctwaIdOnly).isAd);
check("entryPointConversionSource alone is enough", extractReferral(ctwaEntryOnly).isAd);
check("referral on an image message is found", extractReferral(ctwaOnImage).isAd, "not just extendedTextMessage");

check("plain message is not an ad", !extractReferral(plain).isAd);
check("a quoted reply is not an ad", !extractReferral(quotedReply).isAd, "contextInfo without referral fields");
check("undefined/garbage does not throw", !extractReferral(undefined).isAd && !extractReferral({}).isAd);

// ── Enrolment ─────────────────────────────────────────────────────

async function clean() {
  await db.delete(followUpJobsTable).where(eq(followUpJobsTable.userId, USER));
  await db.delete(followUpSequencesTable).where(eq(followUpSequencesTable.userId, USER));
  await db.delete(leadSourcesTable).where(eq(leadSourcesTable.userId, USER));
}
await clean();

const [seq] = await db.insert(followUpSequencesTable).values({
  userId: USER, name: "تسلسل اختبار", isActive: true, sourceFilter: "ad",
  steps: DEFAULT_FOLLOW_UP_OFFSETS.map((offsetMinutes) => ({ offsetMinutes, message: `رسالة ${offsetMinutes}` })) as any,
}).returning();

const PHONE = "971500000777";
await recordLead(USER, PHONE, extractReferral(ctwaFull));
const [lead] = await db.select().from(leadSourcesTable)
  .where(and(eq(leadSourcesTable.userId, USER), eq(leadSourcesTable.phone, PHONE)));
check("lead recorded with source=ad", lead?.source === "ad", `clid=${lead?.ctwaClid}`);

const n = await enrolLead(USER, PHONE, "ad");
check("enrolment schedules one job per step", n === DEFAULT_FOLLOW_UP_OFFSETS.length, `${n} jobs`);

const jobs = await db.select().from(followUpJobsTable)
  .where(and(eq(followUpJobsTable.userId, USER), eq(followUpJobsTable.phone, PHONE)))
  .orderBy(asc(followUpJobsTable.stepIndex));
const gapsMin = jobs.map((j) => Math.round((new Date(j.dueAt).getTime() - Date.now()) / 60_000));
const expected = [...DEFAULT_FOLLOW_UP_OFFSETS];
check("due times match 1h/6h/12h/1d/3d/1w/1mo",
  gapsMin.every((g, i) => Math.abs(g - expected[i]!) <= 1), gapsMin.join(","));

check("re-enrolling the same lead adds nothing", (await enrolLead(USER, PHONE, "ad")) === 0, "idempotent");

// An organic lead must not enter an ad-only sequence.
await recordLead(USER, "971500000888", extractReferral(plain));
check("organic lead skipped by an ad-only sequence", (await enrolLead(USER, "971500000888", "organic")) === 0);

// Reply cancels the remainder.
const cancelled = await cancelPendingFollowUps(USER, PHONE, "ردّ العميل");
check("reply cancels every pending step", cancelled === DEFAULT_FOLLOW_UP_OFFSETS.length, `${cancelled} cancelled`);
const after = await db.select().from(followUpJobsTable)
  .where(and(eq(followUpJobsTable.userId, USER), eq(followUpJobsTable.status, "pending")));
check("  nothing left pending", after.length === 0);

// An inactive sequence enrols nobody.
await db.update(followUpSequencesTable).set({ isActive: false }).where(eq(followUpSequencesTable.id, seq!.id));
check("inactive sequence enrols nobody", (await enrolLead(USER, "971500000999", "ad")) === 0);

await clean();
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
