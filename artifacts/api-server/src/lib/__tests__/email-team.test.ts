// The email team and its autopilot, against the real tables for user 1 and
// without calling a model: the guard's check, how a reply is rated, the team
// hired once and kept as the owner left it, the stage lists kept under a list,
// the campaign chosen for a list's sector, and the filters a wave uses.

import { and, eq, inArray, like } from "drizzle-orm";
import { db, botEmployeesTable, emailContactsTable, emailListsTable, emailListMembersTable, emailMessagesTable, listFoldersTable, emailAutopilotTable } from "@workspace/db";
import { guardCheck, temperature, ensureEmailTeam, EMAIL_TEAM } from "../email/team";
import { refreshStageLists, campaignFor, saveAutopilot, targetLists, getAutopilot } from "../email/autopilot";
import { count } from "../email/segments";

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
const KNOW = "الإقرار خلال 9 أشهر. غرامة AED 500 في الشهر. حد 55,000 درهم للذهب.";
check("a clean message passes", guardCheck(["{{company}}، هل إقراركم جاهز؟ الإقرار خلال 9 أشهر من نهاية الفترة."], KNOW).length === 0, guardCheck(["الإقرار خلال 9 أشهر"], KNOW).join("|"));
check("a number from the knowledge passes", guardCheck(["الغرامة AED 500 شهرياً"], KNOW).length === 0);
check("an invented fine is stopped", guardCheck(["الغرامة قد تصل إلى 250,000 درهم"], KNOW).some((i) => i.includes("250")), guardCheck(["الغرامة قد تصل إلى 250,000 درهم"], KNOW).join("|"));
check("hype is stopped", guardCheck(["نحن الأفضل في الإمارات"], KNOW).some((i) => i.includes("مبالغة")));
check("\"Best regards\" is a sign-off, not a claim", guardCheck(["Thank you.<br>Best regards,<br>The team"], KNOW).length === 0);
check("...but \"the best firm\" is a claim", guardCheck(["We are the best firm in Dubai"], KNOW).length > 0);
check("a guarantee is stopped", guardCheck(["We guarantee zero penalties"], KNOW).length > 0);
check("fake urgency is stopped", guardCheck(["آخر فرصة للتسجيل"], KNOW).some((i) => i.includes("استعجال")));
check("posing as an official notice is stopped", guardCheck(["إشعار رسمي بخصوص شركتكم"], KNOW).length > 0);
check("Arabic digits are read as numbers", guardCheck(["مهلة ٩٠ يوماً"], KNOW).some((i) => i.includes("90")), guardCheck(["مهلة ٩٠ يوماً"], KNOW).join("|"));

// ── ليلى ─────────────────────────────────────────────────────────
check("asking for a price is hot", temperature("كم سعر الباقة عندكم؟", "question") === "hot");
check("an inspection is hot", temperature("We have an AML inspection next month", "unclear") === "hot");
check("an unhappy client looking around is warm", temperature("محاسبنا الحالي بطيء ونبحث عن بديل", "unclear") === "warm");
check("interest without a question is warm", temperature("شكراً، مهتمون", "interested") === "warm");
check("a plain thank-you is cold", temperature("شكراً على المعلومات", "greeting") === "cold");
check("a no is not rated", temperature("لا نرغب، أوقفوا الرسائل", "opt_out") === null);

// ── The team ─────────────────────────────────────────────────────
const t1 = await ensureEmailTeam(USER);
check("all five are hired", EMAIL_TEAM.every((r) => t1.some((e) => e.role === r)), t1.map((e) => e.name).join(" "));
await db.update(botEmployeesTable).set({ isActive: false }).where(and(eq(botEmployeesTable.userId, USER), eq(botEmployeesTable.role, "email_guard")));
const t2 = await ensureEmailTeam(USER);
check("hiring again adds nobody twice", t2.length === t1.length);
check("one the owner switched off stays off", t2.find((e) => e.role === "email_guard")?.isActive === false);
await db.update(botEmployeesTable).set({ isActive: true }).where(and(eq(botEmployeesTable.userId, USER), eq(botEmployeesTable.role, "email_guard")));

// ── يوسف's stage lists ───────────────────────────────────────────
const [fo] = await db.insert(listFoldersTable).values({ userId: USER, kind: "email", name: "اختبار-فريق مجلد" }).returning();
const [list] = await db.insert(emailListsTable).values({ userId: USER, name: "اختبار-فريق وسطاء", folderId: fo!.id }).returning();
const day = (n: number) => new Date(Date.now() - n * 86_400_000);
const people = await db.insert(emailContactsTable).values([
  { userId: USER, email: "team-test-new@x.ae", sector: "عقارات" },
  { userId: USER, email: "team-test-unopened@x.ae", sector: "عقارات", lastSentAt: day(5) },
  { userId: USER, email: "team-test-opened@x.ae", sector: "عقارات", lastSentAt: day(5), lastOpenedAt: day(4) },
  { userId: USER, email: "team-test-clicked@x.ae", sector: "عقارات", lastSentAt: day(5), lastOpenedAt: day(4) },
  { userId: USER, email: "team-test-replied@x.ae", sector: "عقارات", lastSentAt: day(5), lastOpenedAt: day(4), lastRepliedAt: day(3) },
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
check("a real estate list gets the real estate AML campaign", plan.sector === "عقارات" && plan.goal.includes("AML"), plan.goal.slice(0, 40));
const cfg = await saveAutopilot(USER, { folderIds: [fo!.id], waveSize: 99999, quietDays: 1, mode: "nonsense" });
check("settings are kept within bounds", cfg.waveSize === 2000 && cfg.quietDays === 2 && cfg.mode === "approve", JSON.stringify({ w: cfg.waveSize, q: cfg.quietDays, m: cfg.mode }));
const targets = await targetLists(USER, await getAutopilot(USER));
check("a folder's lists are worked, not its stage lists", targets.length === 1 && targets[0]!.id === list!.id, targets.map((l) => l.name).join(" | "));

// ── The filters a wave uses ──────────────────────────────────────
check("never written to: one", await count(USER, { listIds: [list!.id], engagement: ["never_sent"] }) === 1);
check("rest days keep out who was written to lately", await count(USER, { listIds: [list!.id], quietDays: 7 }) === 1);
check("...and let in who rested long enough", await count(USER, { listIds: [list!.id], quietDays: 2 }) === 5);
check("the monthly ceiling keeps out who had enough", await count(USER, { listIds: [list!.id], maxTouches: 1 }) === 4);
check("a wave takes no more than its size", await count(USER, { listIds: [list!.id], take: 2 }) === 2);

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
