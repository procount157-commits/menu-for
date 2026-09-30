// Clearing the email audience, against the real tables for user 1: ticked
// contacts deleted with their queued follow-ups, an unsubscribed address kept
// (out of every list) so it is never written to again, and a list deleted
// with its addresses without emptying another list.

import { eq, inArray, like } from "drizzle-orm";
import { db, emailContactsTable, emailListsTable, emailListMembersTable } from "@workspace/db";
import { deleteContacts, deleteList } from "../email/delete";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

async function clean() {
  await db.delete(emailContactsTable).where(like(emailContactsTable.email, "del-test-%"));
  await db.delete(emailListsTable).where(like(emailListsTable.name, "اختبار-حذف%"));
}
await clean();

const mk = (email: string, status = "active") => db.insert(emailContactsTable).values({ userId: USER, email, status }).returning().then((r) => r[0]!);
const a = await mk("del-test-a@x.ae"), b = await mk("del-test-b@x.ae"), u = await mk("del-test-u@x.ae", "unsubscribed");
const shared = await mk("del-test-shared@x.ae"), only = await mk("del-test-only@x.ae");
const [l1] = await db.insert(emailListsTable).values({ userId: USER, name: "اختبار-حذف 1" }).returning();
const [l2] = await db.insert(emailListsTable).values({ userId: USER, name: "اختبار-حذف 2" }).returning();
await db.insert(emailListMembersTable).values([
  { listId: l1!.id, contactId: u.id }, { listId: l1!.id, contactId: shared.id }, { listId: l1!.id, contactId: only.id },
  { listId: l2!.id, contactId: shared.id },
]);

const r1 = await deleteContacts(USER, [a.id, b.id, u.id]);
check("the ticked contacts are deleted", r1.deleted === 2, JSON.stringify(r1));
check("an unsubscribed address is kept", r1.keptUnsubscribed === 1 && (await db.select().from(emailContactsTable).where(eq(emailContactsTable.id, u.id))).length === 1);
check("...and taken out of its lists", (await db.select().from(emailListMembersTable).where(eq(emailListMembersTable.contactId, u.id))).length === 0);
check("another account's contact cannot be deleted", (await deleteContacts(USER + 999, [shared.id])).deleted === 0);

const r2 = await deleteList(USER, l1!.id, true);
check("a list deleted with its addresses", r2?.deleted === 1, JSON.stringify(r2));
check("...an address also in another list stays", (await db.select().from(emailContactsTable).where(eq(emailContactsTable.id, shared.id))).length === 1);
check("...and that list keeps it", (await db.select().from(emailListMembersTable).where(eq(emailListMembersTable.listId, l2!.id))).length === 1);
check("the list itself is gone", (await db.select().from(emailListsTable).where(inArray(emailListsTable.id, [l1!.id]))).length === 0);
check("another account's list is not found", (await deleteList(USER + 999, l2!.id, true)) === null);

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
