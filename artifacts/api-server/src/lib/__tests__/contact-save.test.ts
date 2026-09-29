// Saving imported WhatsApp numbers into lists, against the real tables for
// user 1: a new list named after the file, a large file split into lists of
// a thousand, a second import into the same list adding nothing twice, and a
// name filled in where the list had the number without one.

import * as XLSX from "xlsx";
import { eq, inArray, like } from "drizzle-orm";
import { db, contactGroupsTable, contactsTable } from "@workspace/db";
import { readWorkbook, parseTables, whatsappEntries } from "../phone-import";
import { saveToNewGroup, saveToGroup, LIST_SIZE } from "../contact-save";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

async function clean() {
  const gs = await db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(like(contactGroupsTable.name, "اختبار-استيراد%"));
  if (gs.length) await db.delete(contactGroupsTable).where(inArray(contactGroupsTable.id, gs.map((g) => g.id)));
}
await clean();

// ── A small file ─────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["اسم الشركة", "الهاتف", "الجوال", "المدينة"],
  ["شركة النور", "04 123 4567", "050 111 2222", "دبي"],
  ["مؤسسة الرياض", "", "0551234567", "الرياض"],
  ["فرع النور", "", "050 111 2222", "دبي"],
]), "s");
const rep = parseTables(readWorkbook(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer), "AE");
const wa = whatsappEntries(rep.rows);
const r1 = await saveToNewGroup(USER, "اختبار-استيراد صغير", null, wa.entries);
check("two numbers saved, the repeat kept once", r1.added === 2 && !r1.autoSplit, `${r1.added}`);
const rows = await db.select().from(contactsTable).where(eq(contactsTable.groupId, r1.groups[0]!.id));
check("saved under the company name", rows.find((x) => x.phone === "971501112222")?.name === "شركة النور");
check("the Riyadh number is Saudi", rows.some((x) => x.phone === "966551234567" && x.name === "مؤسسة الرياض"));

// Importing again adds nothing, and fills a missing name.
await db.update(contactsTable).set({ name: null }).where(eq(contactsTable.phone, "966551234567"));
const r2 = await saveToGroup(USER, r1.groups[0]!.id, wa.entries);
check("a second import of the same file adds nothing", r2.added === 0 && r2.existing === 2);
const [filled] = await db.select().from(contactsTable).where(eq(contactsTable.phone, "966551234567"));
check("...but fills a name the list was missing", filled?.name === "مؤسسة الرياض");

// ── A large file ─────────────────────────────────────────────────
const n = LIST_SIZE * 2 + 500;
const big = Array.from({ length: n }, (_, i) => ({ phone: `9715${String(10_000_000 + i).slice(-8)}`, name: `شركة ${i}` }));
const r3 = await saveToNewGroup(USER, "اختبار-استيراد كبير", null, big);
check(`${n} numbers go into three lists`, r3.autoSplit && r3.groups.length === 3 && r3.added === n, r3.groups.map((g) => g.count).join("/"));
check("the lists are numbered from 1", r3.groups[0]!.name.endsWith(" - 1") && r3.groups[2]!.name.endsWith(" - 3"), r3.groups.map((g) => g.name).join(" | "));
const counts = await Promise.all(r3.groups.map(async (g) => (await db.select().from(contactsTable).where(eq(contactsTable.groupId, g.id))).length));
check("no list holds more than a thousand", counts.every((c) => c <= LIST_SIZE) && counts.reduce((a, b) => a + b, 0) === n, counts.join("/"));

// Topping up a partly full list fills it and spills into a sister list.
const partial = await saveToNewGroup(USER, "اختبار-استيراد جزئي", null, big.slice(0, 900));
const r4 = await saveToGroup(USER, partial.groups[0]!.id, big.slice(0, 1200));
check("topping up adds only the new ones", r4.added === 300 && r4.existing === 900, `${r4.added}/${r4.existing}`);
check("...filling the list to a thousand and spilling the rest", r4.groups[0]!.count === LIST_SIZE && r4.groups[1]!.count === 200, r4.groups.map((g) => g.count).join("/"));

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
