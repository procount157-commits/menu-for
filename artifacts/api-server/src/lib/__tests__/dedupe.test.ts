// Duplicate numbers, against the real tables for user 1: the same number in
// three spellings inside one list, the same company in two lists, the copy
// with a name kept, a number stored without its country code rewritten, and
// an import that skips a number another list already has.

import { eq, inArray, like } from "drizzle-orm";
import { db, contactGroupsTable, contactsTable } from "@workspace/db";
import { canonical, keeper, findDuplicates, removeDuplicates } from "../dedupe";
import { saveToGroup, saveToNewGroup } from "../contact-save";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

async function clean() {
  const gs = await db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(like(contactGroupsTable.name, "اختبار-مكرر%"));
  if (gs.length) await db.delete(contactGroupsTable).where(inArray(contactGroupsTable.id, gs.map((g) => g.id)));
}
await clean();
// Other test lists for user 1 would count as "other lists"; this test owns the user's lists while it runs.
const before = await db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(eq(contactGroupsTable.userId, USER));

// ── Pure ─────────────────────────────────────────────────────────
check("three spellings are one number", canonical("0501234567") === "971501234567" && canonical("+971 50 123 4567") === "971501234567" && canonical("971501234567") === "971501234567");
const k = keeper([
  { id: 5, groupId: 2, phone: "x", name: null, status: "active", createdAt: new Date() },
  { id: 9, groupId: 3, phone: "x", name: "شركة النور", status: "active", createdAt: new Date() },
  { id: 2, groupId: 1, phone: "x", name: null, status: "active", createdAt: new Date() },
]);
check("the copy with a name is kept", k.id === 9);
check("without names, the older list", keeper([
  { id: 5, groupId: 2, phone: "x", name: null, status: "active", createdAt: new Date() },
  { id: 7, groupId: 1, phone: "x", name: null, status: "active", createdAt: new Date() },
]).id === 7);

// ── Inside one list ──────────────────────────────────────────────
const [a] = await db.insert(contactGroupsTable).values({ userId: USER, name: "اختبار-مكرر أ" }).returning();
const [b] = await db.insert(contactGroupsTable).values({ userId: USER, name: "اختبار-مكرر ب" }).returning();
await db.insert(contactsTable).values([
  { groupId: a!.id, phone: "0501234567" },
  { groupId: a!.id, phone: "971501234567", name: "شركة النور" },
  { groupId: a!.id, phone: "501234567" },
  { groupId: a!.id, phone: "0559876543", name: "مؤسسة الواحة" },      // stored without the code, no duplicate
  { groupId: b!.id, phone: "971559876543" },                           // the same company in another list
  { groupId: b!.id, phone: "971521112222" },
]);
let rep = await findDuplicates(USER, [a!.id, b!.id]);
check("two extra copies inside the list", rep.withinLists === 2, `${rep.withinLists}`);
check("one number in two lists", rep.numbersInSeveralLists === 1 && rep.acrossLists === 1);
check("numbers stored without the code are counted", rep.wrongFormat >= 2, `${rep.wrongFormat}`);
check("samples name the lists", rep.samples[0]?.lists.length === 2);

let r = await removeDuplicates(USER, { groupIds: [a!.id, b!.id] });
let rows = await db.select().from(contactsTable).where(eq(contactsTable.groupId, a!.id));
check("inside the list: one copy left", rows.filter((x) => canonical(x.phone) === "971501234567").length === 1);
check("...the one with the name", rows.find((x) => canonical(x.phone) === "971501234567")?.name === "شركة النور");
check("numbers without the code are rewritten", rows.every((x) => /^971\d{9}$/.test(x.phone)), rows.map((x) => x.phone).join(","));
check("across lists untouched unless asked", (await db.select().from(contactsTable).where(eq(contactsTable.groupId, b!.id))).length === 2);

r = await removeDuplicates(USER, { across: true });
const inB = await db.select().from(contactsTable).where(eq(contactsTable.groupId, b!.id));
check("across lists: the copy in the other list goes", inB.length === 1 && inB[0]!.phone === "971521112222", `${inB.length}`);
check("...the named copy in the older list stays", (await db.select().from(contactsTable).where(eq(contactsTable.phone, "971559876543"))).some((x) => x.name === "مؤسسة الواحة"));

// ── Prevention on import ─────────────────────────────────────────
const s1 = await saveToGroup(USER, b!.id, [{ phone: "971501234567", name: null }, { phone: "971507770000", name: "جديد" }]);
check("a number already in another list is skipped", s1.added === 1 && s1.inOtherLists === 1 && s1.otherListNames.includes("اختبار-مكرر أ"), JSON.stringify({ added: s1.added, other: s1.inOtherLists }));
const s2 = await saveToGroup(USER, b!.id, [{ phone: "971501234567", name: null }], { allowOtherLists: true });
check("...unless the owner allows it", s2.added === 1);
const s3 = await saveToGroup(USER, b!.id, [{ phone: "0507770000", name: null }]);
check("the same number in another spelling is not added twice", s3.added === 0 && s3.existing === 1);
const s4 = await saveToNewGroup(USER, "اختبار-مكرر فارغ", null, [{ phone: "971507770000", name: null }]);
check("a new list whose numbers are all elsewhere is not left empty", s4.added === 0 && s4.groups.length === 0);
let raced = true;
try { await db.insert(contactsTable).values({ groupId: b!.id, phone: "971507770000" }); raced = false; } catch {}
check("the database itself refuses a duplicate in a list", raced);

await clean();
const after = await db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(eq(contactGroupsTable.userId, USER));
check("user 1's other lists untouched", after.length === before.length);
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
