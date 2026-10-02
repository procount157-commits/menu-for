// ── Who is asking, for which shop and which branch ────────────────
// Flow Hub knows one thing about a request: `session.userId`, and every one
// of its routes isolates by it. Menu For You keeps that exactly — the session's
// userId is always the current branch's Flow Hub account (`wa_user_id`) — and
// adds what Flow Hub never had around it: the org, the branch, the person
// actually signed in (the owner, or a member of staff), and their role.
//
// Switching branch therefore re-points every Flow Hub screen (the inbox, the
// campaigns, the knowledge) at that branch without any of them knowing.

import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, orgsTable, branchesTable, staffTable, usersTable, type Org, type Branch } from "@workspace/db";
import { STAFF_PERMS, permsOf, roleForPerms, type StaffPerm } from "@workspace/menu-shared";
import { staffMay } from "./permissions";

export type Role = "owner" | "manager" | "staff";

declare module "express-session" {
  interface SessionData {
    /** The person signed in, when that is not `userId` (an owner on a branch with its own number). */
    ownerId?: number;
    orgId?: number;
    branchId?: number;
    staffId?: number;
    role?: Role;
    /** Set while the super admin is looking at someone else's shop. */
    impersonatorId?: number;
  }
}

export interface Tenant {
  org: Org;
  branch: Branch;
  role: Role;
  /** The Flow Hub account the current branch lives in (== session.userId). */
  waUserId: number;
  /** The signed-in person's user id (owners), or null for staff. */
  personId: number | null;
  staffId: number | null;
  /** What this person may do: everything for the owner, their own list for staff. */
  perms: StaffPerm[];
  /** The branches this person may act on. */
  branchIds: number[];
  isAdmin: boolean;
}

export class TenantError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/** The org a signed-in owner belongs to, by ownership. */
export async function orgForOwner(userId: number): Promise<Org | null> {
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.ownerUserId, userId)).limit(1);
  return o ?? null;
}

export async function branchesOf(orgId: number): Promise<Branch[]> {
  return db.select().from(branchesTable).where(eq(branchesTable.orgId, orgId)).orderBy(branchesTable.sort, branchesTable.id);
}

/**
 * Resolve the tenant for a request, cached on it. Throws a TenantError with
 * `needsOnboarding` when an owner has not made their shop yet.
 */
export async function tenant(req: Request): Promise<Tenant> {
  const cached = (req as any)._tenant as Tenant | undefined;
  if (cached) return cached;
  const s = req.session;
  if (!s?.userId) throw new TenantError(401, "يجب تسجيل الدخول أولاً");

  let org: Org | null = null;
  let role: Role = s.role ?? "owner";
  let personId: number | null = s.staffId ? null : (s.ownerId ?? s.userId);
  let branchScope: number | null = null;
  let perms: StaffPerm[] = [...STAFF_PERMS];

  if (s.staffId) {
    const [st] = await db.select().from(staffTable).where(eq(staffTable.id, s.staffId)).limit(1);
    if (!st || !st.isActive) throw new TenantError(401, "انتهت صلاحية دخول الموظف");
    [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, st.orgId)).limit(1);
    perms = permsOf(st);
    role = roleForPerms(perms);
    // «مدير كامل» holds every permission, spelled out for the screens.
    if (role === "owner") perms = [...STAFF_PERMS];
    branchScope = st.branchId;
  } else {
    org = await orgForOwner(personId!);
    // The super admin looking at a shop holds that shop's org in the session.
    if (!org && s.orgId && s.isAdmin) {
      [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, s.orgId)).limit(1);
    }
    role = "owner";
  }
  if (!org) throw new TenantError(409, "أنشئ محلك أولاً", { needsOnboarding: true });
  if (org.status === "suspended" && !s.isAdmin) throw new TenantError(403, "هذا المحل موقوف — تواصل مع الإدارة");

  const all = await branchesOf(org.id);
  const allowed = all.filter((b) => b.isActive && (branchScope == null || b.id === branchScope));
  if (allowed.length === 0) throw new TenantError(409, "لا يوجد فرع مفعّل", { needsOnboarding: !all.length });
  let branch = allowed.find((b) => b.id === s.branchId) ?? allowed[0]!;

  // The session's userId must be the branch's Flow Hub account; re-point it
  // if the branch was changed elsewhere (another tab, or a branch's number).
  if (s.userId !== branch.waUserId) s.userId = branch.waUserId;
  if (s.branchId !== branch.id) s.branchId = branch.id;
  if (s.orgId !== org.id) s.orgId = org.id;

  const t: Tenant = {
    org, branch, role,
    waUserId: branch.waUserId,
    personId,
    staffId: s.staffId ?? null,
    perms,
    branchIds: allowed.map((b) => b.id),
    isAdmin: !!s.isAdmin && !s.staffId,
  };
  (req as any)._tenant = t;
  return t;
}

/** Point the session at a branch (owner switching, or after creating one). */
export async function switchBranch(req: Request, branchId: number): Promise<Branch> {
  const t = await tenant(req);
  if (!t.branchIds.includes(branchId)) throw new TenantError(403, "لا تملك صلاحية هذا الفرع");
  const [b] = await db.select().from(branchesTable).where(and(eq(branchesTable.id, branchId), eq(branchesTable.orgId, t.org.id))).limit(1);
  if (!b) throw new TenantError(404, "الفرع غير موجود");
  req.session.branchId = b.id;
  req.session.userId = b.waUserId;
  delete (req as any)._tenant;
  return b;
}

/** After an owner signs in or registers: remember who they are and where. */
export async function attachOwner(req: Request, userId: number): Promise<void> {
  req.session.ownerId = userId;
  delete req.session.staffId;
  delete req.session.role;
  const org = await orgForOwner(userId);
  if (!org) return;
  const bs = (await branchesOf(org.id)).filter((b) => b.isActive);
  req.session.orgId = org.id;
  if (bs[0]) { req.session.branchId = bs[0].id; req.session.userId = bs[0].waUserId; }
}

/** Express: turn a TenantError into its JSON answer; true when handled. */
export function tenantErrorToResponse(err: unknown, res: Response): boolean {
  if (err instanceof TenantError) { res.status(err.status).json({ error: err.message, ...err.extra }); return true; }
  return false;
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

/** Wraps a route: the tenant must resolve and hold one of `roles`. */
export function withTenant(roles: Role[], fn: (req: Request, res: Response, t: Tenant) => unknown): Handler {
  return async (req, res, next) => {
    try {
      const t = await tenant(req);
      if (!roles.includes(t.role)) return res.status(403).json({ error: "هذا الإجراء لصاحب المحل أو المدير" });
      await fn(req, res, t);
    } catch (err) {
      if (tenantErrorToResponse(err, res)) return;
      const { planErrorToResponse } = await import("../plans");
      if (planErrorToResponse(err, res)) return;
      next(err);
    }
  };
}

export const ALL: Role[] = ["owner", "manager", "staff"];
export const MANAGERS: Role[] = ["owner", "manager"];
export const OWNER: Role[] = ["owner"];

// ── Staff may reach only what they need ───────────────────────────
// Default deny, by permission (permissions.ts). The person's permissions are
// read on every request rather than kept in the session, so what the owner
// changes applies at once — and a member of staff switched off is out.

export async function staffGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.staffId) return next();
  try {
    const [st] = await db.select({ role: staffTable.role, permissions: staffTable.permissions, isActive: staffTable.isActive })
      .from(staffTable).where(eq(staffTable.id, req.session.staffId)).limit(1);
    if (!st || !st.isActive) return res.status(401).json({ error: "انتهت صلاحية دخول الموظف", staff: true });
    const perms = permsOf(st);
    req.session.role = roleForPerms(perms);
    if (staffMay(perms, req.method, req.path)) return next();
    res.status(403).json({ error: "ليست لديك صلاحية لهذه الصفحة — اطلبها من صاحب المحل", staff: true });
  } catch (err) { next(err); }
}

/** The user row for whoever is signed in, never the branch's service account. */
export async function signedInUser(req: Request) {
  const id = req.session.ownerId ?? req.session.userId;
  if (!id) return null;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return u ?? null;
}
