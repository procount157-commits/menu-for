import { Router } from "express";
import { db, contactGroupsTable, contactsTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import * as XLSX from "xlsx";

const router = Router();
router.use(requireAuth);

const CHUNK_SIZE = 1000;
const INSERT_BATCH = 200;

const COUNTRY_CODES = [971, 966, 974, 965, 973, 968, 967, 962, 963, 964, 961, 249, 212, 213, 216, 20];

function isMobileNumber(raw: string): boolean {
  const phone = cleanPhone(raw);
  if (!isValidPhone(phone)) return false;
  for (const cc of COUNTRY_CODES) {
    const ccStr = String(cc);
    if (phone.startsWith(ccStr)) {
      const local = phone.slice(ccStr.length);
      if (/^[5671]/.test(local) && local.length >= 7) return true;
      return false;
    }
  }
  if (/^05\d{8}$/.test(phone) || /^5\d{8}$/.test(phone)) return true;
  if (phone.length >= 10) return true;
  return false;
}

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const groups = await db
    .select({
      id: contactGroupsTable.id,
      name: contactGroupsTable.name,
      description: contactGroupsTable.description,
      segment: contactGroupsTable.segment,
      createdAt: contactGroupsTable.createdAt,
      count: count(contactsTable.id),
    })
    .from(contactGroupsTable)
    .leftJoin(contactsTable, eq(contactGroupsTable.id, contactsTable.groupId))
    .where(eq(contactGroupsTable.userId, userId))
    .groupBy(contactGroupsTable.id)
    .orderBy(contactGroupsTable.createdAt);

  res.json(groups.map((g) => ({ ...g, contacts: [] })));
});

router.post("/", async (req, res) => {
  const userId = req.session.userId!;
  const { name, description, segment } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const [group] = await db
    .insert(contactGroupsTable)
    .values({ userId, name, description, segment: segment || null })
    .returning();

  res.status(201).json({ ...group, count: 0, contacts: [] });
});

router.get("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);

  const [group] = await db
    .select()
    .from(contactGroupsTable)
    .where(and(eq(contactGroupsTable.id, id), eq(contactGroupsTable.userId, userId)));

  if (!group) return res.status(404).json({ error: "Not found" });

  const contacts = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.groupId, id))
    .orderBy(contactsTable.createdAt);

  const [countResult] = await db
    .select({ count: count(contactsTable.id) })
    .from(contactsTable)
    .where(eq(contactsTable.groupId, id));

  res.json({ ...group, count: countResult?.count || 0, contacts });
});

// ── Export contact list as Excel ──────────────────────────────────
router.get("/:id/export", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);

  const [group] = await db
    .select()
    .from(contactGroupsTable)
    .where(and(eq(contactGroupsTable.id, id), eq(contactGroupsTable.userId, userId)));

  if (!group) return res.status(404).json({ error: "Not found" });

  const contacts = await db
    .select({ name: contactsTable.name, phone: contactsTable.phone })
    .from(contactsTable)
    .where(eq(contactsTable.groupId, id))
    .orderBy(contactsTable.createdAt);

  const hasNames = contacts.some((c) => c.name);
  const rows = contacts.map((c, i) =>
    hasNames
      ? { "#": i + 1, الاسم: c.name ?? "", الهاتف: c.phone }
      : { "#": i + 1, الهاتف: c.phone }
  );

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = hasNames
    ? [{ wch: 6 }, { wch: 28 }, { wch: 20 }]
    : [{ wch: 6 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, group.name.slice(0, 31));

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = encodeURIComponent(group.name) + ".xlsx";

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
});

router.delete("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);
  await db.delete(contactGroupsTable).where(and(eq(contactGroupsTable.id, id), eq(contactGroupsTable.userId, userId)));
  res.json({ success: true, message: "Deleted" });
});

router.post("/:id/numbers", async (req, res) => {
  const userId = req.session.userId!;
  const groupId = parseInt(req.params.id);
  const { numbers, contacts: contactsInput, format = "text", mobileOnly = false } = req.body;

  if (!numbers && !contactsInput) return res.status(400).json({ error: "Numbers are required" });

  const [group] = await db
    .select()
    .from(contactGroupsTable)
    .where(and(eq(contactGroupsTable.id, groupId), eq(contactGroupsTable.userId, userId)));
  if (!group) return res.status(404).json({ error: "Group not found" });

  type Entry = { name: string; phone: string };
  let rawEntries: Entry[] = [];

  if (contactsInput && Array.isArray(contactsInput)) {
    rawEntries = contactsInput.map((c: any) => ({
      name: String(c.name || "").trim(),
      phone: String(c.phone || "").trim(),
    }));
  } else {
    let rawList: string[] = [];
    if (format === "json") {
      rawList = JSON.parse(numbers);
    } else {
      rawList = numbers.split(/[\n,\r]+/).map((n: string) => n.trim()).filter((n: string) => n.length > 0);
    }
    rawEntries = rawList.map((p) => ({ name: "", phone: p }));
  }

  let invalid = 0;
  let skippedLandline = 0;
  const seen = new Set<string>();
  const validEntries: Entry[] = [];

  for (const entry of rawEntries) {
    const phone = cleanPhone(entry.phone);
    if (!isValidPhone(phone)) { invalid++; continue; }
    if (mobileOnly && !isMobileNumber(phone)) { skippedLandline++; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    validEntries.push({ name: entry.name, phone });
  }

  const globalDuplicates = rawEntries.length - invalid - skippedLandline - validEntries.length;

  if (validEntries.length <= CHUNK_SIZE) {
    const existing = await db.select({ phone: contactsTable.phone }).from(contactsTable).where(eq(contactsTable.groupId, groupId));
    const existingSet = new Set(existing.map((e) => e.phone));
    const toInsert = validEntries.filter((e) => !existingSet.has(e.phone));
    const groupDups = validEntries.length - toInsert.length;
    if (toInsert.length > 0) await batchInsert(groupId, toInsert);

    return res.json({
      added: toInsert.length,
      duplicates: globalDuplicates + groupDups,
      invalid, skippedLandline,
      total: rawEntries.length,
      autoSplit: false,
      groups: [{ id: groupId, name: group.name, count: toInsert.length }],
    });
  }

  const chunks: Entry[][] = [];
  for (let i = 0; i < validEntries.length; i += CHUNK_SIZE) chunks.push(validEntries.slice(i, i + CHUNK_SIZE));

  const createdGroups: { id: number; name: string; count: number }[] = [];
  const baseName = group.name.replace(/ - \d+$/, "");

  for (let ci = 0; ci < chunks.length; ci++) {
    const groupName = `${baseName} - ${ci + 1}`;
    let targetGroupId: number;

    if (ci === 0) {
      await db.update(contactGroupsTable).set({ name: groupName }).where(eq(contactGroupsTable.id, groupId));
      targetGroupId = groupId;
    } else {
      const [newGroup] = await db.insert(contactGroupsTable).values({ userId, name: groupName, description: group.description }).returning();
      targetGroupId = newGroup.id;
    }

    await batchInsert(targetGroupId, chunks[ci]);
    createdGroups.push({ id: targetGroupId, name: groupName, count: chunks[ci].length });
  }

  return res.json({
    added: validEntries.length,
    duplicates: globalDuplicates,
    invalid, skippedLandline,
    total: rawEntries.length,
    autoSplit: true,
    groups: createdGroups,
  });
});

async function batchInsert(groupId: number, entries: { name: string; phone: string }[]) {
  for (let i = 0; i < entries.length; i += INSERT_BATCH) {
    const batch = entries.slice(i, i + INSERT_BATCH);
    await db.insert(contactsTable).values(batch.map(({ phone, name }) => ({ groupId, phone, name: name || null, status: "active" })));
  }
}

function cleanPhone(raw: string): string {
  let phone = raw.replace(/[\s\-\+\(\)\.]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
}

function isValidPhone(phone: string): boolean {
  return /^\d{7,15}$/.test(phone);
}

export default router;
