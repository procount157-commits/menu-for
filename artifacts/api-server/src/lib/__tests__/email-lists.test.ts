// Email lists and folders, against the real tables for user 1: an audience
// aimed at a folder reaches every list in it — including a list moved into
// the folder after the audience was drawn up — and nothing outside it.

import { inArray, like } from "drizzle-orm";
import { db, emailContactsTable, emailListsTable, emailListMembersTable, listFoldersTable } from "@workspace/db";
import { count, cleanFilter, describe } from "../email/segments";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

async function clean() {
  await db.delete(emailContactsTable).where(like(emailContactsTable.email, "lists-test-%"));
  await db.delete(emailListsTable).where(like(emailListsTable.name, "اختبار-قوائم%"));
  await db.delete(listFoldersTable).where(like(listFoldersTable.name, "اختبار-قوائم%"));
}
await clean();

const [fo] = await db.insert(listFoldersTable).values({ userId: USER, kind: "email", name: "اختبار-قوائم مجلد" }).returning();
const contacts = await db.insert(emailContactsTable).values(["a", "b", "c", "d"].map((x) => ({ userId: USER, email: `lists-test-${x}@x.ae` }))).returning();
const [l1] = await db.insert(emailListsTable).values({ userId: USER, name: "اختبار-قوائم 1", folderId: fo!.id }).returning();
const [l2] = await db.insert(emailListsTable).values({ userId: USER, name: "اختبار-قوائم 2" }).returning();
await db.insert(emailListMembersTable).values([
  { listId: l1!.id, contactId: contacts[0]!.id }, { listId: l1!.id, contactId: contacts[1]!.id },
  { listId: l2!.id, contactId: contacts[2]!.id },
]);

const f = cleanFilter({ folderIds: [fo!.id] });
check("a folder filter survives cleaning", f.folderIds?.[0] === fo!.id);
check("the folder reaches the lists in it", await count(USER, f) === 2);
await db.update(emailListsTable).set({ folderId: fo!.id }).where(inArray(emailListsTable.id, [l2!.id]));
check("...and a list moved into it later", await count(USER, f) === 3);
check("an address in no list in the folder is not reached", await count(USER, { ...f, q: "lists-test-d" }) === 0);
check("another account's folder reaches nobody", await count(USER + 999, f) === 0);
check("the filter reads in words", describe(f).includes("مجلد"), describe(f));

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
