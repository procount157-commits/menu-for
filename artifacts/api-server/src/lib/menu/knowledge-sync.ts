// ── The agent knows the menu because the menu is the knowledge ────
// Flow Hub's agent answers from knowledge entries and nothing else; that is
// what stops it inventing a price. So every save of the menu regenerates the
// entries it implies — one per item, one for the hours and branches, one for
// how to order, book and queue — under category `menu`, replaced rather than
// added to, in every Flow Hub account the org's branches live in. "بكم
// الكنافة؟" is then answered with the price on the menu, and changes the
// moment the price does. Entries the owner wrote by hand are never touched.

import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db, orgsTable, branchesTable, menuCategoriesTable, menuItemsTable, knowledgeBaseTable, businessProfileTable,
  bookingSettingsTable, queuesTable,
} from "@workspace/db";
import { formatMoney, vocab } from "@workspace/menu-shared";
import { publicUrl, menuPath } from "./urls";
import { logger } from "../logger";

export const MENU_CATEGORY = "menu";
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const pending = new Map<number, NodeJS.Timeout>();

/** Debounced: ten edits in a row are one rebuild. */
export function syncMenuKnowledge(orgId: number): Promise<void> {
  const t = pending.get(orgId);
  if (t) clearTimeout(t);
  return new Promise((resolve) => {
    pending.set(orgId, setTimeout(() => {
      pending.delete(orgId);
      rebuild(orgId).catch((err) => logger.warn({ orgId, err: String(err?.message ?? err) }, "menu knowledge sync failed")).finally(resolve);
    }, 1_500));
  });
}

export interface Entry { title: string; content: string; keywords: string | null }

/**
 * Each word of a name with and without «ال». Flow Hub's light stemmer reads
 * «كنافه» as prefix ك + «نافه» and stems it to «افه», while «الكنافه» stems to
 * «كناف» — so "بكم الكنافة؟" never met an entry titled «كنافة». Listing both
 * forms as keywords connects them whichever way the customer writes it.
 */
export function nameKeywords(name: string): string[] {
  const out = new Set<string>();
  for (const w of String(name).split(/\s+/).filter((x) => x.length > 1)) {
    if (!/[\u0600-\u06FF]/.test(w)) { out.add(w); continue; }
    if (w.startsWith("ال")) { out.add(w); out.add(w.slice(2)); }
    else { out.add(w); out.add(`ال${w}`); }
  }
  return [...out];
}

export async function menuEntries(orgId: number): Promise<{ entries: Entry[]; waUserIds: number[]; org: typeof orgsTable.$inferSelect } | null> {
  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, orgId)).limit(1);
  if (!org) return null;
  const v = vocab(org.vertical);
  const [cats, items, branches] = await Promise.all([
    db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, orgId)).orderBy(asc(menuCategoriesTable.sort)),
    db.select().from(menuItemsTable).where(and(eq(menuItemsTable.orgId, orgId), eq(menuItemsTable.isActive, true))).orderBy(asc(menuItemsTable.sort)),
    db.select().from(branchesTable).where(and(eq(branchesTable.orgId, orgId), eq(branchesTable.isActive, true))).orderBy(asc(branchesTable.sort)),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const money = (n: unknown) => formatMoney(Number(n), org.currency, "ar");
  const entries: Entry[] = [];

  for (const i of items) {
    const lines = [`${i.name}${i.nameEn ? ` (${i.nameEn})` : ""}: ${money(i.price)}${i.compareAtPrice ? ` بدلاً من ${money(i.compareAtPrice)}` : ""}.`];
    if (i.categoryId && catName.get(i.categoryId)) lines.push(`من قسم ${catName.get(i.categoryId)}.`);
    if (i.description) lines.push(i.description);
    if (i.durationMin) lines.push(`المدة حوالي ${i.durationMin} دقيقة.`);
    for (const g of i.options ?? []) {
      lines.push(`${g.name}${g.required ? " (اختيار مطلوب)" : ""}: ${g.choices.map((c) => `${c.name}${c.priceDelta ? ` +${money(c.priceDelta)}` : ""}`).join("، ")}.`);
    }
    if (i.calories) lines.push(`${i.calories} سعرة حرارية.`);
    if (i.allergens?.length) lines.push(`يحتوي على: ${i.allergens.join("، ")}.`);
    const tags = (i.tags ?? []).map((t) => ({ new: "جديد", popular: "الأكثر طلباً", spicy: "حار", vegetarian: "نباتي", vegan: "نباتي صرف", chef: "اختيار الشيف", preorder: "بالطلب المسبق", gluten_free: "خالٍ من الجلوتين", offer: "عرض" } as Record<string, string>)[t] ?? t);
    if (tags.length) lines.push(`${tags.join("، ")}.`);
    entries.push({
      title: `${v.item[0]}: ${i.name}`.slice(0, 255),
      content: lines.join("\n"),
      keywords: [...nameKeywords(i.name), i.nameEn, ...(i.tags ?? [])].filter(Boolean).join(" ") || null,
    });
  }

  // A short list per category answers "وش عندكم حلويات؟".
  for (const c of cats.filter((c) => c.isActive)) {
    const inCat = items.filter((i) => i.categoryId === c.id);
    if (!inCat.length) continue;
    entries.push({
      title: `قسم ${c.name}`.slice(0, 255),
      content: `${c.name}${c.nameEn ? ` (${c.nameEn})` : ""}:\n${inCat.map((i) => `• ${i.name} — ${money(i.price)}`).join("\n")}`,
      keywords: [...nameKeywords(c.name), c.nameEn].filter(Boolean).join(" ") || null,
    });
  }

  const hoursOf = (h: Record<string, { open: string; close: string; closed?: boolean }>) =>
    ["0", "1", "2", "3", "4", "5", "6"].map((d) => {
      const x = h?.[d];
      if (!x) return null;
      return `${DAYS_AR[Number(d)]}: ${x.closed ? "مغلق" : `${x.open} – ${x.close}`}`;
    }).filter(Boolean).join("\n");
  const bs = await db.select().from(bookingSettingsTable).where(inArray(bookingSettingsTable.branchId, branches.map((b) => b.id).concat(-1)));
  const qs = await db.select().from(queuesTable).where(and(inArray(queuesTable.branchId, branches.map((b) => b.id).concat(-1)), eq(queuesTable.isActive, true)));
  const branchText = branches.map((b) => [
    `📍 ${b.name}${b.address ? ` — ${b.address}` : ""}`,
    b.mapUrl ? `الموقع: ${b.mapUrl}` : null,
    b.displayPhone ? `الهاتف: ${b.displayPhone}` : null,
    hoursOf(b.hours as any) ? `ساعات العمل:\n${hoursOf(b.hours as any)}` : null,
    `المنيو: ${publicUrl(menuPath(org.slug, b.slug))}`,
  ].filter(Boolean).join("\n")).join("\n\n");
  entries.push({ title: "الفروع وساعات العمل والموقع", content: branchText || "—", keywords: "location address hours open close فروع موقع عنوان دوام" });

  const main = branches[0];
  const how: string[] = [];
  if (main) how.push(`المنيو كامل بالصور والأسعار: ${publicUrl(menuPath(org.slug, main.slug))}`);
  how.push(`للطلب: اختر من المنيو واضغط «${v.orderCta[0]}» — يوصلنا الطلب مرتّباً هنا على واتساب.`);
  if (qs.length) how.push(`${v.queue[0]}: من نفس الرابط اضغط «احجز دورك» وتشوف كم قدامك والوقت التقريبي، ونرسل لك هنا لما يجي دورك. لمعرفة دورك أرسل «كم قدامي».`);
  if (bs.some((x) => x.enabled)) how.push(`${v.booking[0]}: من نفس الرابط اضغط «${v.bookCta[0]}» واختر الوقت.`);
  entries.push({ title: "طريقة الطلب والحجز والدور", content: how.join("\n"), keywords: "order book queue menu طلب حجز دور منيو قائمة" });

  const waUserIds = [...new Set(branches.map((b) => b.waUserId).concat(org.ownerUserId))];
  return { entries, waUserIds, org };
}

export async function rebuild(orgId: number): Promise<number> {
  const r = await menuEntries(orgId);
  if (!r) return 0;
  const { entries, waUserIds, org } = r;
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeBaseTable).where(and(inArray(knowledgeBaseTable.userId, waUserIds), eq(knowledgeBaseTable.category, MENU_CATEGORY)));
    for (const userId of waUserIds) {
      if (entries.length) await tx.insert(knowledgeBaseTable).values(entries.map((e) => ({ userId, ...e, category: MENU_CATEGORY })));
      // The agent's standing context: filled from the shop once, never over the owner's own words.
      await tx.insert(businessProfileTable).values({
        userId, name: org.name, industry: vocab(org.vertical).label[0],
        description: org.about ?? org.tagline ?? null, tone: "friendly",
      }).onConflictDoNothing();
    }
  });
  return entries.length;
}
