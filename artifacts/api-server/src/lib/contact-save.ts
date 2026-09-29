// ── Saving WhatsApp numbers, and checking them ────────────────────
// Shared by the number lists and the email import, so a number saved from
// either door lands the same way: de-duplicated against the list, under the
// company's name, split into lists of a thousand when the file is larger
// (the size a campaign and the list page handle comfortably), and checked
// against WhatsApp in the background when the number is linked.

import { and, eq, inArray, ne } from "drizzle-orm";
import { db, contactGroupsTable, contactsTable } from "@workspace/db";
import { checkNumbers, getStatus } from "./whatsapp";
import { canonical, inOtherLists } from "./dedupe";
import { logger } from "./logger";

export const LIST_SIZE = 1000;
const INSERT_BATCH = 500;

export interface SaveResult {
  added: number;
  /** Already in the list. */
  existing: number;
  /** Already in another of the account's lists, and so not added (unless allowed). */
  inOtherLists: number;
  otherListNames: string[];
  autoSplit: boolean;
  groups: Array<{ id: number; name: string; count: number }>;
}

async function insertAll(groupId: number, entries: Array<{ phone: string; name: string | null }>) {
  for (let i = 0; i < entries.length; i += INSERT_BATCH) {
    // The unique index is the last word: two imports racing into one list
    // cannot both add the same number.
    await db.insert(contactsTable).values(entries.slice(i, i + INSERT_BATCH)
      .map(({ phone, name }) => ({ groupId, phone, name: name || null, status: "active" }))).onConflictDoNothing();
  }
}

/**
 * Save into a list. Numbers already in it are skipped; a name is filled in
 * where the list had the number without one. Past LIST_SIZE the rest goes
 * into numbered sister lists.
 */
export async function saveToGroup(
  userId: number, groupId: number, entries: Array<{ phone: string; name: string | null }>,
  opts: { allowOtherLists?: boolean } = {},
): Promise<SaveResult> {
  const [group] = await db.select().from(contactGroupsTable)
    .where(and(eq(contactGroupsTable.id, groupId), eq(contactGroupsTable.userId, userId))).limit(1);
  if (!group) throw new Error("القائمة غير موجودة");

  // Compared by the international form, so 0501234567 in the list and
  // 971501234567 in the file are one number.
  const existing = await db.select({ id: contactsTable.id, phone: contactsTable.phone, name: contactsTable.name })
    .from(contactsTable).where(eq(contactsTable.groupId, groupId));
  const have = new Map(existing.map((e) => [canonical(e.phone), e]));
  let fresh = entries.filter((e) => !have.has(canonical(e.phone)));

  // A number already in another list is not added again unless the owner
  // says so — the same company in two lists gets every campaign twice.
  let skippedOther = 0;
  const otherNames = new Set<string>();
  if (!opts.allowOtherLists && fresh.length) {
    const elsewhere = await inOtherLists(userId, fresh.map((e) => canonical(e.phone)), groupId);
    if (elsewhere.size) {
      fresh = fresh.filter((e) => { const where = elsewhere.get(canonical(e.phone)); if (where === undefined) return true; skippedOther++; otherNames.add(where); return false; });
    }
  }
  const extra = { inOtherLists: skippedOther, otherListNames: [...otherNames].slice(0, 10) };
  const named = entries.filter((e) => e.name && have.get(canonical(e.phone)) && !have.get(canonical(e.phone))!.name);
  for (const e of named) await db.update(contactsTable).set({ name: e.name }).where(eq(contactsTable.id, have.get(canonical(e.phone))!.id));

  const room = Math.max(0, LIST_SIZE - existing.length);
  if (fresh.length <= room) {
    await insertAll(groupId, fresh);
    return { added: fresh.length, existing: entries.length - fresh.length - skippedOther, ...extra, autoSplit: false, groups: [{ id: groupId, name: group.name, count: existing.length + fresh.length }] };
  }

  // Fill this list, then sister lists of LIST_SIZE each. An empty list that
  // overflows becomes "- 1" of its series, as the lists always have.
  const groups: SaveResult["groups"] = [];
  const base = group.name.replace(/ - \d+$/, "");
  const firstName = existing.length === 0 ? `${base} - 1` : group.name;
  if (firstName !== group.name) await db.update(contactGroupsTable).set({ name: firstName }).where(eq(contactGroupsTable.id, groupId));
  if (room > 0) {
    await insertAll(groupId, fresh.slice(0, room));
    groups.push({ id: groupId, name: firstName, count: existing.length + room });
  }
  let rest = fresh.slice(room);
  let n = 2;
  while (rest.length) {
    const chunk = rest.slice(0, LIST_SIZE);
    rest = rest.slice(LIST_SIZE);
    const [g] = await db.insert(contactGroupsTable).values({ userId, name: `${base} - ${n}`, description: group.description, segment: group.segment }).returning();
    await insertAll(g!.id, chunk);
    groups.push({ id: g!.id, name: g!.name, count: chunk.length });
    n++;
  }
  return { added: fresh.length, existing: entries.length - fresh.length - skippedOther, ...extra, autoSplit: true, groups };
}

/** A new list, named after the file, and the numbers in it. */
export async function saveToNewGroup(userId: number, name: string, description: string | null, entries: Array<{ phone: string; name: string | null }>, opts: { allowOtherLists?: boolean; folderId?: number | null } = {}): Promise<SaveResult> {
  const [g] = await db.insert(contactGroupsTable).values({ userId, name: name.slice(0, 240) || "قائمة جديدة", description, folderId: opts.folderId ?? null }).returning();
  const r = await saveToGroup(userId, g!.id, entries, opts);
  // Everything in the file was already elsewhere: an empty list helps nobody.
  if (r.added === 0) { await db.delete(contactGroupsTable).where(eq(contactGroupsTable.id, g!.id)); r.groups = []; }
  return r;
}

export interface ValidateResult { total: number; valid: number; invalid: number; unknown: number; invalidPhones: string[] }

/**
 * Ask WhatsApp which numbers in a list are real. Dead ones are parked as
 * `invalid` (never deleted); one that resolves again is revived.
 */
export async function validateGroup(userId: number, groupId: number): Promise<ValidateResult> {
  const rows = await db.select({ id: contactsTable.id, phone: contactsTable.phone })
    .from(contactsTable).where(eq(contactsTable.groupId, groupId));
  if (rows.length === 0) return { total: 0, valid: 0, invalid: 0, unknown: 0, invalidPhones: [] };

  const byPhone = new Map<string, number[]>();
  for (const r of rows) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r.id]);
  const results = await checkNumbers(userId, [...byPhone.keys()]);

  const invalidIds: number[] = [], validIds: number[] = [], invalidPhones: string[] = [];
  let unknown = 0;
  for (const r of results) {
    const ids = byPhone.get(r.phone) ?? [];
    if (r.exists === null) { unknown += ids.length; continue; }
    if (r.exists) validIds.push(...ids);
    else { invalidIds.push(...ids); invalidPhones.push(r.phone); }
  }
  for (let i = 0; i < invalidIds.length; i += 1000) {
    await db.update(contactsTable).set({ status: "invalid" }).where(inArray(contactsTable.id, invalidIds.slice(i, i + 1000)));
  }
  for (let i = 0; i < validIds.length; i += 1000) {
    await db.update(contactsTable).set({ status: "active" })
      .where(and(inArray(contactsTable.id, validIds.slice(i, i + 1000)), ne(contactsTable.status, "active")));
  }
  logger.info({ groupId, userId, total: rows.length, valid: validIds.length, invalid: invalidIds.length, unknown }, "list validated");
  return { total: rows.length, valid: validIds.length, invalid: invalidIds.length, unknown, invalidPhones: invalidPhones.slice(0, 100) };
}

/**
 * Check freshly imported lists against WhatsApp without holding the upload
 * open. Returns whether it started: only when the number is linked.
 */
export function validateInBackground(userId: number, groupIds: number[]): boolean {
  if (!groupIds.length || !getStatus(userId)?.connected) return false;
  void (async () => {
    for (const id of groupIds) {
      await validateGroup(userId, id).catch((err) =>
        logger.warn({ userId, groupId: id, err: String(err?.message ?? err) }, "background validation failed"));
    }
  })();
  return true;
}
