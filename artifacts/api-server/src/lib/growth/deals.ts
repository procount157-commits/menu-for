// ── Coupons and timed deals, on the server ────────────────────────
// The menu shows and previews; this decides. A typed code is checked here
// (its window, its phone, once per phone, its uses), and with no code the
// automatic deal worth most is applied. A use is claimed atomically, so a
// code limited to 50 is used 50 times, not 51.

import { randomInt } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db, shopDealsTable, ordersTable, type ShopDeal, type Org } from "@workspace/db";
import { bestAutoDeal, dealDiscount, dealOpen, dealLabel, normaliseCode, formatMoney, type Deal } from "@workspace/menu-shared";

export function toDeal(r: ShopDeal): Deal & { oncePerPhone: boolean; source: string } {
  return {
    id: r.id, code: r.code, title: r.title, kind: r.kind === "amount" ? "amount" : "pct", value: Number(r.value),
    minSubtotal: Number(r.minSubtotal), maxDiscount: r.maxDiscount == null ? null : Number(r.maxDiscount),
    days: r.days ?? [], fromTime: r.fromTime, toTime: r.toTime, startsAt: r.startsAt, endsAt: r.endsAt,
    maxUses: r.maxUses, uses: r.uses, isActive: r.isActive, phone: r.phone, branchId: r.branchId,
    oncePerPhone: r.oncePerPhone, source: r.source,
  };
}

async function dealsFor(orgId: number, branchId: number) {
  const rows = await db.select().from(shopDealsTable)
    .where(and(eq(shopDealsTable.orgId, orgId), eq(shopDealsTable.isActive, true), or(isNull(shopDealsTable.branchId), eq(shopDealsTable.branchId, branchId))))
    .orderBy(asc(shopDealsTable.id));
  return rows.map(toDeal);
}

/** The automatic deals running now, as the menu shows them. */
export async function liveDeals(org: Pick<Org, "id" | "timezone" | "currency">, branchId: number, now = new Date()) {
  const cur = formatMoney(0, org.currency, "ar").replace(/^0\s*/, "");
  return (await dealsFor(org.id, branchId))
    .filter((d) => !d.code && !d.phone && dealOpen(d, org.timezone, now))
    .map((d) => ({ id: d.id, title: d.title, label: dealLabel(d, cur), kind: d.kind, value: d.value, minSubtotal: d.minSubtotal, maxDiscount: d.maxDiscount, toTime: d.toTime, endsAt: d.endsAt }));
}

/** Whether any code is live, so the cart shows «عندك كود خصم؟» only when it could work. */
export async function hasCodes(orgId: number): Promise<boolean> {
  const [r] = await db.select({ id: shopDealsTable.id }).from(shopDealsTable)
    .where(and(eq(shopDealsTable.orgId, orgId), eq(shopDealsTable.isActive, true), sql`${shopDealsTable.code} IS NOT NULL`,
      sql`(${shopDealsTable.endsAt} IS NULL OR ${shopDealsTable.endsAt} > now())`)).limit(1);
  return !!r;
}

export type Resolved = { deal: ReturnType<typeof toDeal>; discount: number } | { error: string } | null;

/** The deal this order gets: the typed code (or why not), else the best automatic one. */
export async function resolveDeal(org: Pick<Org, "id" | "timezone">, branchId: number, subtotal: number, opts: { code?: string | null; phone?: string | null }, now = new Date()): Promise<Resolved> {
  const code = normaliseCode(opts.code);
  const deals = await dealsFor(org.id, branchId);
  if (!code) {
    const best = bestAutoDeal(deals, subtotal, org.timezone, now);
    return best ? { deal: best.deal, discount: best.discount } : null;
  }
  const d = deals.find((x) => x.code === code);
  if (!d) return { error: "الكود غير صحيح أو منتهي" };
  if (!dealOpen(d, org.timezone, now)) return { error: d.maxUses != null && d.uses >= d.maxUses ? "انتهى عدد مرات استخدام هذا الكود" : "هذا الكود لا يعمل الآن" };
  if (d.phone || d.oncePerPhone) {
    if (!opts.phone) return { error: "اكتب رقم واتسابك لاستخدام هذا الكود" };
    if (d.phone && d.phone !== opts.phone) return { error: "هذا الكود خاص برقم آخر" };
    if (d.oncePerPhone) {
      const [used] = await db.select({ id: ordersTable.id }).from(ordersTable)
        .where(and(eq(ordersTable.orgId, org.id), eq(ordersTable.dealId, d.id), eq(ordersTable.phone, opts.phone), sql`${ordersTable.status} <> 'cancelled'`)).limit(1);
      if (used) return { error: "استخدمت هذا الكود من قبل" };
    }
  }
  const discount = dealDiscount(d, subtotal);
  if (!discount) return { error: d.minSubtotal > subtotal ? `الحد الأدنى للطلب ${d.minSubtotal} لهذا الكود` : "الكود لا ينطبق على هذا الطلب" };
  return { deal: d, discount };
}

/** Take one use; false if it ran out a moment ago. */
export async function claimUse(id: number): Promise<boolean> {
  const r = await db.update(shopDealsTable).set({ uses: sql`${shopDealsTable.uses} + 1` })
    .where(and(eq(shopDealsTable.id, id), sql`(${shopDealsTable.maxUses} IS NULL OR ${shopDealsTable.uses} < ${shopDealsTable.maxUses})`))
    .returning({ id: shopDealsTable.id });
  return r.length > 0;
}

/** Give a use back (the order it was claimed for did not go through). */
export async function releaseUse(id: number) {
  await db.update(shopDealsTable).set({ uses: sql`greatest(0, ${shopDealsTable.uses} - 1)` }).where(eq(shopDealsTable.id, id));
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(prefix: string) {
  return `${prefix}${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`.slice(0, 24);
}

/** A one-time code for one phone — a birthday, a referral reward. */
export async function createPersonalCode(orgId: number, phone: string, o: { title: string; kind: "pct" | "amount"; value: number; days: number; source: string; prefix: string; minSubtotal?: number }) {
  for (let i = 0; i < 5; i++) {
    const code = newCode(o.prefix);
    const [row] = await db.insert(shopDealsTable).values({
      orgId, code, title: o.title, kind: o.kind, value: String(o.value), minSubtotal: String(o.minSubtotal ?? 0),
      endsAt: new Date(Date.now() + o.days * 24 * 3_600_000), maxUses: 1, oncePerPhone: true, phone, source: o.source,
    }).onConflictDoNothing().returning();
    if (row) return row;
  }
  throw new Error("could not make a unique code");
}

// ── What the owner sends ──────────────────────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The owner's form, checked. Returns the row to write or the first problem. Pure. */
export function cleanDeal(b: any): { ok: true; row: Partial<typeof shopDealsTable.$inferInsert> } | { ok: false; error: string } {
  const title = String(b?.title ?? "").trim().slice(0, 80);
  if (!title) return { ok: false, error: "اكتب اسماً للعرض يراه الزبون" };
  const kind = b?.kind === "amount" ? "amount" : "pct";
  const value = Number(b?.value);
  if (!(value > 0) || (kind === "pct" && value > 90)) return { ok: false, error: kind === "pct" ? "النسبة بين 1 و 90" : "اكتب قيمة الخصم" };
  const code = b?.code ? normaliseCode(b.code) : null;
  if (code && !/^[A-Z0-9-]{3,24}$/.test(code)) return { ok: false, error: "الكود من 3 إلى 24 حرفاً إنجليزياً أو رقماً" };
  const fromTime = b?.fromTime ? String(b.fromTime) : null, toTime = b?.toTime ? String(b.toTime) : null;
  if ((fromTime && !TIME.test(fromTime)) || (toTime && !TIME.test(toTime)) || (!!fromTime !== !!toTime)) return { ok: false, error: "حدّد الساعتين (من — إلى) أو اتركهما فارغتين" };
  if (!code && !fromTime && !(Array.isArray(b?.days) && b.days.length) && !b?.endsAt) return { ok: false, error: "العرض التلقائي يحتاج ساعات أو أياماً أو تاريخ انتهاء — وإلا يصير خصماً دائماً" };
  const days = Array.isArray(b?.days) ? [...new Set((b.days as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };
  const num = (v: unknown) => (v === "" || v == null || !(Number(v) > 0) ? null : Number(v));
  return {
    ok: true,
    row: {
      title, kind, value: String(value), code, fromTime, toTime, days,
      minSubtotal: String(num(b?.minSubtotal) ?? 0), maxDiscount: num(b?.maxDiscount) == null ? null : String(num(b?.maxDiscount)),
      startsAt: date(b?.startsAt), endsAt: date(b?.endsAt), maxUses: num(b?.maxUses) == null ? null : Math.round(num(b?.maxUses)!),
      oncePerPhone: !!b?.oncePerPhone, branchId: Number(b?.branchId) || null,
    },
  };
}

/** Where a deal stands right now, for the owner's list. */
export function dealStatus(d: ReturnType<typeof toDeal>, tz: string, now = new Date()): "live" | "scheduled" | "ended" | "off" | "used_up" {
  if (!d.isActive) return "off";
  if (d.maxUses != null && d.uses >= d.maxUses) return "used_up";
  if (d.endsAt && new Date(d.endsAt).getTime() <= now.getTime()) return "ended";
  return dealOpen(d, tz, now) ? "live" : "scheduled";
}
