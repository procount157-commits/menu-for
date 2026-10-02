// ── The weekly campaign that runs itself ──────────────────────────
// Once a week, at the hour the owner picked, for each number with the
// autopilot on:
//   1. who — customers who agreed to offers, in the chosen segment, minus
//      anyone a campaign reached in the last few days and anyone who stopped
//   2. what — a short message written from this week's offers and the menu
//      (or the owner's own text), checked by rules before it can go
//   3. how — a campaign in Flow Hub's engine, so pacing, the delivery guard,
//      the warm-up allowance and the operations officer all apply
//   4. when — after the owner approves it (the default), or by itself in
//      auto mode once the guard passes
//
// The guard is deterministic, like the email side's: every number in the
// message must come from the shop's own offers or menu, the opt-out line and
// the menu link must be there, and nothing may promise what was not given.

import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import {
  db, waAutopilotTable, waAutopilotRunsTable, orgsTable, branchesTable, offersTable, menuItemsTable, campaignsTable,
  contactGroupsTable, type WaAutopilot, type WaAutopilotRun, type Org, type Branch,
} from "@workspace/db";
import { formatMoney, localParts, normaliseDigits } from "@workspace/menu-shared";
import { complete } from "../llm";
import { publicUrl, menuPath } from "../menu/urls";
import { audience, toList, isSegment, SEGMENTS, type Segment } from "./audience";
import { startCampaignSafely } from "./start";
import { alertShop } from "../notify/alerts";
import { menuPlan } from "../plans";
import { logger } from "../logger";

export const OPT_OUT_LINE = "لإيقاف العروض أرسل: توقف";

export async function getAutopilot(org: Pick<Org, "id">, waUserId: number): Promise<WaAutopilot> {
  const [row] = await db.select().from(waAutopilotTable).where(eq(waAutopilotTable.waUserId, waUserId)).limit(1);
  if (row) return row;
  const [made] = await db.insert(waAutopilotTable).values({ waUserId, orgId: org.id }).onConflictDoNothing().returning();
  return made ?? (await db.select().from(waAutopilotTable).where(eq(waAutopilotTable.waUserId, waUserId)).limit(1))[0]!;
}

export function cleanAutopilotPatch(b: any): Partial<WaAutopilot> {
  const p: Partial<WaAutopilot> = {};
  if (typeof b.enabled === "boolean") p.enabled = b.enabled;
  if (Number.isInteger(b.weekday) && b.weekday >= 0 && b.weekday <= 6) p.weekday = b.weekday;
  if (Number.isInteger(b.hour) && b.hour >= 9 && b.hour <= 21) p.hour = b.hour;
  if (isSegment(b.audience)) p.audience = b.audience;
  if (b.mode === "approval" || b.mode === "auto") p.mode = b.mode;
  if (b.source === "agent" || b.source === "fixed") p.source = b.source;
  if ("fixedMessage" in b) p.fixedMessage = String(b.fixedMessage ?? "").trim().slice(0, 900) || null;
  if ("instructions" in b) p.instructions = String(b.instructions ?? "").trim().slice(0, 500) || null;
  if (Number.isFinite(Number(b.maxRecipients)) && "maxRecipients" in b) p.maxRecipients = Math.max(10, Math.min(1500, Math.round(Number(b.maxRecipients))));
  if (Number.isFinite(Number(b.restDays)) && "restDays" in b) p.restDays = Math.max(3, Math.min(30, Math.round(Number(b.restDays))));
  return p;
}

/** Due when it is the chosen weekday, at or past the chosen hour, and it has not run in the last five days. Pure. */
export function isDue(cfg: Pick<WaAutopilot, "enabled" | "weekday" | "hour" | "lastRunAt">, tz: string, now = new Date()): boolean {
  if (!cfg.enabled) return false;
  const p = localParts(tz, now);
  if (p.weekday !== cfg.weekday || p.hour < cfg.hour || p.hour >= 21) return false;
  return !cfg.lastRunAt || now.getTime() - cfg.lastRunAt.getTime() > 5 * 24 * 3_600_000;
}

// ── What the message may say ──────────────────────────────────────

export interface Facts { shop: string; link: string; offers: Array<{ title: string; body: string | null }>; items: Array<{ name: string; price: string; tag: string | null }>; text: string }

export async function gatherFacts(org: Org, branch: Branch): Promise<Facts> {
  const now = new Date();
  const [offers, items] = await Promise.all([
    db.select().from(offersTable).where(and(
      eq(offersTable.orgId, org.id), eq(offersTable.isActive, true),
      or(isNull(offersTable.branchId), eq(offersTable.branchId, branch.id)),
      or(isNull(offersTable.startsAt), lte(offersTable.startsAt, now)),
      or(isNull(offersTable.endsAt), gt(offersTable.endsAt, now)),
    )).orderBy(asc(offersTable.sort)).limit(4),
    db.select().from(menuItemsTable).where(and(eq(menuItemsTable.orgId, org.id), eq(menuItemsTable.isActive, true))).orderBy(asc(menuItemsTable.sort)).limit(60),
  ]);
  const featured = items.filter((i) => (i.tags ?? []).some((t) => ["new", "popular", "chef", "offer"].includes(t))).slice(0, 8);
  const facts: Facts = {
    shop: org.name,
    link: publicUrl(menuPath(org.slug, branch.slug)),
    offers: offers.map((o) => ({ title: o.title, body: o.body })),
    items: (featured.length ? featured : items.slice(0, 8)).map((i) => ({
      name: i.name, price: formatMoney(Number(i.price), org.currency, "ar"),
      tag: (i.tags ?? []).includes("new") ? "جديد" : (i.tags ?? []).includes("popular") ? "الأكثر طلباً" : null,
    })),
    text: "",
  };
  // Every number the shop itself has published: what the guard checks against.
  facts.text = [facts.shop, ...offers.flatMap((o) => [o.title, o.body ?? ""]), ...items.map((i) => `${i.name} ${Number(i.price)} ${i.compareAtPrice ?? ""}`)].join(" ");
  return facts;
}

/** With no model, or when the model's text fails the guard: built from the facts, word for word. */
export function fallbackMessage(f: Facts): string {
  const lines = ["أهلاً {الاسم} 👋"];
  if (f.offers[0]) {
    lines.push(`جديدنا هذا الأسبوع في ${f.shop}: *${f.offers[0].title}*`);
    if (f.offers[0].body) lines.push(f.offers[0].body);
  } else if (f.items.length) {
    lines.push(`من ${f.shop} هذا الأسبوع:`);
    for (const i of f.items.slice(0, 3)) lines.push(`• ${i.name} — ${i.price}`);
  } else {
    lines.push(`اشتقنا لك في ${f.shop}.`);
  }
  lines.push("", `المنيو والطلب: ${f.link}`, "", OPT_OUT_LINE);
  return lines.join("\n");
}

export interface GuardVerdict { ok: boolean; problems: string[]; message: string }

const HYPE = /(آخر فرصة|لفترة محدودة جداً|لا تفوّت|عرض لا يتكرر|أسرع قبل|ينتهي اليوم|مضمون|100%|١٠٠٪|الأفضل في|رقم واحد|حصري لك وحدك)/;

/** Rules a message must pass before it may go by itself. Pure. */
export function guardMessage(message: string, f: Facts): GuardVerdict {
  let m = String(message ?? "").trim();
  const problems: string[] = [];
  if (!m) return { ok: false, problems: ["الرسالة فارغة"], message: m };
  // Fixable: the link and the opt-out line are added rather than failed.
  if (!m.includes(f.link)) m = `${m}\n\nالمنيو والطلب: ${f.link}`;
  if (!/توقف|stop/i.test(m)) m = `${m}\n\n${OPT_OUT_LINE}`;
  if (m.length > 900) problems.push("الرسالة طويلة (أكثر من 900 حرف)");
  if (HYPE.test(m)) problems.push("فيها استعجال أو وعد مبالغ فيه");
  // Every number must be one the shop published: no invented price or discount.
  const known = new Set((normaliseDigits(f.text).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
  const body = normaliseDigits(m.replace(f.link, " ")).replace(/https?:\/\/\S+/g, " ");
  for (const n of body.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!known.has(String(Number(n)))) { problems.push(`رقم غير موجود في عروضك أو المنيو: ${n}`); break; }
  }
  return { ok: problems.length === 0, problems, message: m };
}

export async function writeMessage(cfg: WaAutopilot, f: Facts): Promise<{ message: string; writtenBy: string; verdict: GuardVerdict }> {
  if (cfg.source === "fixed" && cfg.fixedMessage) {
    const verdict = guardMessage(cfg.fixedMessage, f);
    return { message: verdict.message, writtenBy: "owner", verdict };
  }
  const prompt = [
    `أنت تكتب رسالة واتساب قصيرة من «${f.shop}» إلى زبون سبق أن زار المحل ووافق على استلام العروض.`,
    "القواعد:",
    "- ٣ إلى ٥ أسطر قصيرة، بلهجة خليجية ودودة، تبدأ بـ«أهلاً {الاسم}» كما هي (المتغيّر يُستبدل باسم الزبون).",
    "- استخدم فقط ما في «المعلومات» أدناه. لا تخترع سعراً ولا خصماً ولا صنفاً ولا موعد انتهاء.",
    "- لا استعجال مصطنع («آخر فرصة»، «لا تفوّت»)، ولا مبالغة («الأفضل»، «مضمون»).",
    "- عرض واحد أو صنفان على الأكثر، ثم دعوة واحدة: افتح المنيو أو اطلب.",
    `- اختم بهذين السطرين كما هما:\nالمنيو والطلب: ${f.link}\n${OPT_OUT_LINE}`,
    "- اكتب نص الرسالة فقط، بدون شرح ولا علامات اقتباس.",
    cfg.instructions ? `تعليمات صاحب المحل: ${cfg.instructions}` : "",
    "",
    "المعلومات:",
    f.offers.length ? `العروض الحالية:\n${f.offers.map((o) => `- ${o.title}${o.body ? `: ${o.body}` : ""}`).join("\n")}` : "لا توجد عروض مسجّلة هذا الأسبوع.",
    `من المنيو:\n${f.items.map((i) => `- ${i.name} — ${i.price}${i.tag ? ` (${i.tag})` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n");
  const r = await complete([{ role: "user", content: prompt }], 30_000).catch(() => null);
  if (r?.text) {
    const text = r.text.replace(/^["«]|["»]$/g, "").replace(/^```[a-z]*\n?|```$/g, "").trim();
    const verdict = guardMessage(text, f);
    if (verdict.ok) return { message: verdict.message, writtenBy: "agent", verdict };
    logger.info({ problems: verdict.problems }, "weekly message failed the guard — using the plain one");
  }
  const plain = fallbackMessage(f);
  return { message: plain, writtenBy: "template", verdict: guardMessage(plain, f) };
}

// ── A run ─────────────────────────────────────────────────────────

async function scope(waUserId: number): Promise<{ org: Org; branch: Branch } | null> {
  const rows = await db.select({ b: branchesTable, o: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId))
    .where(and(eq(branchesTable.waUserId, waUserId), eq(branchesTable.isActive, true))).orderBy(asc(branchesTable.sort)).limit(1);
  return rows[0] ? { org: rows[0].o, branch: rows[0].b } : null;
}

async function logRun(v: Partial<WaAutopilotRun> & { waUserId: number; orgId: number; status: string }) {
  const [r] = await db.insert(waAutopilotRunsTable).values(v as any).returning();
  return r!;
}

/**
 * Prepare this week's campaign for a number. `manual` is the owner pressing
 * «جهّز حملة الآن»: it always waits for approval, whatever the mode.
 */
export async function runAutopilot(waUserId: number, opts: { manual?: boolean; now?: Date } = {}): Promise<WaAutopilotRun | null> {
  const sc = await scope(waUserId);
  if (!sc) return null;
  const { org, branch } = sc;
  const cfg = await getAutopilot(org, waUserId);
  const now = opts.now ?? new Date();
  if (!opts.manual) await db.update(waAutopilotTable).set({ lastRunAt: now }).where(eq(waAutopilotTable.waUserId, waUserId));
  const base = { waUserId, orgId: org.id, audience: cfg.audience };

  const plan = await menuPlan(org.ownerUserId);
  if (!plan.features.marketing) return logRun({ ...base, status: "skipped", note: `الحملات غير متاحة في خطة ${plan.planName}` });

  // One campaign of the autopilot's at a time: last week's still waiting or
  // still sending means this week's would pile onto it.
  const [open] = await db.select().from(waAutopilotRunsTable)
    .where(and(eq(waAutopilotRunsTable.waUserId, waUserId), eq(waAutopilotRunsTable.status, "awaiting_approval"))).limit(1);
  if (open) return opts.manual ? open : logRun({ ...base, status: "skipped", note: "حملة الأسبوع الماضي ما زالت بانتظار موافقتك" });

  const people = await audience(org, waUserId, cfg.audience as Segment, { restDays: cfg.restDays, max: cfg.maxRecipients });
  if (people.length < 3) return logRun({ ...base, status: "skipped", recipients: people.length, note: people.length ? "أقل من 3 زبائن في هذه الشريحة هذا الأسبوع" : "لا يوجد زبائن وافقوا على العروض في هذه الشريحة بعد" });

  const facts = await gatherFacts(org, branch);
  const { message, writtenBy, verdict } = await writeMessage(cfg, facts);
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: org.timezone }).format(now);
  const list = await toList(waUserId, `حملة الأسبوع ${stamp} — ${SEGMENTS[cfg.audience as Segment].ar}`, "أنشأها الطيار الآلي: زبائن وافقوا على العروض", people, { fresh: true });
  if (!list.groupId) return logRun({ ...base, status: "failed", note: "تعذّر إنشاء قائمة الحملة" });
  const [campaign] = await db.insert(campaignsTable).values({
    userId: waUserId, name: `حملة الأسبوع — ${stamp}`, status: "draft", contactGroupId: list.groupId,
    message, messageType: "text", companyName: org.name, pacingMode: "auto",
  }).returning();

  const auto = cfg.mode === "auto" && !opts.manual && verdict.ok;
  const run = await logRun({
    ...base, status: auto ? "started" : "awaiting_approval", campaignId: campaign!.id, groupId: list.groupId,
    recipients: people.length, message, writtenBy,
    note: verdict.ok ? null : `تحتاج مراجعتك: ${verdict.problems.join("، ")}`,
  });
  if (auto) {
    const r = await startCampaignSafely(waUserId, campaign!.id);
    if (!r.ok) {
      await db.update(waAutopilotRunsTable).set({ status: "awaiting_approval", note: `لم تبدأ تلقائياً: ${r.reason}` }).where(eq(waAutopilotRunsTable.id, run.id));
      await alertShop(org, branch, "alert_campaign", `📣 حملة الأسبوع جاهزة لكنها لم تبدأ: ${r.reason}\nراجعها من «واتساب الآلي».`);
      return { ...run, status: "awaiting_approval" };
    }
    await db.update(waAutopilotRunsTable).set({ decidedAt: now }).where(eq(waAutopilotRunsTable.id, run.id));
    await alertShop(org, branch, "alert_campaign", `📣 بدأت حملة الأسبوع إلى ${people.length} زبوناً وافقوا على العروض.`);
  } else if (!opts.manual) {
    await alertShop(org, branch, "alert_campaign", `📣 حملة الأسبوع جاهزة لـ${people.length} زبوناً وتنتظر موافقتك من «واتساب الآلي»:\n\n${message.slice(0, 400)}`);
  }
  return run;
}

async function ownRun(waUserId: number, id: number) {
  const [r] = await db.select().from(waAutopilotRunsTable).where(and(eq(waAutopilotRunsTable.id, id), eq(waAutopilotRunsTable.waUserId, waUserId))).limit(1);
  return r ?? null;
}

export async function approveRun(waUserId: number, id: number, editedMessage?: string): Promise<{ ok: boolean; reason?: string; problems?: string[] }> {
  const run = await ownRun(waUserId, id);
  if (!run || run.status !== "awaiting_approval" || !run.campaignId) return { ok: false, reason: "هذه الحملة لم تعد بانتظار الموافقة" };
  const sc = await scope(waUserId);
  if (!sc) return { ok: false, reason: "الفرع غير موجود" };
  let message = run.message ?? "";
  if (typeof editedMessage === "string" && editedMessage.trim()) {
    // The owner's own words are the owner's decision — only the link and the
    // opt-out line are enforced on them.
    const v = guardMessage(editedMessage, await gatherFacts(sc.org, sc.branch));
    message = v.message;
  }
  await db.update(campaignsTable).set({ message }).where(and(eq(campaignsTable.id, run.campaignId), eq(campaignsTable.userId, waUserId)));
  const r = await startCampaignSafely(waUserId, run.campaignId);
  if (!r.ok) return { ok: false, reason: r.reason };
  await db.update(waAutopilotRunsTable).set({ status: "started", message, decidedAt: new Date(), note: null }).where(eq(waAutopilotRunsTable.id, id));
  return { ok: true };
}

export async function rejectRun(waUserId: number, id: number): Promise<boolean> {
  const run = await ownRun(waUserId, id);
  if (!run || run.status !== "awaiting_approval") return false;
  if (run.campaignId) await db.delete(campaignsTable).where(and(eq(campaignsTable.id, run.campaignId), eq(campaignsTable.userId, waUserId), eq(campaignsTable.status, "draft")));
  if (run.groupId) await db.delete(contactGroupsTable).where(and(eq(contactGroupsTable.id, run.groupId), eq(contactGroupsTable.userId, waUserId)));
  await db.update(waAutopilotRunsTable).set({ status: "rejected", decidedAt: new Date() }).where(eq(waAutopilotRunsTable.id, id));
  return true;
}

export async function recentRuns(waUserId: number, limit = 20) {
  const runs = await db.select().from(waAutopilotRunsTable).where(eq(waAutopilotRunsTable.waUserId, waUserId)).orderBy(desc(waAutopilotRunsTable.id)).limit(limit);
  const ids = runs.map((r) => r.campaignId).filter((x): x is number => !!x);
  const camps = ids.length ? await db.select().from(campaignsTable).where(and(eq(campaignsTable.userId, waUserId))) : [];
  const byId = new Map(camps.map((c) => [c.id, c]));
  return runs.map((r) => {
    const c = r.campaignId ? byId.get(r.campaignId) : null;
    return { ...r, campaign: c ? { status: c.status, sent: c.sentCount, delivered: c.deliveredCount, read: c.readCount, failed: c.failedCount, total: c.totalCount } : null };
  });
}

// ── The clock ─────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

export async function runDueAutopilots(now = new Date()): Promise<number> {
  const rows = await db.select({ cfg: waAutopilotTable, tz: orgsTable.timezone }).from(waAutopilotTable)
    .innerJoin(orgsTable, eq(orgsTable.id, waAutopilotTable.orgId)).where(eq(waAutopilotTable.enabled, true));
  let n = 0;
  for (const { cfg, tz } of rows) {
    if (!isDue(cfg, tz, now)) continue;
    await runAutopilot(cfg.waUserId, { now }).catch((err) => logger.warn({ waUserId: cfg.waUserId, err: String(err?.message ?? err) }, "weekly autopilot failed"));
    n++;
  }
  return n;
}

export function startWaAutopilot() {
  if (timer) return;
  timer = setInterval(() => { runDueAutopilots().catch(() => {}); }, 10 * 60_000);
  timer.unref?.();
  logger.info("WhatsApp weekly autopilot started");
}
