// ── The menu as a customer sees it ────────────────────────────────
// One query set per page load: the org's menu, with the branch's own
// availability and prices laid over it, the offers running now, and the
// queues' live counts. Small enough to inline into the page's HTML so the
// first paint needs no second request.

import { and, asc, eq, inArray, isNull, or, gt, lte, sql } from "drizzle-orm";
import {
  db, orgsTable, branchesTable, menuCategoriesTable, menuItemsTable, branchItemOverridesTable,
  offersTable, queuesTable, bookingSettingsTable,
  type Org, type Branch, type MenuItem,
} from "@workspace/db";
import { isOpenAt, vocab, type PublicMenu, type PublicItem, type PriceableItem } from "@workspace/menu-shared";
import { publicQueue } from "../queue/engine";
import { getStatus } from "../whatsapp";
import { menuPlan } from "../plans";

export async function orgBySlug(slug: string): Promise<Org | null> {
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.slug, slug.toLowerCase())).limit(1);
  return o ?? null;
}

export async function branchFor(org: Org, branchSlug?: string | null): Promise<Branch | null> {
  const bs = await db.select().from(branchesTable)
    .where(and(eq(branchesTable.orgId, org.id), eq(branchesTable.isActive, true)))
    .orderBy(asc(branchesTable.sort), asc(branchesTable.id));
  if (!bs.length) return null;
  if (branchSlug) return bs.find((b) => b.slug === branchSlug.toLowerCase()) ?? null;
  return bs[0]!;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Items with the branch's overrides applied; unavailable ones kept (shown as sold out). */
export async function branchItems(org: Org, branchId: number): Promise<Array<MenuItem & { available: boolean; effectivePrice: number }>> {
  const items = await db.select().from(menuItemsTable)
    .where(and(eq(menuItemsTable.orgId, org.id), eq(menuItemsTable.isActive, true)))
    .orderBy(asc(menuItemsTable.sort), asc(menuItemsTable.id));
  const ov = items.length ? await db.select().from(branchItemOverridesTable)
    .where(and(eq(branchItemOverridesTable.branchId, branchId), inArray(branchItemOverridesTable.itemId, items.map((i) => i.id)))) : [];
  const byItem = new Map(ov.map((o) => [o.itemId, o]));
  return items.map((i) => {
    const o = byItem.get(i.id);
    return { ...i, available: o ? o.isAvailable : true, effectivePrice: o?.price != null ? Number(o.price) : Number(i.price) };
  });
}

/** The items a cart may be priced against: available ones, at the branch's price. */
export async function priceableItems(org: Org, branchId: number): Promise<Map<number, PriceableItem>> {
  const items = await branchItems(org, branchId);
  return new Map(items.filter((i) => i.available).map((i) => [i.id, { id: i.id, name: i.name, nameEn: i.nameEn, price: i.effectivePrice, options: i.options ?? [] }]));
}

export async function publicMenu(org: Org, branch: Branch): Promise<PublicMenu> {
  const now = new Date();
  const [cats, items, offers, queues, allBranches, bookingRow, plan] = await Promise.all([
    db.select().from(menuCategoriesTable).where(and(eq(menuCategoriesTable.orgId, org.id), eq(menuCategoriesTable.isActive, true)))
      .orderBy(asc(menuCategoriesTable.sort), asc(menuCategoriesTable.id)),
    branchItems(org, branch.id),
    db.select().from(offersTable).where(and(
      eq(offersTable.orgId, org.id), eq(offersTable.isActive, true),
      or(isNull(offersTable.branchId), eq(offersTable.branchId, branch.id)),
      or(isNull(offersTable.startsAt), lte(offersTable.startsAt, now)),
      or(isNull(offersTable.endsAt), gt(offersTable.endsAt, now)),
    )).orderBy(asc(offersTable.sort), asc(offersTable.id)),
    db.select().from(queuesTable).where(and(eq(queuesTable.branchId, branch.id), eq(queuesTable.isActive, true))).orderBy(asc(queuesTable.sort), asc(queuesTable.id)),
    db.select({ id: branchesTable.id, name: branchesTable.name, nameEn: branchesTable.nameEn, slug: branchesTable.slug })
      .from(branchesTable).where(and(eq(branchesTable.orgId, org.id), eq(branchesTable.isActive, true))).orderBy(asc(branchesTable.sort), asc(branchesTable.id)),
    db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.branchId, branch.id)).limit(1),
    menuPlan(org.ownerUserId),
  ]);
  const open = isOpenAt(branch.hours, org.timezone, now);
  const v = vocab(org.vertical);
  const pubItems: PublicItem[] = items.map((i) => ({
    id: i.id, categoryId: i.categoryId, kind: (i.kind === "service" ? "service" : "product"),
    name: i.name, nameEn: i.nameEn, description: i.description, descriptionEn: i.descriptionEn,
    price: i.effectivePrice, compareAtPrice: num(i.compareAtPrice), durationMin: i.durationMin,
    images: i.images ?? [], options: i.options ?? [], tags: i.tags ?? [],
    calories: i.calories, allergens: i.allergens ?? [], available: i.available,
  }));
  const bk = bookingRow[0];
  const wa = getStatus(branch.waUserId) as { connected?: boolean };
  return {
    org: {
      id: org.id, name: org.name, nameEn: org.nameEn, slug: org.slug, vertical: org.vertical as any,
      tagline: org.tagline, taglineEn: org.taglineEn, about: org.about,
      logoUrl: org.logoUrl, coverUrl: org.coverUrl, theme: org.theme,
      currency: org.currency, timezone: org.timezone, defaultLang: org.defaultLang === "en" ? "en" : "ar",
      socials: org.socials ?? {},
    },
    branch: {
      id: branch.id, name: branch.name, nameEn: branch.nameEn, slug: branch.slug,
      address: branch.address, mapUrl: branch.mapUrl, displayPhone: branch.displayPhone, waPhone: branch.waPhone,
      hours: branch.hours ?? {},
      open: { open: open.open, known: open.known, closesAt: open.closesAt?.toISOString(), opensAt: open.opensAt?.toISOString() },
    },
    branches: allBranches,
    categories: cats.map((c) => ({ id: c.id, name: c.name, nameEn: c.nameEn, imageUrl: c.imageUrl })),
    items: pubItems,
    offers: offers.map((o) => ({ id: o.id, title: o.title, titleEn: o.titleEn, body: o.body, bodyEn: o.bodyEn, imageUrl: o.imageUrl, itemId: o.itemId, endsAt: o.endsAt?.toISOString() ?? null })),
    queues: plan.features.queue ? await Promise.all(queues.map((q) => publicQueue({ queue: q, branch, org }))) : [],
    booking: plan.features.booking && bk?.enabled
      ? { enabled: true, maxParty: bk.maxParty, slotMin: bk.slotMin, maxDaysAhead: bk.maxDaysAhead, services: v.services }
      : null,
    ordering: { enabled: !!branch.waPhone, types: org.vertical === "beauty" ? ["pickup"] : ["dine_in", "pickup", "delivery", "preorder"] },
    whatsapp: !!wa?.connected,
  };
}

/** Item counts, for limits and the dashboard. */
export async function itemCount(orgId: number): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(menuItemsTable).where(eq(menuItemsTable.orgId, orgId));
  return n;
}
