// ── Making a shop, and its branches ───────────────────────────────

import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db, orgsTable, branchesTable, queuesTable, bookingSettingsTable, usersTable, menuCategoriesTable,
  type Org, type Branch, type WeekHours,
} from "@workspace/db";
import { isValidSlug, slugError, slugify, vocab, type Vertical } from "@workspace/menu-shared";
import { TenantError } from "./context";
import { assertWithinLimit, assertFeature } from "../plans";

export const token = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url").slice(0, Math.ceil(bytes * 4 / 3));

const VERTICALS: Vertical[] = ["restaurant", "cafe", "sweets", "beauty"];

/** Ten to ten every day: a starting point the owner edits, never a guess presented as fact. */
export function defaultHours(): WeekHours {
  const h: WeekHours = {};
  for (const d of ["0", "1", "2", "3", "4", "5", "6"] as const) h[d] = { open: "10:00", close: "23:00" };
  return h;
}

export async function slugTaken(slug: string, exceptOrgId?: number): Promise<boolean> {
  const [o] = await db.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.slug, slug)).limit(1);
  return !!o && o.id !== exceptOrgId;
}

export async function suggestSlug(name: string, nameEn?: string | null): Promise<string> {
  let base = slugify(nameEn || "") || slugify(name) || "shop";
  if (base.length < 3) base = `${base}-menu`;
  if (!isValidSlug(base)) base = `${base}-shop`.slice(0, 40);
  let s = base, i = 2;
  while (!isValidSlug(s) || await slugTaken(s)) s = `${base.slice(0, 36)}-${i++}`;
  return s;
}

export interface NewOrg {
  name: string;
  nameEn?: string | null;
  vertical?: string;
  slug?: string;
  tagline?: string | null;
  branchName?: string | null;
  address?: string | null;
  displayPhone?: string | null;
  template?: string;
  brand?: string;
  withDefaultCategories?: boolean;
}

export async function createOrg(ownerUserId: number, input: NewOrg): Promise<{ org: Org; branch: Branch }> {
  const name = String(input.name ?? "").trim().slice(0, 160);
  if (name.length < 2) throw new TenantError(400, "اكتب اسم المحل");
  const existing = await db.select({ id: orgsTable.id }).from(orgsTable).where(eq(orgsTable.ownerUserId, ownerUserId)).limit(1);
  if (existing.length) throw new TenantError(409, "لديك محل بالفعل");

  const vertical = (VERTICALS.includes(input.vertical as Vertical) ? input.vertical : "restaurant") as Vertical;
  const v = vocab(vertical);
  let slug = String(input.slug ?? "").trim().toLowerCase();
  if (slug) {
    const err = slugError(slug);
    if (err) throw new TenantError(400, err);
    if (await slugTaken(slug)) throw new TenantError(409, "هذا الرابط مستخدم — اختر غيره");
  } else {
    slug = await suggestSlug(name, input.nameEn);
  }
  const template = (["noir", "cream", "clean", "rose"].includes(String(input.template)) ? input.template : v.template) as Org["theme"]["template"];
  const brand = /^#[0-9a-f]{6}$/i.test(String(input.brand)) ? String(input.brand) : v.brand;

  return db.transaction(async (tx) => {
    const [org] = await tx.insert(orgsTable).values({
      ownerUserId, name, nameEn: input.nameEn?.trim() || null, slug, vertical,
      tagline: input.tagline?.trim() || null,
      theme: { template, brand },
    }).returning();
    const [branch] = await tx.insert(branchesTable).values({
      orgId: org!.id, waUserId: ownerUserId,
      name: input.branchName?.trim() || "الفرع الرئيسي", nameEn: "Main branch", slug: "main",
      address: input.address?.trim() || null, displayPhone: input.displayPhone?.trim() || null,
      hours: defaultHours(), displayToken: token(18), sort: 0,
    }).returning();
    await tx.insert(queuesTable).values({
      orgId: org!.id, branchId: branch!.id, name: v.queue[0], nameEn: v.queue[1], prefix: "A",
      avgServiceMin: v.avgServiceMin, askService: v.services,
    });
    await tx.insert(bookingSettingsTable).values({
      branchId: branch!.id, enabled: false,
      slotMin: v.services ? 30 : 30, capacityPerSlot: v.services ? 2 : 4,
      leadTimeMin: vertical === "sweets" ? 24 * 60 : 60, maxDaysAhead: vertical === "sweets" ? 30 : 14,
    });
    if (input.withDefaultCategories !== false) {
      await tx.insert(menuCategoriesTable).values(v.defaultCategories.map(([n, e], i) => ({ orgId: org!.id, name: n, nameEn: e, sort: i })));
    }
    await tx.update(usersTable).set({ orgId: org!.id }).where(eq(usersTable.id, ownerUserId));
    return { org: org!, branch: branch! };
  });
}

export interface NewBranch {
  name: string;
  nameEn?: string | null;
  slug?: string;
  address?: string | null;
  displayPhone?: string | null;
  /** Link a WhatsApp number of its own rather than share the main one. */
  ownNumber?: boolean;
}

export async function createBranch(org: Org, input: NewBranch): Promise<Branch> {
  const name = String(input.name ?? "").trim().slice(0, 160);
  if (name.length < 2) throw new TenantError(400, "اكتب اسم الفرع");
  const existing = await db.select({ id: branchesTable.id, slug: branchesTable.slug }).from(branchesTable).where(eq(branchesTable.orgId, org.id));
  await assertWithinLimit(org.ownerUserId, "branches", existing.length);
  if (input.ownNumber) await assertFeature(org.ownerUserId, "branchNumbers");

  let slug = String(input.slug ?? "").trim().toLowerCase() || slugify(input.nameEn || name) || `branch-${existing.length + 1}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new TenantError(400, "رابط الفرع: أحرف إنجليزية صغيرة وأرقام وشرطة");
  let s = slug, i = 2;
  while (existing.some((b) => b.slug === s)) s = `${slug}-${i++}`;
  slug = s;

  return db.transaction(async (tx) => {
    let waUserId = org.ownerUserId;
    if (input.ownNumber) {
      // A service account: holds the branch's own WhatsApp session and its
      // Flow Hub data. Nobody signs in to it — the password can match nothing.
      const [u] = await tx.insert(usersTable).values({
        phone: `b${org.id}x${crypto.randomBytes(4).toString("hex")}`.slice(0, 20),
        passwordHash: "!",
        displayName: `${org.name} — ${name}`,
        kind: "branch", orgId: org.id, status: "active",
        connectToken: randomUUID(),
      }).returning();
      waUserId = u!.id;
    }
    const [branch] = await tx.insert(branchesTable).values({
      orgId: org.id, waUserId, name, nameEn: input.nameEn?.trim() || null, slug,
      address: input.address?.trim() || null, displayPhone: input.displayPhone?.trim() || null,
      hours: defaultHours(), displayToken: token(18), sort: existing.length,
    }).returning();
    const v = vocab(org.vertical);
    await tx.insert(queuesTable).values({
      orgId: org.id, branchId: branch!.id, name: v.queue[0], nameEn: v.queue[1], prefix: "A",
      avgServiceMin: v.avgServiceMin, askService: v.services,
    });
    await tx.insert(bookingSettingsTable).values({ branchId: branch!.id });
    return branch!;
  });
}

/** Whether a branch has its own WhatsApp number rather than the main one. */
export function hasOwnNumber(org: Org, b: Branch): boolean {
  return b.waUserId !== org.ownerUserId;
}

export async function countBranchesSharing(waUserId: number): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(branchesTable).where(eq(branchesTable.waUserId, waUserId));
  return n;
}

export async function getBranch(orgId: number, branchId: number): Promise<Branch | null> {
  const [b] = await db.select().from(branchesTable).where(and(eq(branchesTable.id, branchId), eq(branchesTable.orgId, orgId))).limit(1);
  return b ?? null;
}
