// ── «أرسله لزبائني» ───────────────────────────────────────────────
// A deal the owner made, sent now to a segment of the customers who agreed
// to offers. The message is written from the deal itself (what it takes off,
// from how much, until when, the code or «automatic»), the owner may edit
// it, and the same guard as the weekly campaign checks it: every number must
// be one the shop published, the menu link and the opt-out line are added.
// It goes out as a campaign in Flow Hub's engine — pacing, the delivery
// guard, the month's messages — and a deal is not sent twice in three days.

import { and, eq } from "drizzle-orm";
import { db, shopDealsTable, campaignsTable, type Org, type Branch } from "@workspace/db";
import { dealLabel, formatMoney } from "@workspace/menu-shared";
import { audience, toList, isSegment, SEGMENTS, type Segment } from "../wa-auto/audience";
import { gatherFacts, guardMessage, OPT_OUT_LINE, type Facts } from "../wa-auto/autopilot";
import { startCampaignSafely } from "../wa-auto/start";
import { toDeal } from "./deals";

export const COOLDOWN_DAYS = 3;
const DAY = 86_400_000;

type DealRow = typeof shopDealsTable.$inferSelect;

/** The message, from the deal. Pure. */
export function dealMessage(d: ReturnType<typeof toDeal>, o: { shop: string; currency: string; link: string; tz: string }): string {
  const cur = formatMoney(0, o.currency, "ar").replace(/^0\s*/, "");
  const L = ["أهلاً {الاسم} 👋", `عرض من ${o.shop}: *${d.title}* — ${dealLabel(d, cur)}`];
  const conds: string[] = [];
  if (d.minSubtotal > 0) conds.push(`على الطلبات من ${formatMoney(d.minSubtotal, o.currency, "ar")}`);
  if (d.fromTime && d.toTime) conds.push(`من ${d.fromTime} إلى ${d.toTime}`);
  if (d.endsAt) conds.push(`حتى ${new Intl.DateTimeFormat("ar-AE-u-nu-latn", { timeZone: o.tz, day: "numeric", month: "long" }).format(new Date(d.endsAt))}`);
  if (conds.length) L.push(conds.join(" · "));
  L.push(d.code ? `اكتب الكود في السلة: *${d.code}*` : "يُطبّق تلقائياً في السلة.");
  L.push("", `المنيو والطلب: ${o.link}`, "", OPT_OUT_LINE);
  return L.join("\n");
}

/** The guard's facts, with the deal's own numbers counted as published. */
function factsWithDeal(f: Facts, d: ReturnType<typeof toDeal>): Facts {
  return { ...f, text: `${f.text} ${d.title} ${d.value} ${d.minSubtotal} ${d.maxDiscount ?? ""} ${d.code ?? ""} ${d.fromTime ?? ""} ${d.toTime ?? ""} ${d.endsAt ? new Date(d.endsAt).getDate() : ""}` };
}

async function ownDeal(orgId: number, id: number) {
  const [r] = await db.select().from(shopDealsTable).where(and(eq(shopDealsTable.id, id), eq(shopDealsTable.orgId, orgId))).limit(1);
  return r ?? null;
}

export async function previewBroadcast(org: Org, branch: Branch, dealId: number) {
  const row = await ownDeal(org.id, dealId);
  if (!row) return null;
  const d = toDeal(row);
  const facts = await gatherFacts(org, branch);
  const counts = await Promise.all((Object.keys(SEGMENTS) as Segment[]).map(async (s) => ({ key: s, label: SEGMENTS[s].ar, count: (await audience(org, branch.waUserId, s, { restDays: COOLDOWN_DAYS })).length })));
  const last = (row.broadcasts ?? []).at(-1);
  return {
    message: dealMessage(d, { shop: org.name, currency: org.currency, link: facts.link, tz: org.timezone }),
    segments: counts, last: last ?? null,
    waitDays: last ? Math.max(0, Math.ceil((new Date(last.at).getTime() + COOLDOWN_DAYS * DAY - Date.now()) / DAY)) : 0,
  };
}

export type BroadcastResult = { ok: true; count: number; started: boolean; note?: string; campaignId: number } | { ok: false; error: string };

export async function sendBroadcast(org: Org, branch: Branch, dealId: number, segment: unknown, edited?: unknown): Promise<BroadcastResult> {
  const row: DealRow | null = await ownDeal(org.id, dealId);
  if (!row) return { ok: false, error: "العرض غير موجود" };
  if (!isSegment(segment)) return { ok: false, error: "اختر لمن يُرسل" };
  const d = toDeal(row);
  if (!d.isActive || (d.endsAt && new Date(d.endsAt).getTime() < Date.now())) return { ok: false, error: "العرض متوقف أو منتهٍ — فعّله أولاً" };
  const last = (row.broadcasts ?? []).at(-1);
  if (last && Date.now() - new Date(last.at).getTime() < COOLDOWN_DAYS * DAY) return { ok: false, error: `أُرسل هذا العرض قبل أقل من ${COOLDOWN_DAYS} أيام — الإرسال المتكرر يزعج الزبائن ويعرّض الرقم للحظر` };
  const people = await audience(org, branch.waUserId, segment, { restDays: COOLDOWN_DAYS });
  if (!people.length) return { ok: false, error: "لا يوجد في هذه الشريحة زبائن وافقوا على العروض ولم تصلهم رسالة في آخر 3 أيام" };
  const facts = await gatherFacts(org, branch);
  const draft = typeof edited === "string" && edited.trim() ? edited : dealMessage(d, { shop: org.name, currency: org.currency, link: facts.link, tz: org.timezone });
  const v = guardMessage(draft, factsWithDeal(facts, d));
  if (!v.ok) return { ok: false, error: `الرسالة تحتاج تعديلاً: ${v.problems.join("، ")}` };
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: org.timezone }).format(new Date());
  const list = await toList(branch.waUserId, `عرض «${d.title}» — ${SEGMENTS[segment].ar} — ${stamp}`, "من «أرسله لزبائني»: زبائن وافقوا على العروض", people, { fresh: true });
  if (!list.groupId) return { ok: false, error: "تعذّر تجهيز قائمة الإرسال" };
  const [c] = await db.insert(campaignsTable).values({
    userId: branch.waUserId, name: `عرض: ${d.title} — ${stamp}`, status: "draft", contactGroupId: list.groupId,
    message: v.message, messageType: "text", companyName: org.name, pacingMode: "auto",
  }).returning();
  const r = await startCampaignSafely(branch.waUserId, c!.id);
  // Not now (WhatsApp unlinked, today's allowance used): it waits and starts by itself within the day.
  if (!r.ok && r.retry) await db.update(campaignsTable).set({ scheduledAt: new Date() }).where(eq(campaignsTable.id, c!.id));
  if (!r.ok && !r.retry) {
    await db.delete(campaignsTable).where(eq(campaignsTable.id, c!.id));
    return { ok: false, error: r.reason ?? "تعذّر بدء الإرسال" };
  }
  await db.update(shopDealsTable).set({ broadcasts: [...(row.broadcasts ?? []), { campaignId: c!.id, at: new Date().toISOString(), count: people.length, segment }] }).where(eq(shopDealsTable.id, row.id));
  return { ok: true, count: people.length, started: r.ok, note: r.ok ? undefined : r.reason, campaignId: c!.id };
}
