// ── The shop, its branches and its staff ──────────────────────────

import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, orgsTable, branchesTable, staffTable, usersTable, queuesTable } from "@workspace/db";
import { slugError, isValidSlug, vocab } from "@workspace/menu-shared";
import { requireAuth } from "../lib/auth";
import {
  tenant, withTenant, switchBranch, tenantErrorToResponse, signedInUser, attachOwner,
  OWNER, ALL, TenantError,
} from "../lib/tenancy/context";
import { createOrg, createBranch, slugTaken, suggestSlug, hasOwnNumber } from "../lib/tenancy/org";
import { menuPlan, assertWithinLimit, planErrorToResponse } from "../lib/plans";
import { getStatus } from "../lib/whatsapp";
import { publicUrl, menuPath, displayPath } from "../lib/menu/urls";
import { publish } from "../lib/realtime";
import { logger } from "../lib/logger";

const router = Router();

function waState(userId: number) {
  const s = getStatus(userId) as { connected?: boolean; status?: string; phone?: string | null };
  return { connected: !!s?.connected, status: s?.status ?? "disconnected", phone: s?.phone ?? null };
}

// ── Who am I ──────────────────────────────────────────────────────

router.get("/tenancy/me", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const t = await tenant(req);
    const person = t.staffId
      ? (await db.select({ id: staffTable.id, name: staffTable.name, username: staffTable.username }).from(staffTable).where(eq(staffTable.id, t.staffId)).limit(1))[0]
      : await signedInUser(req).then((u) => u && { id: u.id, name: u.displayName, phone: u.phone, isAdmin: u.isAdmin });
    const branches = await db.select().from(branchesTable).where(eq(branchesTable.orgId, t.org.id)).orderBy(asc(branchesTable.sort), asc(branchesTable.id));
    const plan = await menuPlan(t.org.ownerUserId);
    const { settingsFor } = await import("../lib/booking/service");
    const bk = await settingsFor(t.branch.id);
    res.json({
      booking: { enabled: bk.enabled && plan.features.booking },
      role: t.role,
      person,
      impersonating: !!req.session.impersonatorId,
      org: t.org,
      vocab: vocab(t.org.vertical),
      branch: { ...t.branch, ownNumber: hasOwnNumber(t.org, t.branch) },
      branches: branches
        .filter((b) => t.branchIds.includes(b.id) || t.role === "owner")
        .map((b) => ({
          id: b.id, name: b.name, nameEn: b.nameEn, slug: b.slug, isActive: b.isActive,
          ownNumber: hasOwnNumber(t.org, b), wa: waState(b.waUserId),
          menuUrl: publicUrl(menuPath(t.org.slug, b.slug)),
        })),
      plan,
      wa: waState(t.waUserId),
      links: {
        menu: publicUrl(menuPath(t.org.slug, t.branch.slug)),
        display: publicUrl(displayPath(t.branch.displayToken)),
      },
    });
  } catch (err) {
    if (err instanceof TenantError && (err.extra as any).needsOnboarding) {
      const u = await signedInUser(req);
      return res.json({ needsOnboarding: true, person: u && { id: u.id, name: u.displayName, phone: u.phone, isAdmin: u.isAdmin } });
    }
    if (tenantErrorToResponse(err, res)) return;
    throw err;
  }
});

router.post("/tenancy/branch", requireAuth, async (req, res) => {
  try {
    const b = await switchBranch(req, Number(req.body?.branchId));
    res.json({ ok: true, branchId: b.id });
  } catch (err) { if (!tenantErrorToResponse(err, res)) throw err; }
});

router.post("/tenancy/stop-impersonating", requireAuth, async (req, res) => {
  const adminId = req.session.impersonatorId;
  if (!adminId) return res.status(400).json({ error: "لست في وضع المعاينة" });
  delete req.session.impersonatorId;
  delete req.session.orgId; delete req.session.branchId;
  req.session.userId = adminId;
  req.session.isAdmin = true;
  await attachOwner(req, adminId);
  res.json({ ok: true });
});

// ── Onboarding ────────────────────────────────────────────────────

router.get("/onboarding/slug", requireAuth, async (req, res) => {
  const s = String(req.query.s ?? "").trim().toLowerCase();
  if (!s) return res.json({ ok: false, suggestion: await suggestSlug(String(req.query.name ?? ""), String(req.query.nameEn ?? "")) });
  const err = slugError(s);
  if (err) return res.json({ ok: false, error: err });
  const taken = await slugTaken(s);
  res.json({ ok: !taken, error: taken ? "مستخدم — اختر غيره" : null });
});

router.post("/onboarding/org", requireAuth, async (req, res) => {
  if (req.session.staffId) return res.status(403).json({ error: "غير مسموح" });
  const u = await signedInUser(req);
  if (!u) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
  try {
    const { org, branch } = await createOrg(u.id, req.body ?? {});
    await attachOwner(req, u.id);
    logger.info({ userId: u.id, orgId: org.id, slug: org.slug }, "org created");
    res.status(201).json({ org, branch, menuUrl: publicUrl(menuPath(org.slug)) });
  } catch (err) { if (!tenantErrorToResponse(err, res)) throw err; }
});

router.post("/onboarding/done", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  await db.update(orgsTable).set({ onboardedAt: new Date() }).where(eq(orgsTable.id, t.org.id));
  res.json({ ok: true });
}));

// ── The org ───────────────────────────────────────────────────────

const ORG_FIELDS = ["name", "nameEn", "tagline", "taglineEn", "about", "logoUrl", "coverUrl", "defaultLang", "currency", "timezone", "vertical"] as const;

router.patch("/org", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of ORG_FIELDS) if (k in b) patch[k] = b[k] === "" ? null : b[k];
  if ("name" in patch && String(patch.name ?? "").trim().length < 2) return res.status(400).json({ error: "اسم المحل مطلوب" });
  if ("defaultLang" in patch && !["ar", "en"].includes(String(patch.defaultLang))) delete patch.defaultLang;
  if ("vertical" in patch && !["restaurant", "cafe", "sweets", "beauty"].includes(String(patch.vertical))) delete patch.vertical;
  if ("currency" in patch && !/^[A-Z]{3}$/.test(String(patch.currency))) delete patch.currency;
  if ("timezone" in patch) {
    try { new Intl.DateTimeFormat("en", { timeZone: String(patch.timezone) }); } catch { delete patch.timezone; }
  }
  if (b.slug !== undefined && b.slug !== t.org.slug) {
    const s = String(b.slug).trim().toLowerCase();
    const err = slugError(s);
    if (err) return res.status(400).json({ error: err });
    if (await slugTaken(s, t.org.id)) return res.status(409).json({ error: "هذا الرابط مستخدم" });
    patch.slug = s;
  }
  if (b.theme && typeof b.theme === "object") {
    const tpl = ["noir", "cream", "clean", "rose"].includes(b.theme.template) ? b.theme.template : t.org.theme.template;
    const brand = /^#[0-9a-f]{6}$/i.test(String(b.theme.brand)) ? b.theme.brand : t.org.theme.brand;
    patch.theme = { template: tpl, brand, ...(b.theme.font ? { font: String(b.theme.font).slice(0, 40) } : {}) };
  }
  if (b.socials && typeof b.socials === "object") {
    const out: Record<string, string> = {};
    for (const k of ["instagram", "tiktok", "snapchat", "x", "facebook", "website", "google"]) {
      const v = String(b.socials[k] ?? "").trim();
      if (v) out[k] = v.slice(0, 200);
    }
    patch.socials = out;
  }
  for (const k of ["tagline", "taglineEn"]) if (typeof patch[k] === "string") patch[k] = (patch[k] as string).slice(0, 200);
  const [o] = await db.update(orgsTable).set(patch).where(eq(orgsTable.id, t.org.id)).returning();
  for (const b2 of await db.select({ id: branchesTable.id }).from(branchesTable).where(eq(branchesTable.orgId, t.org.id))) publish(`branch:${b2.id}`);
  res.json(o);
}));

// ── Branches ──────────────────────────────────────────────────────

router.get("/branches", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const rows = await db.select().from(branchesTable).where(eq(branchesTable.orgId, t.org.id)).orderBy(asc(branchesTable.sort), asc(branchesTable.id));
  res.json(rows.map((b) => ({
    ...b, ownNumber: hasOwnNumber(t.org, b), wa: waState(b.waUserId),
    menuUrl: publicUrl(menuPath(t.org.slug, b.slug)), displayUrl: publicUrl(displayPath(b.displayToken)),
  })));
}));

router.post("/branches", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const b = await createBranch(t.org, req.body ?? {});
  res.status(201).json(b);
}));

const BRANCH_FIELDS = ["name", "nameEn", "address", "mapUrl", "displayPhone", "isActive", "sort"] as const;

router.patch("/branches/:id", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const id = Number(req.params.id);
  const [cur] = await db.select().from(branchesTable).where(and(eq(branchesTable.id, id), eq(branchesTable.orgId, t.org.id))).limit(1);
  if (!cur) return res.status(404).json({ error: "الفرع غير موجود" });
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of BRANCH_FIELDS) if (k in b) patch[k] = b[k] === "" ? null : b[k];
  if ("waPhone" in b) {
    const p = String(b.waPhone ?? "").replace(/\D/g, "");
    patch.waPhone = p.length >= 8 && p.length <= 15 ? p : null;
  }
  if (b.slug !== undefined && b.slug !== cur.slug) {
    const s = String(b.slug).trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s)) return res.status(400).json({ error: "رابط الفرع: أحرف إنجليزية صغيرة وأرقام وشرطة" });
    const [dup] = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(eq(branchesTable.orgId, t.org.id), eq(branchesTable.slug, s), ne(branchesTable.id, id))).limit(1);
    if (dup) return res.status(409).json({ error: "رابط فرع آخر" });
    patch.slug = s;
  }
  if (b.hours && typeof b.hours === "object") {
    const h: Record<string, unknown> = {};
    for (const d of ["0", "1", "2", "3", "4", "5", "6"]) {
      const v = b.hours[d];
      if (!v) continue;
      const ok = (x: unknown) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x));
      if (v.closed) h[d] = { open: "00:00", close: "00:00", closed: true };
      else if (ok(v.open) && ok(v.close)) h[d] = { open: v.open, close: v.close };
    }
    patch.hours = h;
  }
  if (patch.isActive === false) {
    const active = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(eq(branchesTable.orgId, t.org.id), eq(branchesTable.isActive, true)));
    if (active.length <= 1 && active[0]?.id === id) return res.status(400).json({ error: "لا يمكن إيقاف الفرع الوحيد" });
  }
  const [u] = await db.update(branchesTable).set(patch).where(eq(branchesTable.id, id)).returning();
  publish(`branch:${id}`);
  res.json(u);
}));

router.post("/branches/:id/rotate-display", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const { token } = await import("../lib/tenancy/org");
  const [u] = await db.update(branchesTable).set({ displayToken: token(18) })
    .where(and(eq(branchesTable.id, Number(req.params.id)), eq(branchesTable.orgId, t.org.id))).returning();
  if (!u) return res.status(404).json({ error: "الفرع غير موجود" });
  res.json({ displayUrl: publicUrl(displayPath(u.displayToken)) });
}));

// ── Staff ─────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

router.get("/staff", requireAuth, withTenant(OWNER, async (_req, res, t) => {
  const rows = await db.select({
    id: staffTable.id, name: staffTable.name, username: staffTable.username, role: staffTable.role,
    branchId: staffTable.branchId, isActive: staffTable.isActive, lastLoginAt: staffTable.lastLoginAt, createdAt: staffTable.createdAt,
  }).from(staffTable).where(eq(staffTable.orgId, t.org.id)).orderBy(asc(staffTable.id));
  res.json({ staff: rows, loginUrl: publicUrl(`/staff-login?shop=${t.org.slug}`), shop: t.org.slug });
}));

router.post("/staff", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const b = req.body ?? {};
  const username = String(b.username ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "اسم الدخول: 3 أحرف إنجليزية صغيرة أو أرقام على الأقل" });
  if (String(b.password ?? "").length < 6) return res.status(400).json({ error: "كلمة المرور 6 أحرف على الأقل" });
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "اكتب اسم الموظف" });
  const branchId = b.branchId ? Number(b.branchId) : null;
  if (branchId) {
    const [br] = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(eq(branchesTable.id, branchId), eq(branchesTable.orgId, t.org.id))).limit(1);
    if (!br) return res.status(400).json({ error: "الفرع غير موجود" });
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(staffTable).where(and(eq(staffTable.orgId, t.org.id), eq(staffTable.isActive, true)));
  await assertWithinLimit(t.org.ownerUserId, "staff", n);
  const [dup] = await db.select({ id: staffTable.id }).from(staffTable).where(and(eq(staffTable.orgId, t.org.id), eq(staffTable.username, username))).limit(1);
  if (dup) return res.status(409).json({ error: "اسم الدخول مستخدم" });
  const [s] = await db.insert(staffTable).values({
    orgId: t.org.id, branchId, name, username, passwordHash: await bcrypt.hash(String(b.password), 10),
    role: b.role === "manager" ? "manager" : "staff",
  }).returning({ id: staffTable.id, name: staffTable.name, username: staffTable.username, role: staffTable.role, branchId: staffTable.branchId, isActive: staffTable.isActive });
  res.status(201).json(s);
}));

router.patch("/staff/:id", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const id = Number(req.params.id);
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 120);
  if (b.role === "manager" || b.role === "staff") patch.role = b.role;
  if ("branchId" in b) patch.branchId = b.branchId ? Number(b.branchId) : null;
  if (typeof b.isActive === "boolean") patch.isActive = b.isActive;
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: "كلمة المرور 6 أحرف على الأقل" });
    patch.passwordHash = await bcrypt.hash(String(b.password), 10);
  }
  const [u] = await db.update(staffTable).set(patch).where(and(eq(staffTable.id, id), eq(staffTable.orgId, t.org.id)))
    .returning({ id: staffTable.id, name: staffTable.name, username: staffTable.username, role: staffTable.role, branchId: staffTable.branchId, isActive: staffTable.isActive });
  if (!u) return res.status(404).json({ error: "الموظف غير موجود" });
  res.json(u);
}));

router.delete("/staff/:id", requireAuth, withTenant(OWNER, async (req, res, t) => {
  await db.delete(staffTable).where(and(eq(staffTable.id, Number(req.params.id)), eq(staffTable.orgId, t.org.id)));
  res.json({ ok: true });
}));

// ── Staff sign-in ─────────────────────────────────────────────────
// Shop + username + password. The session that results is a staff session:
// staffGuard (lib/tenancy/context.ts) lets it reach the queue, the orders and
// the bookings, and nothing else.

router.post("/staff-auth/login", async (req, res) => {
  const shop = String(req.body?.shop ?? "").trim().toLowerCase();
  const username = String(req.body?.username ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!shop || !username || !password) return res.status(400).json({ error: "رابط المحل واسم الدخول وكلمة المرور مطلوبة" });
  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.slug, shop)).limit(1);
  const bad = () => res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  if (!org || org.status !== "active") return bad();
  const [st] = await db.select().from(staffTable).where(and(eq(staffTable.orgId, org.id), eq(staffTable.username, username))).limit(1);
  if (!st || !st.isActive) return bad();
  if (!(await bcrypt.compare(password, st.passwordHash))) return bad();
  const branches = await db.select().from(branchesTable)
    .where(and(eq(branchesTable.orgId, org.id), eq(branchesTable.isActive, true))).orderBy(asc(branchesTable.sort), asc(branchesTable.id));
  const branch = st.branchId ? branches.find((b) => b.id === st.branchId) : branches[0];
  if (!branch) return res.status(409).json({ error: "فرع هذا الموظف غير مفعّل" });

  await new Promise<void>((ok, fail) => req.session.regenerate((e) => (e ? fail(e) : ok())));
  req.session.userId = branch.waUserId;
  req.session.isAdmin = false;
  req.session.staffId = st.id;
  req.session.role = st.role === "manager" ? "manager" : "staff";
  req.session.orgId = org.id;
  req.session.branchId = branch.id;
  await db.update(staffTable).set({ lastLoginAt: new Date() }).where(eq(staffTable.id, st.id));
  logger.info({ staffId: st.id, orgId: org.id }, "staff signed in");
  res.json({ ok: true, role: req.session.role, name: st.name });
});

// Queues of the current branch, for the switcher on every staff screen.
router.get("/tenancy/queues", requireAuth, withTenant(ALL, async (_req, res, t) => {
  const qs = await db.select().from(queuesTable).where(and(eq(queuesTable.branchId, t.branch.id), eq(queuesTable.isActive, true))).orderBy(asc(queuesTable.sort), asc(queuesTable.id));
  res.json(qs);
}));

export default router;
