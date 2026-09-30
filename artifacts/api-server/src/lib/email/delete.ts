// ── Deleting email contacts ──────────────────────────────────────
// The owner can clear the audience: a few ticked rows, everyone a filter
// selects, a list with its addresses, or all of it. Queued follow-ups go
// with a contact (the jobs cascade). Anyone who unsubscribed, bounced or
// complained is kept, out of every list: that record is what stops the same
// address being written to again when a file with it is uploaded later.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, emailContactsTable, emailListMembersTable, emailListsTable } from "@workspace/db";

export async function deleteContacts(userId: number, ids: number[]) {
  let deleted = 0, keptUnsubscribed = 0;
  for (let i = 0; i < ids.length; i += 1000) {
    const part = ids.slice(i, i + 1000);
    const gone = await db.delete(emailContactsTable)
      .where(and(eq(emailContactsTable.userId, userId), inArray(emailContactsTable.id, part), eq(emailContactsTable.status, "active")))
      .returning({ id: emailContactsTable.id });
    deleted += gone.length;
    const goneIds = new Set(gone.map((g) => g.id));
    const kept = (await db.select({ id: emailContactsTable.id }).from(emailContactsTable)
      .where(and(eq(emailContactsTable.userId, userId), inArray(emailContactsTable.id, part.filter((x) => !goneIds.has(x)))))).map((r) => r.id);
    if (kept.length) { keptUnsubscribed += kept.length; await db.delete(emailListMembersTable).where(inArray(emailListMembersTable.contactId, kept)); }
  }
  return { done: deleted, deleted, keptUnsubscribed };
}

/** A list; with `withContacts`, its addresses too — those in no other list, so one list never empties another. */
export async function deleteList(userId: number, listId: number, withContacts: boolean) {
  const [l] = await db.select().from(emailListsTable).where(and(eq(emailListsTable.id, listId), eq(emailListsTable.userId, userId))).limit(1);
  if (!l) return null;
  let removed = { deleted: 0, keptUnsubscribed: 0 };
  if (withContacts) {
    const only = await db.execute<{ id: number }>(sql`
      SELECT m.contact_id AS id FROM email_list_members m
      WHERE m.list_id = ${listId}
        AND NOT EXISTS (SELECT 1 FROM email_list_members o WHERE o.contact_id = m.contact_id AND o.list_id <> ${listId})`);
    removed = await deleteContacts(userId, only.rows.map((r) => Number(r.id)));
  }
  await db.delete(emailListsTable).where(eq(emailListsTable.id, listId));
  return { ok: true, ...removed };
}
