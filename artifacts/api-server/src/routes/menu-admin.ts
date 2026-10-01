// ── /api/menu — the owner's menu editor ───────────────────────────

import { Router } from "express";
import multer from "multer";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, menuCategoriesTable, menuItemsTable, branchItemOverridesTable, offersTable,
  type OptionGroup,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, MANAGERS, ALL, type Tenant } from "../lib/tenancy/context";
import { storeImage, ImageError, MAX_UPLOAD_BYTES } from "../lib/menu/images";
import { branchItems, itemCount } from "../lib/menu/service";
import { assertWithinLimit } from "../lib/plans";
import { publish } from "../lib/realtime";
import { syncMenuKnowledge } from "../lib/menu/knowledge-sync";
import { importMenuFile, importMenuFromImage, translateMenu, saveRows } from "../lib/menu/import";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const changed = (t: Tenant) => {
  publish(`branch:${t.branch.id}`);
  syncMenuKnowledge(t.org.id).catch(() => {});
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : v === null ? null : undefined);
const money = (v: unknown) => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n.toFixed(2) : undefined;
};

/** Option groups as the editor sends them, cleaned and bounded. */
export function cleanOptions(v: unknown): OptionGroup[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 12).map((g: any) => {
    const choices = (Array.isArray(g?.choices) ? g.choices : []).slice(0, 30)
      .map((c: any) => ({ name: String(c?.name ?? "").trim().slice(0, 80), nameEn: String(c?.nameEn ?? "").trim().slice(0, 80) || undefined, priceDelta: Number(c?.priceDelta) || 0 }))
      .filter((c: { name: string }) => c.name);
    const required = !!g?.required;
    const max = Math.max(0, Math.min(choices.length, Math.floor(Number(g?.max) || (required ? 1 : choices.length))));
    const min = Math.max(required ? 1 : 0, Math.min(max || choices.length, Math.floor(Number(g?.min) || 0)));
    return { name: String(g?.name ?? "").trim().slice(0, 80), nameEn: String(g?.nameEn ?? "").trim().slice(0, 80) || undefined, required, min, max, choices };
  }).filter((g) => g.name && g.choices.length);
}

const TAGS = new Set(["new", "popular", "spicy", "vegetarian", "vegan", "chef", "preorder", "gluten_free", "offer"]);

function itemPatch(b: any) {
  const p: Record<string, unknown> = {};
  for (const [k, max] of [["name", 160], ["nameEn", 160], ["description", 1200], ["descriptionEn", 1200]] as const) {
    const v = str(b[k], max);
    if (v !== undefined) p[k] = v || (k === "name" ? undefined : null);
  }
  if ("price" in b) { const m = money(b.price); if (m) p.price = m; }
  if ("compareAtPrice" in b) { const m = money(b.compareAtPrice); if (m !== undefined) p.compareAtPrice = m; }
  if ("categoryId" in b) p.categoryId = b.categoryId ? Number(b.categoryId) : null;
  if (b.kind === "product" || b.kind === "service") p.kind = b.kind;
  if ("durationMin" in b) p.durationMin = b.durationMin ? Math.max(5, Math.min(600, Math.floor(Number(b.durationMin)))) : null;
  if ("calories" in b) p.calories = b.calories ? Math.max(0, Math.min(10000, Math.floor(Number(b.calories)))) : null;
  if (Array.isArray(b.tags)) p.tags = b.tags.filter((x: unknown) => TAGS.has(String(x)));
  if (Array.isArray(b.allergens)) p.allergens = b.allergens.map((x: unknown) => String(x).slice(0, 30)).slice(0, 14);
  if (Array.isArray(b.images)) p.images = b.images.slice(0, 6).filter((i: any) => typeof i?.url === "string" && i.url.startsWith("/api/media/file/"))
    .map((i: any) => ({ url: i.url, sm: i.sm, md: i.md, blur: typeof i.blur === "string" && i.blur.length < 4000 ? i.blur : undefined }));
  const o = cleanOptions(b.options);
  if (o) p.options = o;
  if (typeof b.isActive === "boolean") p.isActive = b.isActive;
  if (Number.isFinite(Number(b.sort)) && "sort" in b) p.sort = Math.floor(Number(b.sort));
  return p;
}

async function ownCategory(orgId: number, id: unknown) {
  if (!id) return true;
  const [c] = await db.select({ id: menuCategoriesTable.id }).from(menuCategoriesTable).where(and(eq(menuCategoriesTable.id, Number(id)), eq(menuCategoriesTable.orgId, orgId))).limit(1);
  return !!c;
}

// ── Categories ────────────────────────────────────────────────────

router.get("/categories", requireAuth, withTenant(ALL, async (_req, res, t) => {
  res.json(await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, t.org.id)).orderBy(asc(menuCategoriesTable.sort), asc(menuCategoriesTable.id)));
}));

router.post("/categories", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const name = str(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: "اسم التصنيف مطلوب" });
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(sort), -1)::int` }).from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, t.org.id));
  const [c] = await db.insert(menuCategoriesTable).values({ orgId: t.org.id, name, nameEn: str(req.body?.nameEn, 120) || null, imageUrl: str(req.body?.imageUrl, 500) || null, sort: m + 1 }).returning();
  changed(t);
  res.status(201).json(c);
}));

router.patch("/categories/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const b = req.body ?? {};
  const p: Record<string, unknown> = {};
  if (str(b.name, 120)) p.name = str(b.name, 120);
  if ("nameEn" in b) p.nameEn = str(b.nameEn, 120) || null;
  if ("imageUrl" in b) p.imageUrl = str(b.imageUrl, 500) || null;
  if (typeof b.isActive === "boolean") p.isActive = b.isActive;
  const [c] = await db.update(menuCategoriesTable).set(p).where(and(eq(menuCategoriesTable.id, Number(req.params.id)), eq(menuCategoriesTable.orgId, t.org.id))).returning();
  if (!c) return res.status(404).json({ error: "التصنيف غير موجود" });
  changed(t);
  res.json(c);
}));

router.delete("/categories/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  // Its items stay, uncategorised, rather than vanishing with it.
  await db.delete(menuCategoriesTable).where(and(eq(menuCategoriesTable.id, Number(req.params.id)), eq(menuCategoriesTable.orgId, t.org.id)));
  changed(t);
  res.json({ ok: true });
}));

router.post("/categories/reorder", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite);
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.update(menuCategoriesTable).set({ sort: i }).where(and(eq(menuCategoriesTable.id, id), eq(menuCategoriesTable.orgId, t.org.id)));
  });
  changed(t);
  res.json({ ok: true });
}));

// ── Items ─────────────────────────────────────────────────────────

router.get("/items", requireAuth, withTenant(ALL, async (_req, res, t) => {
  const all = await db.select().from(menuItemsTable).where(eq(menuItemsTable.orgId, t.org.id)).orderBy(asc(menuItemsTable.sort), asc(menuItemsTable.id));
  const ov = all.length ? await db.select().from(branchItemOverridesTable).where(and(eq(branchItemOverridesTable.branchId, t.branch.id), inArray(branchItemOverridesTable.itemId, all.map((i) => i.id)))) : [];
  const by = new Map(ov.map((o) => [o.itemId, o]));
  res.json(all.map((i) => ({
    ...i, price: Number(i.price), compareAtPrice: i.compareAtPrice == null ? null : Number(i.compareAtPrice),
    branch: { available: by.get(i.id)?.isAvailable ?? true, price: by.get(i.id)?.price == null ? null : Number(by.get(i.id)!.price) },
  })));
}));

router.post("/items", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const p = itemPatch(req.body ?? {});
  if (!p.name) return res.status(400).json({ error: "اسم الصنف مطلوب" });
  if (!(await ownCategory(t.org.id, p.categoryId))) return res.status(400).json({ error: "التصنيف غير موجود" });
  await assertWithinLimit(t.org.ownerUserId, "items", await itemCount(t.org.id));
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(sort), -1)::int` }).from(menuItemsTable).where(eq(menuItemsTable.orgId, t.org.id));
  const [i] = await db.insert(menuItemsTable).values({ orgId: t.org.id, sort: m + 1, ...p } as any).returning();
  changed(t);
  res.status(201).json(i);
}));

router.patch("/items/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const p = itemPatch(req.body ?? {});
  if ("categoryId" in p && !(await ownCategory(t.org.id, p.categoryId))) return res.status(400).json({ error: "التصنيف غير موجود" });
  const [i] = await db.update(menuItemsTable).set({ ...p, updatedAt: new Date() }).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.orgId, t.org.id))).returning();
  if (!i) return res.status(404).json({ error: "الصنف غير موجود" });
  changed(t);
  res.json(i);
}));

router.delete("/items/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  await db.delete(menuItemsTable).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.orgId, t.org.id)));
  changed(t);
  res.json({ ok: true });
}));

router.post("/items/:id/duplicate", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const [i] = await db.select().from(menuItemsTable).where(and(eq(menuItemsTable.id, Number(req.params.id)), eq(menuItemsTable.orgId, t.org.id))).limit(1);
  if (!i) return res.status(404).json({ error: "الصنف غير موجود" });
  await assertWithinLimit(t.org.ownerUserId, "items", await itemCount(t.org.id));
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = i;
  const [n] = await db.insert(menuItemsTable).values({ ...rest, name: `${i.name} (نسخة)`, sort: i.sort + 1 }).returning();
  changed(t);
  res.status(201).json(n);
}));

router.post("/items/reorder", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite);
  const categoryId = req.body?.categoryId === undefined ? undefined : (req.body.categoryId ? Number(req.body.categoryId) : null);
  if (categoryId !== undefined && !(await ownCategory(t.org.id, categoryId))) return res.status(400).json({ error: "التصنيف غير موجود" });
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.update(menuItemsTable).set({ sort: i, ...(categoryId !== undefined ? { categoryId } : {}) }).where(and(eq(menuItemsTable.id, id), eq(menuItemsTable.orgId, t.org.id)));
    }
  });
  changed(t);
  res.json({ ok: true });
}));

/** «خلص / متوفر», and a branch's own price — staff can do the first. */
router.patch("/availability", requireAuth, withTenant(ALL, async (req, res, t) => {
  const itemId = Number(req.body?.itemId);
  const [i] = await db.select({ id: menuItemsTable.id }).from(menuItemsTable).where(and(eq(menuItemsTable.id, itemId), eq(menuItemsTable.orgId, t.org.id))).limit(1);
  if (!i) return res.status(404).json({ error: "الصنف غير موجود" });
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.available === "boolean") set.isAvailable = req.body.available;
  if ("price" in (req.body ?? {}) && t.role !== "staff") set.price = money(req.body.price) ?? null;
  await db.insert(branchItemOverridesTable).values({ branchId: t.branch.id, itemId, isAvailable: set.isAvailable as boolean ?? true, price: (set.price as string | null) ?? null })
    .onConflictDoUpdate({ target: [branchItemOverridesTable.branchId, branchItemOverridesTable.itemId], set });
  publish(`branch:${t.branch.id}`);
  res.json({ ok: true });
}));

// ── Images ────────────────────────────────────────────────────────

router.post("/images", requireAuth, upload.single("file"), withTenant(MANAGERS, async (req, res) => {
  const f = (req as any).file as Express.Multer.File | undefined;
  if (!f) return res.status(400).json({ error: "اختر صورة" });
  const kind = ["logo", "cover", "offer", "menu"].includes(String(req.query.kind)) ? String(req.query.kind) as "logo" : "menu";
  try { res.json(await storeImage(f.buffer, kind)); }
  catch (err) { if (err instanceof ImageError) return res.status(400).json({ error: err.message }); throw err; }
}));

// ── Offers ────────────────────────────────────────────────────────

function offerPatch(b: any) {
  const p: Record<string, unknown> = {};
  for (const [k, max] of [["title", 160], ["titleEn", 160], ["body", 600], ["bodyEn", 600], ["imageUrl", 500]] as const) {
    const v = str(b[k], max);
    if (v !== undefined) p[k] = v || (k === "title" ? undefined : null);
  }
  if ("branchId" in b) p.branchId = b.branchId ? Number(b.branchId) : null;
  if ("itemId" in b) p.itemId = b.itemId ? Number(b.itemId) : null;
  for (const k of ["startsAt", "endsAt"]) if (k in b) p[k] = b[k] ? new Date(b[k]) : null;
  if (typeof b.isActive === "boolean") p.isActive = b.isActive;
  if ("sort" in b) p.sort = Math.floor(Number(b.sort) || 0);
  return p;
}

router.get("/offers", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  res.json(await db.select().from(offersTable).where(eq(offersTable.orgId, t.org.id)).orderBy(asc(offersTable.sort), asc(offersTable.id)));
}));

router.post("/offers", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const p = offerPatch(req.body ?? {});
  if (!p.title) return res.status(400).json({ error: "عنوان العرض مطلوب" });
  const [o] = await db.insert(offersTable).values({ orgId: t.org.id, ...p } as any).returning();
  changed(t);
  res.status(201).json(o);
}));

router.patch("/offers/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const [o] = await db.update(offersTable).set(offerPatch(req.body ?? {})).where(and(eq(offersTable.id, Number(req.params.id)), eq(offersTable.orgId, t.org.id))).returning();
  if (!o) return res.status(404).json({ error: "العرض غير موجود" });
  changed(t);
  res.json(o);
}));

router.delete("/offers/:id", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  await db.delete(offersTable).where(and(eq(offersTable.id, Number(req.params.id)), eq(offersTable.orgId, t.org.id)));
  changed(t);
  res.json({ ok: true });
}));

// ── Import ────────────────────────────────────────────────────────

const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/** Excel or CSV: one row per item. `?dry=1` previews without saving. */
router.post("/import", requireAuth, fileUpload.single("file"), withTenant(MANAGERS, async (req, res, t) => {
  const f = (req as any).file as Express.Multer.File | undefined;
  if (!f) return res.status(400).json({ error: "اختر ملف Excel أو CSV" });
  const r = await importMenuFile(t, f.buffer, f.originalname, { dry: req.query.dry === "1" });
  if (!r.dry) changed(t);
  res.json(r);
}));

/** A photo or PDF of the paper menu, read by the model into items for review. */
router.post("/import-photo", requireAuth, fileUpload.single("file"), withTenant(MANAGERS, async (req, res, t) => {
  const f = (req as any).file as Express.Multer.File | undefined;
  if (!f) return res.status(400).json({ error: "اختر صورة المنيو أو ملف PDF" });
  res.json(await importMenuFromImage(t, f.buffer, f.mimetype, f.originalname));
}));

/** Save the rows the owner kept from a photo or sheet preview. */
router.post("/import-rows", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 500).map((r: any) => ({
    category: typeof r?.category === "string" && r.category.trim() ? r.category.trim().slice(0, 120) : null,
    name: String(r?.name ?? "").trim().slice(0, 160),
    nameEn: typeof r?.nameEn === "string" && r.nameEn.trim() ? r.nameEn.trim().slice(0, 160) : null,
    price: Number(r?.price),
    description: typeof r?.description === "string" && r.description.trim() ? r.description.trim().slice(0, 1200) : null,
    descriptionEn: typeof r?.descriptionEn === "string" && r.descriptionEn.trim() ? r.descriptionEn.trim().slice(0, 1200) : null,
    durationMin: Number(r?.durationMin) > 0 ? Math.round(Number(r.durationMin)) : null,
    calories: null,
  })).filter((r: { name: string; price: number }) => r.name && Number.isFinite(r.price) && r.price >= 0);
  if (!rows.length) return res.status(400).json({ error: "لا توجد أصناف صالحة للحفظ" });
  const saved = await saveRows(t, rows);
  changed(t);
  res.json({ saved });
}));

router.post("/translate", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const r = await translateMenu(t, { onlyMissing: req.body?.onlyMissing !== false });
  changed(t);
  res.json(r);
}));

router.get("/branch-items", requireAuth, withTenant(ALL, async (_req, res, t) => {
  res.json(await branchItems(t.org, t.branch.id));
}));

export default router;
