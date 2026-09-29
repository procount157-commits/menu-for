// ── Duplicate numbers ─────────────────────────────────────────────
// A number is the same number however it was written: 0501234567,
// +971 50 123 4567 and 971501234567 are one person, and an exact-text
// comparison let all three into a list. So numbers are compared by their
// canonical international form (lib/phone-import.ts).
//
// Two kinds, handled separately because they mean different things:
//   within a list  — always a mistake; the copy with a name is kept, then
//                    the older one.
//   across lists   — the same company in "عقارات" and in "هلا". Usually a
//                    mistake too (it gets every campaign twice), but a
//                    deliberate VIP list is legitimate, so this one is the
//                    owner's choice. The copy in the oldest list is kept,
//                    and a name from any copy is carried onto it.
// Numbers stored without a country code are rewritten to the full form on
// the way, so the next comparison is exact.

import { eq, inArray } from "drizzle-orm";
import { db, contactsTable, contactGroupsTable } from "@workspace/db";
import { normalizePhone } from "./phone-import";
import { logger } from "./logger";

type Row = { id: number; groupId: number; phone: string; name: string | null; status: string; createdAt: Date };

/** The comparison key: the international form, or the bare digits when it cannot be read. */
export function canonical(phone: string, country = "AE"): string {
  return normalizePhone(phone, country)?.e164 ?? phone.replace(/\D/g, "");
}

/** Which copy survives. Pure. A name beats none, active beats not, then the older list, then the older row. */
export function keeper(rows: Row[]): Row {
  return [...rows].sort((a, b) =>
    Number(!!b.name) - Number(!!a.name) ||
    Number(b.status === "active") - Number(a.status === "active") ||
    a.groupId - b.groupId || a.id - b.id)[0]!;
}

export interface DuplicateReport {
  withinLists: number;          // extra copies inside a list
  acrossLists: number;          // extra copies in another list
  numbersInSeveralLists: number;
  wrongFormat: number;          // stored without the country code
  samples: Array<{ phone: string; lists: string[] }>;
}

async function load(userId: number, groupIds?: number[]) {
  const groups = await db.select({ id: contactGroupsTable.id, name: contactGroupsTable.name }).from(contactGroupsTable)
    .where(eq(contactGroupsTable.userId, userId));
  const ids = groups.map((g) => g.id).filter((id) => !groupIds || groupIds.includes(id));
  const names = new Map(groups.map((g) => [g.id, g.name]));
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    rows.push(...await db.select({ id: contactsTable.id, groupId: contactsTable.groupId, phone: contactsTable.phone, name: contactsTable.name, status: contactsTable.status, createdAt: contactsTable.createdAt })
      .from(contactsTable).where(inArray(contactsTable.groupId, ids.slice(i, i + 200))));
  }
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const k = canonical(r.phone);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  return { byKey, names, rows };
}

export async function findDuplicates(userId: number, groupIds?: number[]): Promise<DuplicateReport> {
  const { byKey, names, rows } = await load(userId, groupIds);
  let within = 0, across = 0, several = 0;
  const samples: DuplicateReport["samples"] = [];
  for (const [k, list] of byKey) {
    if (list.length < 2) continue;
    const perGroup = new Map<number, number>();
    for (const r of list) perGroup.set(r.groupId, (perGroup.get(r.groupId) ?? 0) + 1);
    for (const n of perGroup.values()) within += n - 1;
    if (perGroup.size > 1) { several++; across += perGroup.size - 1; if (samples.length < 12) samples.push({ phone: k, lists: [...perGroup.keys()].map((g) => names.get(g) ?? String(g)) }); }
  }
  const wrongFormat = rows.filter((r) => canonical(r.phone) !== r.phone && /^\d{12,15}$/.test(canonical(r.phone))).length;
  return { withinLists: within, acrossLists: across, numbersInSeveralLists: several, wrongFormat, samples };
}

/**
 * Remove the duplicates. `across` also removes a number from every list but
 * the one it is kept in. Returns what was done.
 */
export async function removeDuplicates(userId: number, opts: { across?: boolean; groupIds?: number[] } = {}) {
  const { byKey } = await load(userId, opts.groupIds);
  const drop: number[] = [];
  const dropped = new Set<number>();
  const rename: Array<{ id: number; name: string }> = [];
  const refit: Array<{ id: number; phone: string }> = [];

  for (const [k, list] of byKey) {
    const scopes = opts.across ? [list] : [...groupBy(list, (r) => r.groupId).values()];
    for (const scope of scopes) {
      const keep = keeper(scope);
      for (const r of scope) if (r.id !== keep.id) { drop.push(r.id); dropped.add(r.id); }
      if (!keep.name) { const named = scope.find((r) => r.name); if (named) rename.push({ id: keep.id, name: named.name! }); }
    }
    // The survivors, in full international form.
    if (/^\d{12,15}$/.test(k)) for (const r of list) if (r.phone !== k && !dropped.has(r.id)) refit.push({ id: r.id, phone: k });
  }

  for (let i = 0; i < drop.length; i += 1000) await db.delete(contactsTable).where(inArray(contactsTable.id, drop.slice(i, i + 1000)));
  for (const r of rename) await db.update(contactsTable).set({ name: r.name }).where(eq(contactsTable.id, r.id));
  let fixed = 0;
  for (const r of refit) {
    // The unique index would refuse a rewrite that collides; that row is a duplicate of one just kept.
    try { await db.update(contactsTable).set({ phone: r.phone }).where(eq(contactsTable.id, r.id)); fixed++; }
    catch { await db.delete(contactsTable).where(eq(contactsTable.id, r.id)); drop.push(r.id); }
  }
  logger.info({ userId, removed: drop.length, named: rename.length, fixed, across: !!opts.across }, "أُزيل المكرر من القوائم");
  return { removed: drop.length, named: rename.length, fixed };
}

function groupBy<T, K>(xs: T[], f: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) { const k = f(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return m;
}

/** Numbers of this account already in a list other than `exceptGroupId`, with the list's name. */
export async function inOtherLists(userId: number, phones: string[], exceptGroupId?: number): Promise<Map<string, string>> {
  const groups = await db.select({ id: contactGroupsTable.id, name: contactGroupsTable.name }).from(contactGroupsTable)
    .where(eq(contactGroupsTable.userId, userId));
  const ids = groups.map((g) => g.id).filter((id) => id !== exceptGroupId);
  const names = new Map(groups.map((g) => [g.id, g.name]));
  const out = new Map<string, string>();
  if (!ids.length || !phones.length) return out;
  const want = new Set(phones);
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db.select({ phone: contactsTable.phone, groupId: contactsTable.groupId }).from(contactsTable)
      .where(inArray(contactsTable.groupId, ids.slice(i, i + 200)));
    for (const r of rows) { const k = canonical(r.phone); if (want.has(k) && !out.has(k)) out.set(k, names.get(r.groupId) ?? ""); }
  }
  return out;
}
