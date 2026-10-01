// ── What a plan allows ────────────────────────────────────────────
// PLAN_LIMITS sat in the schema as a reference table and the admin page
// could set a plan and an expiry, and no code path read either. A tenant
// on "free" could import ten thousand contacts; a lapsed subscription kept
// sending. This is the one place that turns the plan into a yes or a no,
// so a limit is checked the same way wherever it is checked.
//
// An expired paid plan is treated as free rather than as locked: the account
// keeps its data and its sign-in, and stops being able to grow or send until
// it is renewed. Admins are never limited.

import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, usersTable, contactGroupsTable, contactsTable, campaignsTable, PLAN_LIMITS } from "@workspace/db";

export type PlanName = keyof typeof PLAN_LIMITS;

export interface PlanStatus {
  plan: PlanName;
  /** A paid plan whose expiry has passed. */
  expired: boolean;
  expiresAt: Date | null;
  isAdmin: boolean;
  /** -1 means unlimited. */
  limits: { contacts: number; campaigns: number; chatbots: number };
}

export class PlanError extends Error {
  status = 402;
  constructor(message: string) { super(message); }
}

/** The limits that apply, given the plan and whether it has lapsed. Pure. */
export function effectiveLimits(plan: string, expiresAt: Date | null, isAdmin: boolean, now = new Date()): PlanStatus["limits"] & { expired: boolean } {
  if (isAdmin) return { contacts: -1, campaigns: -1, chatbots: -1, expired: false };
  const known = (plan in PLAN_LIMITS ? plan : "free") as PlanName;
  const expired = known !== "free" && !!expiresAt && expiresAt.getTime() < now.getTime();
  const l = PLAN_LIMITS[expired ? "free" : known];
  return { contacts: l.contacts, campaigns: l.campaigns, chatbots: l.chatbots, expired };
}

export async function planStatus(userId: number): Promise<PlanStatus> {
  // A branch with its own number is a service account; the plan is its owner's.
  const ownerId = await planHolder(userId);
  const [u] = await db.select({ plan: usersTable.plan, expiresAt: usersTable.planExpiresAt, isAdmin: usersTable.isAdmin })
    .from(usersTable).where(eq(usersTable.id, ownerId)).limit(1);
  const plan = ((u?.plan ?? "free") in PLAN_LIMITS ? u?.plan ?? "free" : "free") as PlanName;
  const e = effectiveLimits(plan, u?.expiresAt ?? null, !!u?.isAdmin);
  return { plan, expired: e.expired, expiresAt: u?.expiresAt ?? null, isAdmin: !!u?.isAdmin,
    limits: { contacts: e.contacts, campaigns: e.campaigns, chatbots: e.chatbots } };
}

const AR = Object.fromEntries(Object.entries(PLAN_LIMITS).map(([k, v]) => [k, v.name])) as Record<PlanName, string>;

/** Sending — campaigns and follow-ups — needs a plan that has not lapsed. */
export async function assertCanSend(userId: number): Promise<void> {
  const p = await planStatus(userId);
  if (p.expired) throw new PlanError(`انتهى اشتراكك (${AR[p.plan]}) في ${p.expiresAt!.toISOString().slice(0, 10)} — جدّده لاستئناف الإرسال. بياناتك محفوظة.`);
}

export async function assertCanAddContacts(userId: number, adding: number): Promise<void> {
  const p = await planStatus(userId);
  if (p.limits.contacts < 0) return;
  const groups = db.select({ id: contactGroupsTable.id }).from(contactGroupsTable).where(eq(contactGroupsTable.userId, userId));
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(contactsTable).where(inArray(contactsTable.groupId, groups));
  const have = Number(n);
  if (have + adding > p.limits.contacts) {
    throw new PlanError(`خطة ${AR[p.expired ? "free" : p.plan]} تسمح بـ${p.limits.contacts} رقماً ولديك ${have}${adding ? ` وتحاول إضافة ${adding}` : ""}. رقّ الخطة لإضافة المزيد.`);
  }
}

export async function assertCanCreateCampaign(userId: number): Promise<void> {
  const p = await planStatus(userId);
  if (p.limits.campaigns < 0) return;
  if (p.limits.campaigns === 0) throw new PlanError("الحملات الجماعية متاحة في خطة الأعمال — رقّ الخطة لتفعيلها.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(campaignsTable).where(eq(campaignsTable.userId, userId));
  if (Number(n) >= p.limits.campaigns) {
    throw new PlanError(`خطة ${AR[p.expired ? "free" : p.plan]} تسمح بـ${p.limits.campaigns} حملات ولديك ${n}. احذف حملة قديمة أو رقّ الخطة.`);
  }
}

/** The account whose plan applies: the org owner for a branch service account. */
async function planHolder(userId: number): Promise<number> {
  const { rows } = await pool.query<{ owner: number | null }>(
    `SELECT o.owner_user_id AS owner FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.id = $1 AND u.kind = 'branch'`, [userId]);
  return rows[0]?.owner ?? userId;
}

export type MenuFeature = "queue" | "booking" | "notify" | "marketing" | "display" | "branchNumbers";
export type MenuLimit = "branches" | "items" | "staff";

/** Menu For You's side of the plan, for an org owner (or any account in the org). */
export async function menuPlan(userId: number) {
  const p = await planStatus(userId);
  const known = (p.plan in PLAN_LIMITS ? p.plan : "free") as PlanName;
  const l = PLAN_LIMITS[p.isAdmin ? "business" : p.expired ? "free" : known];
  return {
    plan: p.plan, planName: AR[p.plan], expired: p.expired, expiresAt: p.expiresAt,
    limits: { branches: l.branches as number, items: l.items as number, staff: l.staff as number },
    features: { queue: l.queue as boolean, booking: l.booking as boolean, notify: l.notify as boolean, marketing: l.marketing as boolean, display: l.display as boolean, branchNumbers: l.branchNumbers as boolean },
  };
}

const FEATURE_AR: Record<MenuFeature, string> = {
  queue: "الصف الرقمي", booking: "الحجوزات", notify: "إشعارات واتساب", marketing: "الحملات", display: "شاشة العرض", branchNumbers: "رقم واتساب لكل فرع",
};

export async function assertFeature(userId: number, f: MenuFeature): Promise<void> {
  const m = await menuPlan(userId);
  if (!m.features[f]) throw new PlanError(`${FEATURE_AR[f]} غير متاح في خطة ${m.planName} — رقّ الخطة لتفعيله.`);
}

export async function assertWithinLimit(userId: number, what: MenuLimit, have: number): Promise<void> {
  const m = await menuPlan(userId);
  const max = m.limits[what];
  if (max >= 0 && have >= max) {
    const label = { branches: "فروع", items: "أصناف", staff: "موظفين" }[what];
    throw new PlanError(`خطة ${m.planName} تسمح بـ${max} ${label} — رقّ الخطة لإضافة المزيد.`);
  }
}

/** Express: a PlanError becomes a 402 with its message; anything else passes on. */
export function planErrorToResponse(err: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }): boolean {
  if (err instanceof PlanError) { res.status(err.status).json({ error: err.message, plan: true }); return true; }
  return false;
}
