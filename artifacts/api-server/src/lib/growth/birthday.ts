// ── A birthday gift ───────────────────────────────────────────────
// After a visit, the ticket, order or booking page asks once: «متى عيد
// ميلادك؟» — day and month only. On the day, at a decent hour, the customer
// gets a greeting from the shop with a one-time code for them alone, valid
// for a week. Giving the date is the consent to that one message a year.

import { and, eq, isNotNull, or, isNull, ne, sql } from "drizzle-orm";
import { db, customersTable, orgsTable, branchesTable, type Org } from "@workspace/db";
import { localParts, vocab } from "@workspace/menu-shared";
import { enqueue } from "../notify/outbox";
import { createPersonalCode } from "./deals";
import { publicUrl, menuPath } from "../menu/urls";
import { menuPlan } from "../plans";
import { logger } from "../logger";

export const DEFAULT_BIRTHDAY = { pct: 15, days: 7 };
export const birthdayPrefs = (org: Pick<Org, "growthPrefs">) => ({ ...DEFAULT_BIRTHDAY, ...(org.growthPrefs?.birthday ?? {}) });

/** A real calendar day (29 February allowed). Pure. */
export function validBirthday(month: unknown, day: unknown): { month: number; day: number } | null {
  const m = Number(month), d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return null;
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= max ? { month: m, day: d } : null;
}

/** Whether the page should ask this customer. */
export async function shouldAskBirthday(org: Pick<Org, "id" | "features">, phone: string | null | undefined): Promise<boolean> {
  if (!org.features?.birthday || !phone) return false;
  const [c] = await db.select({ m: customersTable.birthMonth }).from(customersTable).where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, phone))).limit(1);
  return !!c && c.m == null;
}

export async function saveBirthday(orgId: number, phone: string, month: number, day: number) {
  await db.update(customersTable).set({ birthMonth: month, birthDay: day }).where(and(eq(customersTable.orgId, orgId), eq(customersTable.phone, phone)));
}

/** The greeting. Pure. */
export function birthdayMessage(o: { name: string | null; shop: string; pct: number; days: number; code: string; link: string; services: boolean }): string {
  return [
    `🎂 كل عام وأنت بخير${o.name ? ` يا ${o.name}` : ""}!`,
    `هديتك من ${o.shop}: خصم ${o.pct}% خلال ${o.days} أيام.`,
    "", `الرمز: ${o.code}`,
    o.services ? "اعرض الرمز عند الدفع، أو اكتبه في السلة." : "اكتب الرمز في السلة عند الطلب، أو اعرضه عند الدفع.",
    o.link,
  ].join("\n");
}

/** Whether 29 February birthdays are greeted on the 28th this year. Pure. */
export function birthdayToday(m: number, d: number, today: { month: number; day: number; year: number }): boolean {
  if (m === today.month && d === today.day) return true;
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return m === 2 && d === 29 && !leap(today.year) && today.month === 2 && today.day === 28;
}

export async function runBirthdays(now = new Date()): Promise<number> {
  const orgs = await db.select().from(orgsTable).where(and(eq(orgsTable.status, "active"), sql`(${orgsTable.features}->>'birthday')::boolean IS TRUE`));
  let sent = 0;
  for (const org of orgs) {
    const p = localParts(org.timezone, now);
    if (p.hour < 10 || p.hour >= 20) continue;
    const plan = await menuPlan(org.ownerUserId);
    if (!plan.features.birthday) continue;
    const prefs = birthdayPrefs(org);
    const [main] = await db.select().from(branchesTable).where(and(eq(branchesTable.orgId, org.id), eq(branchesTable.isActive, true))).orderBy(branchesTable.sort).limit(1);
    if (!main) continue;
    const people = await db.select().from(customersTable).where(and(
      eq(customersTable.orgId, org.id), isNotNull(customersTable.birthMonth),
      or(isNull(customersTable.birthdaySentYear), ne(customersTable.birthdaySentYear, p.year)),
      sql`${customersTable.phone} !~ '@'`,
    ));
    for (const c of people) {
      if (!birthdayToday(c.birthMonth!, c.birthDay!, p)) continue;
      // Marked first: a crash after this sends nothing twice.
      const done = await db.update(customersTable).set({ birthdaySentYear: p.year })
        .where(and(eq(customersTable.orgId, org.id), eq(customersTable.phone, c.phone), or(isNull(customersTable.birthdaySentYear), ne(customersTable.birthdaySentYear, p.year)))).returning({ phone: customersTable.phone });
      if (!done.length) continue;
      const deal = await createPersonalCode(org.id, c.phone, { title: "هدية عيد الميلاد", kind: "pct", value: prefs.pct, days: prefs.days, source: "birthday", prefix: "BD" });
      const [b] = c.lastBranchId ? await db.select().from(branchesTable).where(eq(branchesTable.id, c.lastBranchId)).limit(1) : [main];
      const text = birthdayMessage({ name: c.name, shop: org.name, pct: prefs.pct, days: prefs.days, code: deal.code!, link: publicUrl(menuPath(org.slug, (b ?? main).slug)), services: vocab(org.vertical).services });
      await enqueue({ org, waUserId: (b ?? main).waUserId, phone: c.phone, kind: "birthday", text, consented: true, refType: "customer" });
      sent++;
    }
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;
export function startBirthdays() {
  if (timer) return;
  timer = setInterval(() => { runBirthdays().catch((err) => logger.warn({ err: String(err?.message ?? err) }, "birthdays failed")); }, 30 * 60_000);
  timer.unref?.();
}

