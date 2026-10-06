// ── /api/admin/orgs — the platform owner's view of every shop ─────

import { messagingSettings, saveMessaging, withStopButton } from "../lib/wa-buttons";
import { Router } from "express";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, orgsTable, branchesTable, usersTable, llmKeysTable, platformSettingsTable, PLAN_LIMITS } from "@workspace/db";
import { testKey, invalidateChannelKeys, KEY_PROVIDERS } from "../lib/llm";
import { requireAdmin } from "../lib/auth";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { attachOwner, TenantError } from "../lib/tenancy/context";
import { createOrg } from "../lib/tenancy/org";
import { getStatus, sendButtonTest } from "../lib/whatsapp";
import { publicUrl, menuPath } from "../lib/menu/urls";
import { logger } from "../lib/logger";
import { churnRisk } from "../lib/growth/churn";
import { trialSettings, cleanTrialSettings, invalidateSettings, loadPlans } from "../lib/plans";
import { LIMITS } from "@workspace/menu-shared";
import { platformMetrics } from "../lib/growth/platform-metrics";
import { rewardShopReferral, setReferredBy } from "../lib/growth/shop-referrals";

const router = Router();
router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const { rows } = await db.execute<any>(sql`
    SELECT o.id, o.name, o.slug, o.vertical, o.status, o.created_at, o.onboarded_at, o.features,
      u.id AS owner_id, u.phone AS owner_phone, u.display_name AS owner_name, u.plan, u.plan_expires_at, u.last_login_at,
      (SELECT count(*)::int FROM branches b WHERE b.org_id = o.id) AS branches,
      (SELECT count(*)::int FROM menu_items i WHERE i.org_id = o.id) AS items,
      (SELECT count(*)::int FROM staff s WHERE s.org_id = o.id) AS staff,
      (SELECT count(*)::int FROM queue_tickets t WHERE t.org_id = o.id AND t.joined_at > now() - interval '7 days') AS tickets_7d,
      (SELECT count(*)::int FROM orders r WHERE r.org_id = o.id AND r.created_at > now() - interval '7 days' AND r.status NOT IN ('pending','cancelled')) AS orders_7d,
      (SELECT count(*)::int FROM bookings k WHERE k.org_id = o.id AND k.created_at > now() - interval '7 days') AS bookings_7d,
      (SELECT count(*)::int FROM customers c WHERE c.org_id = o.id) AS customers,
      (SELECT count(*)::int FROM notifications n WHERE n.org_id = o.id AND n.status = 'sent' AND n.sent_at > now() - interval '7 days') AS sent_7d,
      (SELECT name FROM orgs x WHERE x.id = o.referred_by_org_id) AS referred_by, o.referral_rewarded_at,
      (SELECT count(*)::int FROM orgs y WHERE y.referred_by_org_id = o.id) AS brought,
      o.message_credits, o.limit_overrides, o.trial_extended_at,
      coalesce((SELECT messages FROM org_usage x WHERE x.org_id = o.id AND x.month = to_char(now() AT TIME ZONE o.timezone, 'YYYY-MM')), 0) AS messages_month
    FROM orgs o JOIN users u ON u.id = o.owner_user_id
    ORDER BY o.created_at DESC`);
  const branches = await db.select({ orgId: branchesTable.orgId, waUserId: branchesTable.waUserId }).from(branchesTable);
  const waByOrg = new Map<number, { linked: number; total: number }>();
  for (const b of branches) {
    const w = waByOrg.get(b.orgId) ?? { linked: 0, total: 0 };
    w.total++;
    if ((getStatus(b.waUserId) as { connected?: boolean })?.connected) w.linked++;
    waByOrg.set(b.orgId, w);
  }
  res.json(rows.map((r: any) => {
    const wa = waByOrg.get(r.id) ?? { linked: 0, total: 0 };
    return { ...r, wa, menuUrl: publicUrl(menuPath(r.slug)), risk: churnRisk({ ...r, wa }) };
  }));
});

/**
 * Create a shop for a customer: the owner's account and the shop in one step,
 * on the plan that was sold. The owner signs in with the phone and password
 * given here and lands in a shop that already exists.
 */
router.post("/", async (req, res) => {
  const b = req.body ?? {};
  const phone = String(b.ownerPhone ?? "").replace(/[\s\-+()]/g, "").replace(/^00/, "");
  if (!/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: "رقم جوال صاحب المحل غير صالح" });
  if (String(b.password ?? "").length < 6) return res.status(400).json({ error: "كلمة المرور 6 أحرف على الأقل" });
  if (String(b.name ?? "").trim().length < 2) return res.status(400).json({ error: "اكتب اسم المحل" });
  const [dup] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  if (dup) return res.status(409).json({ error: "هذا الرقم مسجّل مسبقاً — ابحث عن محله في القائمة" });
  const plans = await loadPlans();
  const plan = typeof b.plan === "string" && plans.has(b.plan) ? b.plan : "free";
  const days = Number(b.planDays);
  const [user] = await db.insert(usersTable).values({
    phone, passwordHash: await bcrypt.hash(String(b.password), 10),
    displayName: String(b.ownerName ?? "").trim() || null, isAdmin: false, status: "active",
    plan, planExpiresAt: days > 0 ? new Date(Date.now() + days * 24 * 3_600_000) : null,
    connectToken: randomUUID(),
  }).returning();
  try {
    const { org, branch } = await createOrg(user!.id, {
      name: b.name, nameEn: b.nameEn, vertical: b.vertical, slug: b.slug || undefined,
      address: b.address, displayPhone: b.displayPhone,
    });
    // Brought by another shop: remember it, and reward both if it starts on a paid plan.
    if (b.referralCode && (await setReferredBy(org.id, b.referralCode)) && plan !== "free" && days > 0) await rewardShopReferral(org.id);
    await db.update(orgsTable).set({ onboardedAt: new Date() }).where(eq(orgsTable.id, org.id));
    logger.info({ orgId: org.id, ownerId: user!.id, plan }, "admin created shop");
    res.status(201).json({ org, branchId: branch.id, ownerPhone: phone, menuUrl: publicUrl(menuPath(org.slug)), loginUrl: publicUrl("/login") });
  } catch (err) {
    // No half-made account: the owner row goes if the shop could not be made.
    await db.delete(usersTable).where(eq(usersTable.id, user!.id));
    if (err instanceof TenantError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// ── Model keys per channel ────────────────────────────────────────
// The key itself is never returned — only its last four characters.

const mask = (k: string) => `••••${k.slice(-4)}`;

router.get("/llm-keys", async (_req, res) => {
  const rows = await db.select().from(llmKeysTable).orderBy(asc(llmKeysTable.channel), asc(llmKeysTable.sort), asc(llmKeysTable.id));
  res.json({
    providers: KEY_PROVIDERS,
    keys: rows.map((r) => ({ id: r.id, channel: r.channel, provider: r.provider, model: r.model, label: r.label, isActive: r.isActive, sort: r.sort, key: mask(r.apiKey), createdAt: r.createdAt })),
  });
});

router.post("/llm-keys", async (req, res) => {
  const b = req.body ?? {};
  const channel = b.channel === "email" ? "email" : b.channel === "whatsapp" ? "whatsapp" : null;
  const provider = String(b.provider ?? "").trim().toLowerCase();
  const apiKey = String(b.apiKey ?? "").trim();
  if (!channel) return res.status(400).json({ error: "اختر القناة: واتساب أو البريد" });
  if (!KEY_PROVIDERS.includes(provider)) return res.status(400).json({ error: "مزوّد غير مدعوم" });
  if (apiKey.length < 10) return res.status(400).json({ error: "المفتاح غير صالح" });
  const model = String(b.model ?? "").trim() || null;
  // A key that stores but cannot answer is worse than none: check it first.
  try { await testKey(provider, apiKey, model); }
  catch (err) { return res.status(400).json({ error: `المفتاح لم يعمل: ${String((err as Error)?.message ?? err).slice(0, 200)}` }); }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(llmKeysTable).where(eq(llmKeysTable.channel, channel));
  const [row] = await db.insert(llmKeysTable).values({ channel, provider, apiKey, model, label: String(b.label ?? "").trim().slice(0, 80) || null, sort: n }).returning();
  invalidateChannelKeys();
  res.status(201).json({ id: row!.id, channel, provider, model, key: mask(apiKey) });
});

router.patch("/llm-keys/:id", async (req, res) => {
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.isActive === "boolean") patch.isActive = req.body.isActive;
  if (Number.isInteger(req.body?.sort)) patch.sort = req.body.sort;
  await db.update(llmKeysTable).set(patch).where(eq(llmKeysTable.id, Number(req.params.id)));
  invalidateChannelKeys();
  res.json({ ok: true });
});

router.post("/llm-keys/:id/test", async (req, res) => {
  const [k] = await db.select().from(llmKeysTable).where(eq(llmKeysTable.id, Number(req.params.id))).limit(1);
  if (!k) return res.status(404).json({ error: "المفتاح غير موجود" });
  try { res.json({ ok: true, reply: (await testKey(k.provider, k.apiKey, k.model)).slice(0, 80) }); }
  catch (err) { res.json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) }); }
});

router.delete("/llm-keys/:id", async (req, res) => {
  await db.delete(llmKeysTable).where(eq(llmKeysTable.id, Number(req.params.id)));
  invalidateChannelKeys();
  res.json({ ok: true });
});

/** The platform in numbers: money, the signup-to-paying funnel, cohorts, daily activity, leads, adoption. */
router.get("/metrics", async (_req, res) => {
  res.json(await platformMetrics());
});

/** The trial's rules. */
// ── Messaging: real buttons, the stop button, the stop period ─────

router.get("/messaging", async (_req, res) => { res.json(await messagingSettings()); });
router.put("/messaging", async (req, res) => { res.json(await saveMessaging(req.body ?? {})); });

/** Try real buttons on a phone before turning them on for everyone. */
router.post("/messaging/test", async (req, res) => {
  const waUserId = Number(req.body?.waUserId) || Number(req.session.userId);
  const phone = String(req.body?.phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ error: "اكتب رقم واتساب صحيحاً بالمفتاح الدولي" });
  if (!(getStatus(waUserId) as { connected?: boolean })?.connected) return res.status(400).json({ error: "واتساب هذا الحساب غير متصل" });
  const buttons = JSON.stringify(withStopButton([
    { type: "reply", text: "أبي أشوف المنيو" },
    { type: "url", text: "افتح المنيو", url: publicUrl(menuPath("bait-shami")) },
  ]));
  try {
    await sendButtonTest(waUserId, phone, "تجربة أزرار منيو فور يو 👋\nإذا ظهرت لك الأزرار تحت هذه الرسالة، فعّل «الأزرار الحقيقية».", buttons);
    res.json({ ok: true });
  } catch (e: any) { res.status(400).json({ error: String(e?.message ?? e).slice(0, 200) }); }
});

// ── The link that shows a branch's WhatsApp QR ────────────────────
// Sent to the shop owner so they scan from their own phone, without signing
// in; or opened by the admin who links it for them. One link per branch
// account; a new one cancels the old.

router.get("/:id/wa-links", async (req, res) => {
  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name, waUserId: branchesTable.waUserId })
    .from(branchesTable).where(eq(branchesTable.orgId, Number(req.params.id))).orderBy(asc(branchesTable.sort), asc(branchesTable.id));
  const out = [];
  for (const b of branches) {
    let [u] = await db.select({ token: usersTable.connectToken }).from(usersTable).where(eq(usersTable.id, b.waUserId)).limit(1);
    if (!u?.token) [u] = await db.update(usersTable).set({ connectToken: randomUUID() }).where(eq(usersTable.id, b.waUserId)).returning({ token: usersTable.connectToken });
    const st = getStatus(b.waUserId) as { connected?: boolean; phone?: string | null };
    out.push({ branchId: b.id, name: b.name, waUserId: b.waUserId, connected: !!st?.connected, phone: st?.phone ?? null, link: publicUrl(`/wa/${u!.token}`) });
  }
  // Two branches on one account share a link: show it once.
  res.json(out.filter((x, i, a) => a.findIndex((y) => y.waUserId === x.waUserId) === i));
});

router.post("/wa-links/:waUserId/renew", async (req, res) => {
  const [u] = await db.update(usersTable).set({ connectToken: randomUUID() }).where(eq(usersTable.id, Number(req.params.waUserId))).returning({ token: usersTable.connectToken });
  if (!u) return res.status(404).json({ error: "غير موجود" });
  res.json({ link: publicUrl(`/wa/${u.token}`) });
});

router.get("/settings/trial", async (_req, res) => { res.json(await trialSettings()); });
router.put("/settings/trial", async (req, res) => {
  const next = cleanTrialSettings(req.body, await trialSettings());
  await db.insert(platformSettingsTable).values({ key: "trial", value: next as any }).onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: next as any, updatedAt: new Date() } });
  invalidateSettings();
  res.json(next);
});

router.get("/platform/stats", async (_req, res) => {
  const [s] = (await db.execute<any>(sql`
    SELECT
      (SELECT count(*)::int FROM orgs) AS orgs,
      (SELECT count(*)::int FROM orgs WHERE status = 'active') AS active_orgs,
      (SELECT count(*)::int FROM branches) AS branches,
      (SELECT count(*)::int FROM queue_tickets WHERE joined_at > now() - interval '24 hours') AS tickets_24h,
      (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '24 hours' AND status NOT IN ('pending','cancelled')) AS orders_24h,
      (SELECT count(*)::int FROM bookings WHERE created_at > now() - interval '24 hours') AS bookings_24h,
      (SELECT count(*)::int FROM notifications WHERE status = 'sent' AND sent_at > now() - interval '24 hours') AS sent_24h,
      (SELECT count(*)::int FROM notifications WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_24h,
      (SELECT count(*)::int FROM customers) AS customers
  `)).rows;
  const plans = await db.select({ plan: usersTable.plan, n: sql<number>`count(*)::int` }).from(usersTable)
    .innerJoin(orgsTable, eq(orgsTable.ownerUserId, usersTable.id)).groupBy(usersTable.plan);
  res.json({ ...s, plans, planNames: Object.fromEntries(Object.entries(PLAN_LIMITS).map(([k, v]) => [k, v.name])) });
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, id)).limit(1);
  if (!o) return res.status(404).json({ error: "المحل غير موجود" });
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (b.status === "active" || b.status === "suspended") patch.status = b.status;
  if (b.features && typeof b.features === "object") patch.features = { ...(o.features ?? {}), ...Object.fromEntries(Object.entries(b.features).filter(([, v]) => typeof v === "boolean")) };
  // Room on top of the plan for this one shop, and extra messages that never expire.
  if (b.overrides && typeof b.overrides === "object") {
    const next = { ...(o.limitOverrides ?? {}) } as Record<string, number>;
    for (const l of LIMITS) { const v = b.overrides[l.key]; if (v === null || v === "") delete next[l.key]; else if (Number.isFinite(Number(v))) next[l.key] = Math.round(Number(v)); }
    patch.limitOverrides = next;
  }
  if (Number.isFinite(Number(b.addCredits)) && Number(b.addCredits) !== 0) patch.messageCredits = sql`greatest(0, ${orgsTable.messageCredits} + ${Math.round(Number(b.addCredits))})`;
  if (Object.keys(patch).length) await db.update(orgsTable).set(patch).where(eq(orgsTable.id, id));
  const up: Record<string, unknown> = {};
  if (typeof b.plan === "string" && (await loadPlans()).has(b.plan)) up.plan = b.plan;
  if (b.planDays !== undefined) {
    const d = Number(b.planDays);
    up.planExpiresAt = d > 0 ? new Date(Date.now() + d * 24 * 3_600_000) : null;
  }
  if (Object.keys(up).length) await db.update(usersTable).set(up).where(eq(usersTable.id, o.ownerUserId));
  // Shop brings shop: the brought shop's first paid plan gives both a month.
  let referralRewarded = false;
  if (typeof up.plan === "string" && up.plan !== "free" && Number(b.planDays) > 0) referralRewarded = await rewardShopReferral(id);
  logger.info({ orgId: id, patch, up, referralRewarded }, "admin updated org");
  res.json({ ok: true });
});

/** See the shop exactly as its owner does. «رجوع» in the app ends it. */
router.post("/:id/login-as", async (req, res) => {
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, Number(req.params.id))).limit(1);
  if (!o) return res.status(404).json({ error: "المحل غير موجود" });
  const adminId = req.session.ownerId ?? req.session.userId!;
  req.session.impersonatorId = adminId;
  req.session.isAdmin = false;
  req.session.userId = o.ownerUserId;
  delete req.session.orgId; delete req.session.branchId;
  await attachOwner(req, o.ownerUserId);
  logger.info({ adminId, orgId: o.id }, "admin viewing shop as owner");
  res.json({ ok: true });
});

export default router;
