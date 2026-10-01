// The email team and its autopilot, against the real tables for user 1 and
// without calling a model: the guard's check, how a reply is rated, the team
// hired once and kept as the owner left it, the stage lists kept under a list,
// the campaign chosen for a list's sector, and the filters a wave uses.

import { and, eq, inArray, like } from "drizzle-orm";
import { db, botEmployeesTable, emailContactsTable, emailListsTable, emailListMembersTable, emailMessagesTable, listFoldersTable, emailAutopilotTable, emailMissionsTable } from "@workspace/db";
import { guardCheck, temperature, ensureEmailTeam, EMAIL_TEAM } from "../email/team";
import { refreshStageLists, campaignFor, saveAutopilot, targetLists, getAutopilot } from "../email/autopilot";
import { count } from "../email/segments";
import { createMission, approve } from "../email/missions";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

async function clean() {
  await db.delete(emailMessagesTable).where(like(emailMessagesTable.token, "team-test-%"));
  await db.delete(emailContactsTable).where(like(emailContactsTable.email, "team-test-%"));
  await db.delete(emailListsTable).where(like(emailListsTable.name, "اختبار-فريق%"));
  await db.delete(listFoldersTable).where(like(listFoldersTable.name, "اختبار-فريق%"));
  await db.delete(emailAutopilotTable).where(eq(emailAutopilotTable.userId, USER));
}
await clean();

// ── ماجد ─────────────────────────────────────────────────────────
const KNOW = "التجربة المجانية 14 يوماً. الباقة AED 500 في الشهر. الفرع الإضافي 150 درهم.";
check("a clean message passes", guardCheck(["{{company}}، وقت الزحمة وين ينتظر زباينكم؟ جرّبوه 14 يوماً."], KNOW).length === 0, guardCheck(["جرّبوه 14 يوماً"], KNOW).join("|"));
check("a number from the knowledge passes", guardCheck(["الباقة AED 500 شهرياً"], KNOW).length === 0);
check("an invented price is stopped", guardCheck(["الباقة تبدأ من 250 درهم"], KNOW).some((i) => i.includes("250")), guardCheck(["الباقة تبدأ من 250 درهم"], KNOW).join("|"));
check("hype is stopped", guardCheck(["نحن الأفضل في الإمارات"], KNOW).some((i) => i.includes("مبالغة")));
check("\"Best regards\" is a sign-off, not a claim", guardCheck(["Thank you.<br>Best regards,<br>The team"], KNOW).length === 0);
check("...but \"the best menu\" is a claim", guardCheck(["We are the best menu app in Dubai"], KNOW).length > 0);
check("a guarantee is stopped", guardCheck(["We guarantee more customers"], KNOW).length > 0);
check("fake urgency is stopped", guardCheck(["آخر فرصة للاشتراك"], KNOW).some((i) => i.includes("استعجال")));
check("posing as an official notice is stopped", guardCheck(["إشعار رسمي بخصوص محلكم"], KNOW).length > 0);
check("Arabic digits are read as numbers", guardCheck(["مهلة ٩٠ يوماً"], KNOW).some((i) => i.includes("90")), guardCheck(["مهلة ٩٠ يوماً"], KNOW).join("|"));

// ── ليلى ─────────────────────────────────────────────────────────
check("asking for a price is hot", temperature("كم سعر الباقة عندكم؟", "question") === "hot");
check("asking for a demo is hot", temperature("Could you show us a demo next week?", "unclear") === "hot");
check("asking how to start is hot", temperature("كيف نشترك؟ عندنا فرعين", "unclear") === "hot");
check("one using something else and looking around is warm", temperature("عندنا نظام ثاني ونبحث عن بديل", "unclear") === "warm");
check("interest without a question is warm", temperature("شكراً، مهتمون", "interested") === "warm");
check("a plain thank-you is cold", temperature("شكراً على المعلومات", "greeting") === "cold");
check("a no is not rated", temperature("لا نرغب، أوقفوا الرسائل", "opt_out") === null);

// ── The team ─────────────────────────────────────────────────────
const t1 = await ensureEmailTeam(USER);
check("the whole team is hired", EMAIL_TEAM.every((r) => t1.some((e) => e.role === r)), t1.map((e) => e.name).join(" "));
await db.update(botEmployeesTable).set({ isActive: false }).where(and(eq(botEmployeesTable.userId, USER), eq(botEmployeesTable.role, "email_guard")));
const t2 = await ensureEmailTeam(USER);
check("hiring again adds nobody twice", t2.length === t1.length);
check("one the owner switched off stays off", t2.find((e) => e.role === "email_guard")?.isActive === false);
await db.update(botEmployeesTable).set({ isActive: true }).where(and(eq(botEmployeesTable.userId, USER), eq(botEmployeesTable.role, "email_guard")));

// ── يوسف's stage lists ───────────────────────────────────────────
const [fo] = await db.insert(listFoldersTable).values({ userId: USER, kind: "email", name: "اختبار-فريق مجلد" }).returning();
const [list] = await db.insert(emailListsTable).values({ userId: USER, name: "اختبار-فريق مطاعم", folderId: fo!.id }).returning();
const day = (n: number) => new Date(Date.now() - n * 86_400_000);
const people = await db.insert(emailContactsTable).values([
  { userId: USER, email: "team-test-new@x.ae", sector: "مطاعم" },
  { userId: USER, email: "team-test-unopened@x.ae", sector: "مطاعم", lastSentAt: day(5) },
  { userId: USER, email: "team-test-opened@x.ae", sector: "مطاعم", lastSentAt: day(5), lastOpenedAt: day(4) },
  { userId: USER, email: "team-test-clicked@x.ae", sector: "مطاعم", lastSentAt: day(5), lastOpenedAt: day(4) },
  { userId: USER, email: "team-test-replied@x.ae", sector: "مطاعم", lastSentAt: day(5), lastOpenedAt: day(4), lastRepliedAt: day(3) },
]).returning();
const by = (k: string) => people.find((p) => p.email === `team-test-${k}@x.ae`)!;
await db.insert(emailListMembersTable).values(people.map((p) => ({ listId: list!.id, contactId: p.id })));
await db.insert(emailMessagesTable).values({ userId: USER, contactId: by("clicked").id, toEmail: by("clicked").email, subject: "t", token: `team-test-${Date.now()}`, status: "sent", sentAt: day(5), clickedAt: day(4), clickCount: 1 } as any);

const st = await refreshStageLists(USER, list!);
const stageLists = await db.select().from(emailListsTable).where(eq(emailListsTable.parentListId, list!.id));
const members = async (stage: string) => (await db.select({ id: emailListMembersTable.contactId }).from(emailListMembersTable).where(eq(emailListMembersTable.listId, stageLists.find((l) => l.stage === stage)!.id))).map((r) => r.id);
check("four stage lists made under the list", stageLists.length === 4, stageLists.map((l) => l.name).join(" | "));
check("...in the list's folder", stageLists.every((l) => l.folderId === fo!.id));
check("who opened and did not reply", (await members("opened")).join() === String(by("opened").id));
check("who clicked", (await members("clicked")).join() === String(by("clicked").id));
check("who replied", (await members("replied")).join() === String(by("replied").id));
check("who did not open", (await members("unopened")).join() === String(by("unopened").id));
check("someone never written to is in none", !Object.values(st ?? {}).some((x: any) => x.total > 1));
await db.update(emailContactsTable).set({ lastRepliedAt: new Date() }).where(eq(emailContactsTable.id, by("opened").id));
const st2 = await refreshStageLists(USER, list!);
check("a reply moves them from opened to replied", (await members("opened")).length === 0 && (await members("replied")).includes(by("opened").id), JSON.stringify(st2?.replied));

// ── سلمى ─────────────────────────────────────────────────────────
const plan = await campaignFor(list!.id);
check("a restaurant list gets the restaurant campaign", plan.sector === "مطاعم" && plan.goal.startsWith("حملة المطاعم"), plan.goal.slice(0, 40));
const cfg = await saveAutopilot(USER, { folderIds: [fo!.id], waveSize: 99999, quietDays: 1, mode: "nonsense" });
check("settings are kept within bounds", cfg.waveSize === 2000 && cfg.quietDays === 2 && cfg.mode === "approve", JSON.stringify({ w: cfg.waveSize, q: cfg.quietDays, m: cfg.mode }));
const targets = await targetLists(USER, await getAutopilot(USER));
check("a folder's lists are worked, not its stage lists", targets.length === 1 && targets[0]!.id === list!.id, targets.map((l) => l.name).join(" | "));

await saveAutopilot(USER, { folderIds: [], listIds: [] });
const all = await targetLists(USER, await getAutopilot(USER));
check("nothing picked means every list, still no stage list", all.some((l) => l.id === list!.id) && all.every((l) => !l.parentListId), `${all.length}`);

// ── Approving a mission nobody can receive ───────────────────────
const m = await createMission(USER, { name: "اختبار-فريق مهمة", goal: "x", filter: { listIds: [-1] }, requireApproval: true });
await db.update(emailMissionsTable).set({ stage: "awaiting_approval", pending: { subjects: ["s"], html: "<p>x</p>", followups: [], why: "" } as any }).where(eq(emailMissionsTable.id, m.id));
let said = "";
try { await approve(USER, m.id); } catch (e: any) { said = e.message; }
const [after] = await db.select().from(emailMissionsTable).where(eq(emailMissionsTable.id, m.id));
check("approving an empty audience says why", said.includes("لا أحد"), said.slice(0, 60));
check("...and the mission keeps waiting, not paused", after!.stage === "awaiting_approval" && after!.status === "active", `${after!.stage}/${after!.status}`);
await db.delete(emailMissionsTable).where(eq(emailMissionsTable.id, m.id));

// ── The filters a wave uses ──────────────────────────────────────
check("never written to: one", await count(USER, { listIds: [list!.id], engagement: ["never_sent"] }) === 1);
check("rest days keep out who was written to lately", await count(USER, { listIds: [list!.id], quietDays: 7 }) === 1);
check("...and let in who rested long enough", await count(USER, { listIds: [list!.id], quietDays: 2 }) === 5);
check("the monthly ceiling keeps out who had enough", await count(USER, { listIds: [list!.id], maxTouches: 1 }) === 4);
check("a wave takes no more than its size", await count(USER, { listIds: [list!.id], take: 2 }) === 2);

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
