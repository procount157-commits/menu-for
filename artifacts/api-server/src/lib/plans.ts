// ── What a plan allows ────────────────────────────────────────────
// Plans are rows in subscription_plans, edited in full by the platform
// owner: a switch per feature, a number per limit (see menu-shared/plans.ts
// for the list). This is the one place that turns a plan into a yes or a
// no, so a limit is checked the same way wherever it is checked.
//
// An expired plan — a paid one lapsed, or the trial over — is treated as the
// plan the settings name for "after" (free by default) rather than as locked:
// the account keeps its data and its sign-in, and stops being able to grow or
// send until it is renewed. Admins are never limited. The admin can also give
// one shop more room than its plan (orgs.limit_overrides).

import { eq, isNotNull, sql } from "drizzle-orm";
import { db, pool, usersTable, orgsTable, subscriptionPlansTable, platformSettingsTable, campaignsTable, PLAN_LIMITS } from "@workspace/db";
import { DEFAULT_PLANS, LIMITS, TOGGLES, type LimitKey, type ToggleKey, type PlanDef } from "@workspace/menu-shared";

export class PlanError extends Error {
  status = 402;
  constructor(message: string) { super(message); }
}

// ── The matrix, from the database ─────────────────────────────────

let cache: { at: number; plans: Map<string, PlanDef> } | null = null;
const TTL = 30_000;
export function invalidatePlans() { cache = null; }

function fromRow(r: typeof subscriptionPlansTable.$inferSelect): PlanDef {
  const d = DEFAULT_PLANS[r.planKey!] ?? DEFAULT_PLANS["free"]!;
  const limits = Object.fromEntries(LIMITS.map((l) => [l.key, Number.isFinite(Number(r.limits?.[l.key])) && r.limits?.[l.key] != null ? Number(r.limits[l.key]) : d.limits[l.key]])) as Record<LimitKey, number>;
  const toggles = Object.fromEntries(TOGGLES.map((t) => [t.key, typeof r.toggles?.[t.key] === "boolean" ? r.toggles[t.key]! : d.toggles[t.key]])) as Record<ToggleKey, boolean>;
  return {
    key: r.planKey!, name: r.name, nameEn: r.nameEn, priceMonthly: Number(r.price), priceYearly: r.priceYearly == null ? null : Number(r.priceYearly),
    extraBranchPrice: r.extraBranchPrice == null ? null : Number(r.extraBranchPrice), contactSales: r.contactSales, isPublic: r.isPublic, isActive: r.isActive,
    isFeatured: r.isFeatured, badge: r.badge, badgeEn: r.badgeEn, sort: r.sortOrder, limits, toggles,
    bullets: Array.isArray(r.features) ? r.features : [], bulletsEn: Array.isArray(r.featuresEn) ? r.featuresEn : [],
  };
}

function fromDefault(key: string): PlanDef {
  const d = DEFAULT_PLANS[key] ?? DEFAULT_PLANS["free"]!;
  return { key, name: d.name, nameEn: d.nameEn, priceMonthly: d.priceMonthly, priceYearly: null, extraBranchPrice: null, contactSales: false, isPublic: key !== "trial", isActive: true, isFeatured: key === "pro", badge: null, badgeEn: null, sort: 0, limits: { ...d.limits }, toggles: { ...d.toggles }, bullets: [], bulletsEn: [] };
}

/** Every plan with a key, by key — database rows first, the built-in defaults for any missing. */
export async function loadPlans(): Promise<Map<string, PlanDef>> {
  if (cache && Date.now() - cache.at < TTL) return cache.plans;
  const plans = new Map<string, PlanDef>();
  try {
    const rows = await db.select().from(subscriptionPlansTable).where(isNotNull(subscriptionPlansTable.planKey)).orderBy(subscriptionPlansTable.sortOrder, subscriptionPlansTable.id);
    for (const r of rows) plans.set(r.planKey!, fromRow(r));
  } catch { /* an install before the migration: defaults only */ }
  for (const k of Object.keys(DEFAULT_PLANS)) if (!plans.has(k)) plans.set(k, fromDefault(k));
  cache = { at: Date.now(), plans };
  return plans;
}

export async function planByKey(key: string): Promise<PlanDef> {
  const plans = await loadPlans();
  return plans.get(key) ?? plans.get("free") ?? fromDefault("free");
}

// ── Platform settings (the trial's rules) ─────────────────────────

export interface TrialSettings { days: number; extensionDays: number; extensionWithinDays: number; extensionMinItems: number; afterPlan: string; graceShare: number }
export const DEFAULT_TRIAL: TrialSettings = { days: 30, extensionDays: 15, extensionWithinDays: 7, extensionMinItems: 10, afterPlan: "free", graceShare: 0.1 };
let trialCache: { at: number; v: TrialSettings } | null = null;
export function invalidateSettings() { trialCache = null; }

export async function trialSettings(): Promise<TrialSettings> {
  if (trialCache && Date.now() - trialCache.at < TTL) return trialCache.v;
  let v = DEFAULT_TRIAL;
  try {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "trial")).limit(1);
    if (row) v = { ...DEFAULT_TRIAL, ...(row.value as Partial<TrialSettings>) };
  } catch { /* defaults */ }
  trialCache = { at: Date.now(), v };
  return v;
}

/** The admin's form, bounded. Pure. */
export function cleanTrialSettings(b: any, cur: TrialSettings): TrialSettings {
  const num = (v: unknown, lo: number, hi: number, d: number) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  return {
    days: num(b?.days, 0, 365, cur.days), extensionDays: num(b?.extensionDays, 0, 90, cur.extensionDays),
    extensionWithinDays: num(b?.extensionWithinDays, 1, 60, cur.extensionWithinDays), extensionMinItems: num(b?.extensionMinItems, 0, 200, cur.extensionMinItems),
    afterPlan: typeof b?.afterPlan === "string" && b.afterPlan.trim() ? b.afterPlan.trim() : cur.afterPlan,
    graceShare: Math.max(0, Math.min(0.5, Number(b?.graceShare ?? cur.graceShare) || 0)),
  };
}

// ── The plan a shop is on ─────────────────────────────────────────

/** A branch with its own number is a service account; the plan is its owner's. */
async function planHolder(userId: number): Promise<number> {
  const [u] = await db.select({ kind: usersTable.kind, orgId: usersTable.orgId }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (u?.kind === "branch" && u.orgId) {
    const [o] = await db.select({ owner: orgsTable.ownerUserId }).from(orgsTable).where(eq(orgsTable.id, u.orgId)).limit(1);
    if (o) return o.owner;
  }
  return userId;
}

export interface MenuPlan {
  plan: string;
  planName: string;
  expired: boolean;
  expiresAt: Date | null;
  /** On the trial plan and still inside it. */
  trial: boolean;
  isAdmin: boolean;
  limits: Record<LimitKey, number>;
  features: Record<ToggleKey, boolean> & { marketing: boolean; growth: boolean };
  priceMonthly: number;
}

const unlimited = () => Object.fromEntries(LIMITS.map((l) => [l.key, -1])) as Record<LimitKey, number>;
const everything = () => Object.fromEntries(TOGGLES.map((t) => [t.key, true])) as Record<ToggleKey, boolean>;

/** Pure: the plan, lapsed or not, with the shop's own overrides on top. */
export function resolvePlan(def: PlanDef, after: PlanDef, expiresAt: Date | null, isAdmin: boolean, overrides: Record<string, number> | null | undefined, now = new Date()): MenuPlan {
  if (isAdmin) return { plan: def.key, planName: def.name, expired: false, expiresAt, trial: false, isAdmin: true, limits: unlimited(), features: { ...everything(), marketing: true, growth: true }, priceMonthly: def.priceMonthly };
  const expired = !!expiresAt && expiresAt.getTime() < now.getTime() && def.key !== after.key;
  const eff = expired ? after : def;
  const limits = { ...eff.limits };
  for (const l of LIMITS) {
    const o = overrides?.[l.key];
    if (o != null && Number.isFinite(Number(o)) && (Number(o) < 0 || Number(o) > limits[l.key]) && limits[l.key] >= 0) limits[l.key] = Number(o);
  }
  return {
    plan: def.key, planName: expired ? `${def.name} (منتهية)` : def.name, expired, expiresAt,
    trial: def.key === "trial" && !expired, isAdmin: false, limits,
    features: { ...eff.toggles, marketing: eff.toggles.campaigns, growth: eff.toggles.analytics },
    priceMonthly: eff.priceMonthly,
  };
}

export async function menuPlan(userId: number): Promise<MenuPlan> {
  const ownerId = await planHolder(userId);
  const [u] = await db.select({ plan: usersTable.plan, expiresAt: usersTable.planExpiresAt, isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, ownerId)).limit(1);
  const [org] = await db.select({ overrides: orgsTable.limitOverrides }).from(orgsTable).where(eq(orgsTable.ownerUserId, ownerId)).limit(1);
  const [plans, trial] = await Promise.all([loadPlans(), trialSettings()]);
  const key = u?.plan && plans.has(u.plan) ? u.plan : "free";
  const after = plans.get(trial.afterPlan) ?? plans.get("free") ?? fromDefault("free");
  return resolvePlan(plans.get(key)!, after, u?.expiresAt ?? null, !!u?.isAdmin, org?.overrides);
}

// ── Flow Hub's side (contacts, campaigns, chatbots) ───────────────

export type PlanName = keyof typeof PLAN_LIMITS;
export interface PlanStatus {
  plan: string; expired: boolean; expiresAt: Date | null; isAdmin: boolean;
  limits: { contacts: number; campaigns: number; chatbots: number };
}

/** Kept for the Flow Hub suites: the built-in defaults, with an expired plan falling to free. Pure. */
export function effectiveLimits(plan: string, expiresAt: Date | null, isAdmin: boolean, now = new Date()): PlanStatus["limits"] & { expired: boolean } {
  if (isAdmin) return { contacts: -1, campaigns: -1, chatbots: -1, expired: false };
  const known = plan in PLAN_LIMITS ? (plan as PlanName) : "free";
  const expired = known !== "free" && !!expiresAt && expiresAt.getTime() < now.getTime();
  const l = PLAN_LIMITS[expired ? "free" : known];
  return { contacts: l.contacts, campaigns: l.campaigns, chatbots: l.chatbots, expired };
}

export async function planStatus(userId: number): Promise<PlanStatus> {
  const m = await menuPlan(userId);
  return { plan: m.plan, expired: m.expired, expiresAt: m.expiresAt, isAdmin: m.isAdmin, limits: { contacts: m.limits.contacts, campaigns: m.limits.campaignsMonthly, chatbots: m.limits.chatbots } };
}

/** Sending — campaigns and follow-ups — needs a plan that has not lapsed. */
export async function assertCanSend(userId: number): Promise<void> {
  const p = await planStatus(userId);
  if (p.expired) throw new PlanError(`انتهى اشتراكك في ${p.expiresAt!.toISOString().slice(0, 10)} — جدّده لاستئناف الإرسال. بياناتك محفوظة.`);
}

export async function assertCanAddContacts(userId: number, adding: number): Promise<void> {
  const p = await planStatus(userId);
  if (p.limits.contacts < 0) return;
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM contacts c JOIN contact_groups g ON g.id = c.group_id WHERE g.user_id = $1`, [userId]);
  const have = Number(rows[0]?.n ?? 0);
  if (have + adding > p.limits.contacts) throw new PlanError(`خطتك تسمح بـ${p.limits.contacts} رقم في قوائم الحملات (عندك ${have}) — رقّ الخطة لإضافة ${adding}.`);
}

export async function assertCanCreateCampaign(userId: number): Promise<void> {
  const p = await planStatus(userId);
  if (p.expired) throw new PlanError("انتهى اشتراكك — جدّده لإنشاء حملات.");
  if (p.limits.campaigns < 0) return;
  if (p.limits.campaigns === 0) throw new PlanError("الحملات غير متاحة في خطتك — رقّ الخطة لتفعيلها.");
  const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campaignsTable).where(sql`${campaignsTable.userId} = ${userId} AND ${campaignsTable.createdAt} >= ${since}`);
  if (n >= p.limits.campaigns) throw new PlanError(`خطتك تسمح بـ${p.limits.campaigns} حملات في الشهر — رقّ الخطة لإنشاء المزيد.`);
}

export function planErrorToResponse(err: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }): boolean {
  if (err instanceof PlanError) { res.status(402).json({ error: err.message, plan: true }); return true; }
  return false;
}

// ── Menu For You's checks ─────────────────────────────────────────

export type MenuFeature = ToggleKey | "marketing" | "growth";
export type MenuLimit = "branches" | "items" | "staff" | "customers";

const FEATURE_AR: Record<string, string> = Object.fromEntries(TOGGLES.map((t) => [t.key, t.label]));
FEATURE_AR["marketing"] = "الحملات"; FEATURE_AR["growth"] = "تحليلات المنيو";
const LIMIT_AR: Record<string, string> = Object.fromEntries(LIMITS.map((l) => [l.key, l.unit]));

export async function assertFeature(userId: number, f: MenuFeature): Promise<void> {
  const m = await menuPlan(userId);
  if (!m.features[f]) throw new PlanError(`${FEATURE_AR[f] ?? f} غير متاح في خطة ${m.planName} — رقّ الخطة لتفعيله.`);
}

export async function assertWithinLimit(userId: number, what: MenuLimit, have: number): Promise<void> {
  const m = await menuPlan(userId);
  const max = m.limits[what];
  if (max >= 0 && have >= max) throw new PlanError(`خطة ${m.planName} تسمح بـ${max} ${LIMIT_AR[what]} — رقّ الخطة لإضافة المزيد.`);
}
