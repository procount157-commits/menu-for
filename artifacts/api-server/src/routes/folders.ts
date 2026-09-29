// ── Folders for lists ─────────────────────────────────────────────
// One set of routes for both kinds: WhatsApp number lists (kind "wa") and
// email lists (kind "email"). A list is in one folder or none; deleting a
// folder leaves its lists where they were, unfoldered.
//
// Auto-sort puts every unfoldered list into a folder named after its
// sector: from the list's own name first ("شركات نظافه" is cleaning), and
// otherwise from what most of the companies in it are.

import { Router } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, listFoldersTable, contactGroupsTable, contactsTable, emailListsTable, emailListMembersTable, emailContactsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { classifySector } from "../lib/email/sector";

const router = Router();
router.use(requireAuth);

const kindOf = (v: unknown) => (v === "email" ? "email" : "wa") as "wa" | "email";
const listTable = (kind: "wa" | "email") => (kind === "email" ? emailListsTable : contactGroupsTable);

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const kind = kindOf(req.query["kind"]);
  const t = listTable(kind);
  const [folders, counts] = await Promise.all([
    db.select().from(listFoldersTable).where(and(eq(listFoldersTable.userId, userId), eq(listFoldersTable.kind, kind))).orderBy(asc(listFoldersTable.sort), asc(listFoldersTable.id)),
    db.select({ folderId: t.folderId, n: sql<number>`count(*)` }).from(t).where(eq(t.userId, userId)).groupBy(t.folderId),
  ]);
  const byFolder = new Map(counts.map((c) => [c.folderId, Number(c.n)]));
  res.json({ folders: folders.map((f) => ({ ...f, lists: byFolder.get(f.id) ?? 0 })), unfoldered: byFolder.get(null) ?? 0 });
});

router.post("/", async (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "اكتب اسم المجلد" });
  const [f] = await db.insert(listFoldersTable).values({ userId: req.session.userId!, kind: kindOf(req.body?.kind), name, color: req.body?.color ?? null }).returning();
  res.status(201).json(f);
});

router.patch("/:id", async (req, res) => {
  const set: Record<string, unknown> = {};
  if (typeof req.body?.name === "string" && req.body.name.trim()) set["name"] = req.body.name.trim().slice(0, 120);
  if (req.body?.color !== undefined) set["color"] = req.body.color;
  if (req.body?.sort !== undefined) set["sort"] = Number(req.body.sort) || 0;
  const [f] = await db.update(listFoldersTable).set(set).where(and(eq(listFoldersTable.id, Number(req.params.id)), eq(listFoldersTable.userId, req.session.userId!))).returning();
  res.json(f ?? null);
});

/** The lists stay; they just leave the folder. */
router.delete("/:id", async (req, res) => {
  await db.delete(listFoldersTable).where(and(eq(listFoldersTable.id, Number(req.params.id)), eq(listFoldersTable.userId, req.session.userId!)));
  res.json({ ok: true });
});

/** Put lists into a folder, or none (`folderId: null`). */
router.post("/move", async (req, res) => {
  const userId = req.session.userId!;
  const kind = kindOf(req.body?.kind);
  const t = listTable(kind);
  const ids: number[] = (Array.isArray(req.body?.listIds) ? req.body.listIds : [req.body?.listId]).map(Number).filter(Boolean);
  const folderId = req.body?.folderId ? Number(req.body.folderId) : null;
  if (folderId) {
    const [f] = await db.select().from(listFoldersTable).where(and(eq(listFoldersTable.id, folderId), eq(listFoldersTable.userId, userId), eq(listFoldersTable.kind, kind))).limit(1);
    if (!f) return res.status(404).json({ error: "المجلد غير موجود" });
  }
  if (!ids.length) return res.status(400).json({ error: "لم تختر قائمة" });
  await db.update(t).set({ folderId }).where(and(eq(t.userId, userId), inArray(t.id, ids)));
  res.json({ moved: ids.length });
});

/** Every unfoldered list into a folder named after its sector. */
router.post("/auto", async (req, res) => {
  const userId = req.session.userId!;
  const kind = kindOf(req.body?.kind);
  const all = req.body?.all === true;           // re-sort lists already in folders too

  const lists = kind === "email"
    ? await db.select({ id: emailListsTable.id, name: emailListsTable.name }).from(emailListsTable).where(and(eq(emailListsTable.userId, userId), all ? sql`true` : isNull(emailListsTable.folderId)))
    : await db.select({ id: contactGroupsTable.id, name: contactGroupsTable.name }).from(contactGroupsTable).where(and(eq(contactGroupsTable.userId, userId), all ? sql`true` : isNull(contactGroupsTable.folderId)));

  const decided: Array<{ id: number; name: string; sector: string | null }> = [];
  for (const l of lists) {
    let sector = classifySector({ company: l.name });
    if (!sector) {
      // What most of the companies in it are.
      const names = kind === "email"
        ? (await db.select({ company: emailContactsTable.company, sector: emailContactsTable.sector }).from(emailListMembersTable)
            .innerJoin(emailContactsTable, eq(emailContactsTable.id, emailListMembersTable.contactId)).where(eq(emailListMembersTable.listId, l.id)).limit(300))
            .map((r) => r.sector ?? classifySector({ company: r.company }))
        : (await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.groupId, l.id)).limit(300))
            .map((r) => classifySector({ company: r.name }));
      const tally = new Map<string, number>();
      for (const s of names) if (s) tally.set(s, (tally.get(s) ?? 0) + 1);
      const top = [...tally].sort((a, b) => b[1] - a[1])[0];
      // A majority, and of enough companies to mean it.
      if (top && top[1] >= 5 && top[1] >= names.length * 0.4) sector = top[0];
    }
    decided.push({ id: l.id, name: l.name, sector });
  }

  const existing = await db.select().from(listFoldersTable).where(and(eq(listFoldersTable.userId, userId), eq(listFoldersTable.kind, kind)));
  const folderFor = new Map(existing.map((f) => [f.name, f.id]));
  const moved: Array<{ list: string; folder: string }> = [];
  for (const d of decided) {
    if (!d.sector) continue;
    if (!folderFor.has(d.sector)) {
      const [f] = await db.insert(listFoldersTable).values({ userId, kind, name: d.sector }).returning();
      folderFor.set(d.sector, f!.id);
    }
    const t = listTable(kind);
    await db.update(t).set({ folderId: folderFor.get(d.sector)! }).where(eq(t.id, d.id));
    moved.push({ list: d.name, folder: d.sector });
  }
  res.json({ checked: lists.length, moved, unsorted: decided.filter((d) => !d.sector).map((d) => d.name) });
});

export default router;
