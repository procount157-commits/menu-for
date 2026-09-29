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
import { db, usersTable, contactGroupsTable, contactsTable, campaignsTable, PLAN_LIMITS } from "@workspace/db";

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
  const [u] = await db.select({ plan: usersTable.plan, expiresAt: usersTable.planExpiresAt, isAdmin: usersTable.isAdmin })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const plan = ((u?.plan ?? "free") in PLAN_LIMITS ? u?.plan ?? "free" : "free") as PlanName;
  const e = effectiveLimits(plan, u?.expiresAt ?? null, !!u?.isAdmin);
  return { plan, expired: e.expired, expiresAt: u?.expiresAt ?? null, isAdmin: !!u?.isAdmin,
    limits: { contacts: e.contacts, campaigns: e.campaigns, chatbots: e.chatbots } };
}

const AR: Record<PlanName, string> = { free: PLAN_LIMITS.free.name, basic: PLAN_LIMITS.basic.name, pro: PLAN_LIMITS.pro.name };

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
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(campaignsTable).where(eq(campaignsTable.userId, userId));
  if (Number(n) >= p.limits.campaigns) {
    throw new PlanError(`خطة ${AR[p.expired ? "free" : p.plan]} تسمح بـ${p.limits.campaigns} حملات ولديك ${n}. احذف حملة قديمة أو رقّ الخطة.`);
  }
}

/** Express: a PlanError becomes a 402 with its message; anything else passes on. */
export function planErrorToResponse(err: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }): boolean {
  if (err instanceof PlanError) { res.status(err.status).json({ error: err.message, plan: true }); return true; }
  return false;
}
