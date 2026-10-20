// ── The Menu For You sales employee: the moving parts ─────────────
// Settings in platform_settings («sales»); product facts written from the plan
// matrix, so the seller quotes what the plans really say; every message
// composed by the model, checked by the guard, and replaced by a template when
// the guard fails it; every send, reply, click and lesson kept on the shop.

import { messagingSettings, marketingSend } from "../wa-buttons";
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db, platformSettingsTable, salesProspectsTable, salesTouchesTable, waThreadMessagesTable, unsubscribedPhonesTable, contactMemoryTable,
  type SalesProspect, type SalesStage, type TouchKind,
} from "@workspace/db";
import { bulletsFor, localParts } from "@workspace/menu-shared";
import { complete, type LlmMessage } from "../llm";
import { loadPlans, trialSettings } from "../plans";
import { publicUrl, menuPath } from "../menu/urls";
import { classify } from "../intent";
import { remember, memoryPreamble } from "../agent-memory";
import { detectAutoresponder } from "../autoresponder";
import { isHumanHeld } from "../lead-card";
import { notify } from "../telegram";
import { sendMessage } from "../whatsapp";
import { isFirewallError, isFirewallRefusal } from "../wa-firewall";
import { logger } from "../logger";
import { receipt } from "../graph/receipts";
import { asAgent } from "../agent-context";
import {
  DEFAULT_SETTINGS, LINK_KEYS, VERTICAL_AR, cleanSalesSettings, guardMessage, numbersIn, prospectCard, sellerPrompt, taskFor,
  templateFollowUp, templateOpener, askedIfBot, SELLER_ROLE, OPENER_ANGLES, latinOnly, ruleFacts, mergeFacts, type LinkKey, type Mode, type SalesSettings, type SalesStep, type SalesVertical,
} from "./brief";

/** Tests run without a model: templates only, rule facts only. */
const NO_MODEL = () => process.env["SALES_NO_MODEL"] === "1";

// ── Settings ──────────────────────────────────────────────────────

let cache: { at: number; s: SalesSettings } | null = null;
export function invalidateSalesSettings() { cache = null; }

export async function salesSettings(): Promise<SalesSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.s;
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "sales")).limit(1);
  const s = cleanSalesSettings(row?.value ?? {}, DEFAULT_SETTINGS);
  cache = { at: Date.now(), s };
  return s;
}

export async function saveSalesSettings(patch: unknown): Promise<SalesSettings> {
  const s = cleanSalesSettings(patch, await salesSettings());
  await db.insert(platformSettingsTable).values({ key: "sales", value: s as any })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: s as any, updatedAt: new Date() } });
  invalidateSalesSettings();
  return s;
}

/** Where each link points: the admin's own, or the demo shops and the sign-up page. */
export function linkTargets(s: SalesSettings): Record<LinkKey, string> {
  const d: Record<LinkKey, string> = {
    restaurant: publicUrl(menuPath("bait-shami")), cafe: publicUrl(menuPath("bait-shami")), sweets: publicUrl(menuPath("alreem-sweets")),
    salon: publicUrl(menuPath("lamsa-salon")), barber: publicUrl(menuPath("alfaris-barber")), signup: publicUrl("/login?register=1"), video: "",
  };
  const out = {} as Record<LinkKey, string>;
  for (const k of LINK_KEYS) {
    const v = s.links[k]?.trim();
    out[k] = v ? (v.startsWith("/") ? publicUrl(v) : v) : d[k];
  }
  return out;
}

/** The URL a shop is sent for a link: tracked through /s/ when that is on. */
export function linkFor(s: SalesSettings, p: Pick<SalesProspect, "token">, key: LinkKey): string | null {
  const target = linkTargets(s)[key];
  if (!target) return null;
  return s.trackLinks ? publicUrl(`/s/${p.token}/${key}`) : target;
}

export const demoKey = (s: SalesSettings, vertical: string | null | undefined): LinkKey => {
  const t = linkTargets(s);
  return vertical && vertical in VERTICAL_AR && t[vertical as LinkKey] ? (vertical as LinkKey) : "restaurant";
};

// ── Product facts, from the plan matrix ───────────────────────────

let factsCache: { at: number; text: string; numbers: Set<string> } | null = null;

export async function productFacts(): Promise<{ text: string; numbers: Set<string> }> {
  if (factsCache && Date.now() - factsCache.at < 60_000) return factsCache;
  const [plans, trial] = await Promise.all([loadPlans(), trialSettings()]);
  const pub = [...plans.values()].filter((p) => p.isPublic && p.isActive && p.key !== "trial").sort((a, b) => a.priceMonthly - b.priceMonthly);
  const after = plans.get(trial.afterPlan);
  const lines = [
    "- منيو فور يو منصة للمحلات في الخليج: منيو رقمي بالصور برابط وQR، يطلب منه الزبون ويوصل الطلب للمحل على واتساب مرتباً، بلا عمولة على الطلبات — اشتراك ثابت.",
    "- للصالونات والحلاقين: صف انتظار رقمي يأخذ فيه الزبون دوره من جواله ويصله «جاء دورك» على واتساب، وحجوزات ومواعيد مع تذكير.",
    "- يرجّع الزبائن: رسائل واتساب تلقائية، كوبونات وعروض بالساعات، بطاقة أختام، هدية عيد ميلاد، «ادعُ صديقاً»، بطاقات هدايا، وطلب تقييم قوقل — حسب الخطة.",
    "- الإعداد دقائق: يستورد المنيو من رابط أو صورة، ويطبع QR جاهزاً، ويعمل بالعربي والإنجليزي.",
    "- الخطط (السعر شهرياً بالدرهم):",
    ...pub.map((p) => {
      const price = p.contactSales ? "بالتواصل" : p.priceMonthly === 0 ? "مجانية" : `${p.priceMonthly} درهم شهرياً${p.priceYearly ? ` أو ${p.priceYearly} درهم سنوياً` : ""}`;
      const bullets = (p.bullets.length ? p.bullets : bulletsFor(p)).slice(0, 7).join("، ");
      return `  • ${p.name}: ${price} — ${bullets}`;
    }),
    `- التجربة المجانية: ${trial.days} يوماً بكل المزايا، بالتسجيل برقم الجوال وبلا بطاقة دفع. تمتد ${trial.extensionDays} يوماً إن ربط واتساب وأضاف ${trial.extensionMinItems} أصناف خلال ${trial.extensionWithinDays} أيام من التسجيل.${after ? ` بعدها ينتقل لخطة «${after.name}» إن لم يشترك.` : ""}`,
  ];
  const text = lines.join("\n");
  factsCache = { at: Date.now(), text, numbers: new Set(numbersIn(text)) };
  return factsCache;
}

// ── Composing ─────────────────────────────────────────────────────

export interface Composed { ok: boolean; text: string; linkKeys: string[]; by: "ai" | "template" | "human"; issues: string[]; fallback: boolean }

async function threadOf(waUserId: number, phone: string, limit = 14): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const rows = await db.select({ text: waThreadMessagesTable.text, fromMe: waThreadMessagesTable.fromMe }).from(waThreadMessagesTable)
    .where(and(eq(waThreadMessagesTable.userId, waUserId), eq(waThreadMessagesTable.phone, phone)))
    .orderBy(desc(waThreadMessagesTable.createdAt)).limit(limit);
  return rows.reverse().filter((r) => r.text?.trim()).map((r) => ({ role: r.fromMe ? "assistant" as const : "user" as const, content: r.text!.slice(0, 1200) }));
}

async function earlierOutbound(prospectId: number): Promise<string[]> {
  const rows = await db.select({ text: salesTouchesTable.text }).from(salesTouchesTable)
    .where(and(eq(salesTouchesTable.prospectId, prospectId), inArray(salesTouchesTable.kind, ["opener", "followup", "reply"]), inArray(salesTouchesTable.status, ["sent", "dry"])));
  return rows.map((r) => r.text ?? "").filter(Boolean);
}

/** Join consecutive turns of one side; models want them alternating. */
function alternate(turns: Array<{ role: "user" | "assistant"; content: string }>) {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const t of turns) { const last = out[out.length - 1]; if (last && last.role === t.role) last.content += `\n${t.content}`; else out.push({ ...t }); }
  return out;
}

export async function composeFor(s: SalesSettings, p: SalesProspect, mode: Mode, o: { stepIndex?: number; incoming?: string; history?: Array<{ role: "user" | "assistant"; content: string }>; noModel?: boolean } = {}): Promise<Composed> {
  const facts = await productFacts();
  const step: SalesStep | undefined = mode === "followup" ? s.steps[o.stepIndex ?? p.step] : undefined;
  const wantKey: LinkKey | null = step?.link === "demo" ? demoKey(s, p.vertical) : step?.link === "signup" ? "signup" : null;
  const requiredUrl = wantKey ? linkFor(s, p, wantKey) : null;
  // A follow-up carries its own link only; a reply may use any of them.
  const offered: Partial<Record<LinkKey, string>> = {};
  if (mode === "reply") for (const k of LINK_KEYS) { const u = linkFor(s, p, k); if (u) offered[k] = u; }
  else if (wantKey && requiredUrl) offered[wantKey] = requiredUrl;
  const urlToKey = new Map(Object.entries(offered).map(([k, u]) => [u!, k]));
  const previous = await earlierOutbound(p.id);
  const ctx = { mode, allowedUrls: Object.values(offered) as string[], requiredUrl, allowedNumbers: new Set([...facts.numbers, ...numbersIn(s.offer)]), previous, askedIfBot: !!o.incoming && askedIfBot(o.incoming), hasStopButton: mode !== "reply" && (await messagingSettings()).stopButton };

  const template = (): Composed => {
    if (mode === "reply") return { ok: false, text: "", linkKeys: [], by: "template", issues: ["لا قالب للرد — يُترك لبشري"], fallback: true };
    const text = mode === "opener" ? templateOpener(s, p) : templateFollowUp(s, o.stepIndex ?? p.step, p, requiredUrl);
    const g = guardMessage(text, { ...ctx, previous: [] });
    return { ok: true, text: g.text, linkKeys: g.links.map((u) => urlToKey.get(u) ?? u), by: "template", issues: g.issues, fallback: false };
  };
  if (o.noModel || NO_MODEL() || (mode === "opener" && s.openerMode === "template")) return template();

  const memory = s.waUserId ? await memoryPreamble(s.waUserId, "sales").catch(() => "") : "";
  const angles = OPENER_ANGLES[(p.vertical && p.vertical in OPENER_ANGLES ? p.vertical : "restaurant") as SalesVertical];
  const angle = mode === "opener" ? angles[randomInt(angles.length)] : undefined;
  const system = sellerPrompt({ s, product: facts.text, links: offered, memory, card: prospectCard(p as any), mode, task: taskFor(mode, s, step, requiredUrl, angle, latinOnly(p.business ?? p.name)) });
  let turns = alternate(o.history ?? (s.waUserId ? await threadOf(s.waUserId, p.phone) : []));
  if (mode === "reply" && o.incoming && turns[turns.length - 1]?.content.includes(o.incoming) !== true) turns = alternate([...turns, { role: "user", content: o.incoming }]);
  if (mode !== "reply") turns = alternate([...turns, { role: "user", content: "[ملاحظة داخلية من الفريق: اكتب الرسالة المطلوبة في «مهمتك الآن» — لا ترد على هذه الملاحظة]" }]);
  while (turns[0]?.role === "assistant") turns = [{ role: "user", content: "[بداية المحادثة]" }, ...turns];

  const issuesAll: string[] = [];
  let messages: LlmMessage[] = [{ role: "system", content: system }, ...turns];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await asSeller(s, () => complete(messages, 25_000)).catch(() => null);
    if (!out?.text?.trim()) { issuesAll.push("تعذّر النموذج"); break; }
    const g = guardMessage(out.text, ctx);
    if (g.ok) return { ok: true, text: g.text, linkKeys: g.links.map((u) => urlToKey.get(u) ?? u), by: "ai", issues: [...issuesAll, ...g.issues], fallback: false };
    issuesAll.push(...g.issues);
    messages = [...messages, { role: "assistant", content: out.text }, { role: "user", content: `[ملاحظة داخلية: رسالتك رُفضت لأن: ${g.issues.join("؛ ")}. أعد كتابتها ملتزماً بالقواعد — نص الرسالة فقط]` }];
  }
  const t = template();
  return { ...t, issues: [...issuesAll, ...t.issues], fallback: true };
}

/** سارة's thinking, on her receipts and under the account's off switch — when she has a number. */
const asSeller = <T>(s: SalesSettings, fn: () => Promise<T>) => (s.waUserId ? asAgent(s.waUserId, SELLER_ROLE, fn) : fn());

// ── Touches and delivery ──────────────────────────────────────────

export async function addTouch(p: Pick<SalesProspect, "id" | "waUserId">, kind: TouchKind, o: { text?: string | null; step?: number | null; links?: string[]; by?: string; status?: string; meta?: Record<string, unknown> } = {}) {
  await db.insert(salesTouchesTable).values({ prospectId: p.id, waUserId: p.waUserId, kind, step: o.step ?? null, text: o.text ?? null, links: o.links ?? [], by: o.by ?? "system", status: o.status ?? "sent", meta: o.meta ?? null });
  // سارة's own acts — what she wrote and what she moved — on the receipts.
  if (kind === "opener" || kind === "followup" || kind === "reply" || kind === "stage") {
    const st = o.status ?? "sent";
    receipt({
      userId: p.waUserId, node: SELLER_ROLE, graph: "platform", action: `sales.${kind}`,
      status: st === "failed" ? "failed" : st === "dry" ? "deferred" : "ok",
      inputRef: `prospect:${p.id}`, evidence: { step: o.step ?? null, by: o.by ?? "system", status: st, links: o.links ?? [] },
      why: (o.text ?? "").slice(0, 300) || null,
    });
  }
}

/**
 * Send (or, in a dry run, only record) one composed message. "held" is the
 * firewall's no for the number today (frozen, out of hours, the cold budget
 * spent): nothing was sent, nothing failed, and the engine stops for today.
 */
export async function deliver(s: SalesSettings, p: SalesProspect, kind: "opener" | "followup" | "reply", c: Composed, step: number | null, now = new Date()): Promise<"sent" | "dry" | "failed" | "held"> {
  let status: "sent" | "dry" | "failed" = s.dryRun ? "dry" : "sent";
  let error: string | undefined;
  if (!s.dryRun) {
    try {
      // Our first message and follow-ups carry the stop button; a reply in a conversation does not.
      const stop = kind !== "reply" && (await messagingSettings()).stopButton ? marketingSend("text", null) : null;
      // The firewall (lib/wa-firewall.ts): سارة writing first is a campaign
      // message — cold, budgeted, refused to anyone who said no; her answer to
      // a prospect who wrote is a reply.
      const fw = { kind: kind === "reply" ? "reply" as const : "campaign" as const };
      // As سارة, so the send's receipt is hers.
      if (stop) await asAgent(s.waUserId!, SELLER_ROLE, () => sendMessage(s.waUserId!, p.phone, c.text, stop.messageType, null, stop.buttons, null, fw));
      else await asAgent(s.waUserId!, SELLER_ROLE, () => sendMessage(s.waUserId!, p.phone, c.text, undefined, undefined, undefined, undefined, fw));
    } catch (e: any) {
      if (isFirewallError(e)) {
        logger.info({ prospectId: p.id, kind, why: String(e?.message ?? e).slice(0, 160) }, "sales: الحاجز أوقف الإرسال لليوم");
        return "held";
      }
      status = "failed"; error = String(e?.message ?? e).slice(0, 200);
      // «No» is final: whoever asked us to stop is closed here too.
      if (isFirewallRefusal(e)) await setStage(p, "stopped", "طلب الإيقاف");
    }
  }
  await addTouch(p, kind, { text: c.text, step, links: c.linkKeys, by: c.by, status, meta: { issues: c.issues, fallback: c.fallback, ...(error ? { error } : {}) } });
  if (status !== "failed") {
    const linksSent = [...(p.linksSent ?? []), ...c.linkKeys.map((key) => ({ key, at: now.toISOString() }))].slice(-30);
    await db.update(salesProspectsTable).set({ lastSentAt: now, linksSent, updatedAt: now }).where(eq(salesProspectsTable.id, p.id));
    p.linksSent = linksSent; p.lastSentAt = now;
  } else if (/not.*(on|registered)|ليس على واتساب|not-exists|404/i.test(error ?? "")) {
    await setStage(p, "stopped", "الرقم ليس على واتساب");
  }
  return status;
}

export async function setStage(p: Pick<SalesProspect, "id" | "waUserId" | "stage">, stage: SalesStage, reason?: string | null, by = "system") {
  if (p.stage === stage) return;
  const closed = ["trial", "won", "lost", "stopped", "paused"].includes(stage);
  await db.update(salesProspectsTable).set({ stage, ...(closed ? { nextAt: null } : {}), stopReason: reason ?? null, updatedAt: new Date() }).where(eq(salesProspectsTable.id, p.id));
  await addTouch(p, "stage", { text: `${p.stage} ← ${stage}${reason ? ` — ${reason}` : ""}`, by, meta: { from: p.stage, to: stage } });
  (p as any).stage = stage;
}

/** When the next follow-up is due: from the first message, never sooner than tomorrow, and never on the heels of their reply. Pure. */
export function nextFollowAt(s: SalesSettings, firstSentAt: Date, stepIndex: number, now: Date, lastReplyAt?: Date | null): Date | null {
  const st = s.steps[stepIndex];
  if (!st) return null;
  const day = 86_400_000;
  let t = firstSentAt.getTime() + st.day * day;
  t = Math.max(t, now.getTime() + day);
  if (lastReplyAt) t = Math.max(t, lastReplyAt.getTime() + s.warmGapDays * day);
  return new Date(t);
}

// ── Opener and follow-up ──────────────────────────────────────────

export async function sendOpener(s: SalesSettings, p: SalesProspect, now = new Date()) {
  const c = await composeFor(s, p, "opener");
  const status = await deliver(s, p, "opener", c, null, now);
  if (status === "failed" || status === "held") return status;
  await db.update(salesProspectsTable).set({ stage: "contacted", step: 0, firstSentAt: now, nextAt: nextFollowAt(s, now, 0, now), updatedAt: now }).where(eq(salesProspectsTable.id, p.id));
  return status;
}

export async function sendFollowUp(s: SalesSettings, p: SalesProspect, now = new Date()) {
  if (p.step >= s.steps.length) {
    if (p.stage === "contacted") await setStage(p, "stopped", "انتهت المتابعات بلا رد");
    else await db.update(salesProspectsTable).set({ nextAt: null }).where(eq(salesProspectsTable.id, p.id));
    return "done" as const;
  }
  const c = await composeFor(s, p, "followup", { stepIndex: p.step });
  const status = await deliver(s, p, "followup", c, p.step, now);
  if (status === "held") return status;
  if (status === "failed") { await db.update(salesProspectsTable).set({ nextAt: new Date(now.getTime() + 6 * 3_600_000) }).where(eq(salesProspectsTable.id, p.id)); return status; }
  const step = p.step + 1;
  await db.update(salesProspectsTable).set({ step, nextAt: nextFollowAt(s, p.firstSentAt ?? now, step, now, p.lastReplyAt), updatedAt: now }).where(eq(salesProspectsTable.id, p.id));
  return status;
}

// ── A reply from a shop ───────────────────────────────────────────

const lastOutboundText = async (prospectId: number) => (await db.select({ text: salesTouchesTable.text }).from(salesTouchesTable)
  .where(and(eq(salesTouchesTable.prospectId, prospectId), inArray(salesTouchesTable.kind, ["opener", "followup", "reply"]), inArray(salesTouchesTable.status, ["sent", "dry"])))
  .orderBy(desc(salesTouchesTable.at)).limit(1))[0]?.text ?? null;

export async function prospectOf(waUserId: number, phone: string): Promise<SalesProspect | null> {
  const [p] = await db.select().from(salesProspectsTable).where(and(eq(salesProspectsTable.waUserId, waUserId), eq(salesProspectsTable.phone, phone))).limit(1);
  return p ?? null;
}

/**
 * Every inbound message on the seller's account: if it is from a shop on the
 * list, it is ours — recorded, its stage moved, learnt from, and answered by
 * the seller (not the shop host). Returns true when it took the message.
 */
export async function handleSalesInbound(ev: { userId: number; phone: string; text: string }, o: { waitMs?: number } = {}): Promise<boolean> {
  const s = await salesSettings();
  if (!s.waUserId || ev.userId !== s.waUserId) return false;
  const p = await prospectOf(s.waUserId, ev.phone);
  if (!p) return false;
  const now = new Date();
  const text = ev.text.trim();
  await addTouch(p, "inbound", { text: text.slice(0, 2000), by: "prospect" });
  const verdict = await classify(text, false);
  const before = p.stage;
  await db.update(salesProspectsTable).set({ replies: sql`${salesProspectsTable.replies} + 1`, lastReplyAt: now, updatedAt: now }).where(eq(salesProspectsTable.id, p.id));
  p.replies += 1; p.lastReplyAt = now;
  const outbound = await lastOutboundText(p.id);

  if (verdict.intent === "opt_out") {
    await db.insert(unsubscribedPhonesTable).values({ userId: s.waUserId, phone: p.phone, reason: "طلب الإيقاف (المبيعات)" }).onConflictDoNothing();
    await setStage(p, "stopped", "طلب الإيقاف");
    if (outbound) await remember(s.waUserId, "sales", "loss", `رسالة جلبت «توقف»: ${outbound.split("\n")[0]}`, p.phone).catch(() => {});
    return true;
  }
  if (verdict.intent === "not_interested") {
    await setStage(p, "lost", "قال لا");
    if (outbound) await remember(s.waUserId, "sales", "loss", `رسالة جلبت رفضاً: ${outbound.split("\n")[0]}`, p.phone).catch(() => {});
    if (s.replies && !s.dryRun) {
      const bye = `ولا يهمك، شكراً على وقتك 🙏 إذا احتجت منيو أو طلبات على واتساب مستقبلاً، أنا موجودة.`;
      await deliver(s, p, "reply", { ok: true, text: bye, linkKeys: [], by: "template", issues: [], fallback: false }, null, now);
    }
    return true;
  }
  // A real reply: the sequence pauses, and resumes later if they go quiet.
  const stage: SalesStage = verdict.intent === "interested" ? "interested" : before === "contacted" || before === "new" ? "replied" : before;
  if (stage !== before && !["trial", "won", "paused"].includes(before)) await setStage(p, stage, verdict.intent === "interested" ? "إشارة اهتمام" : null);
  if (["contacted", "replied", "interested"].includes(p.stage)) {
    await db.update(salesProspectsTable).set({ nextAt: nextFollowAt(s, p.firstSentAt ?? now, p.step, now, now) }).where(eq(salesProspectsTable.id, p.id));
  }
  if (before === "contacted" && outbound) await remember(s.waUserId, "sales", "win", `رسالة جلبت رداً: ${outbound.split("\n")[0]}`, p.phone).catch(() => {});
  if (stage === "interested" && before !== "interested") {
    void notify(s.waUserId, `🔥 محل مهتم بمنيو فور يو — <code>${p.phone}</code>\n${p.business ?? p.name ?? ""}\nقال: «${text.slice(0, 160)}»`).catch(() => {});
  }
  const learning = learnFacts(s, p, text).catch((err) => logger.warn({ err: String(err?.message ?? err) }, "sales: could not learn from reply"));
  if (NO_MODEL()) await learning;

  if (!s.replies || s.dryRun || ["paused", "won"].includes(p.stage)) return true;
  if (await isHumanHeld(s.waUserId, p.phone).catch(() => false)) return true;
  const auto = detectAutoresponder(text, { secondsSinceOurMessage: p.lastSentAt ? (now.getTime() - new Date(p.lastSentAt).getTime()) / 1000 : undefined, isFirstFromThem: p.replies <= 1 });
  if (auto.isAuto) { await addTouch(p, "note", { text: "رد آلي من الطرف الآخر — لم يُرد عليه", by: "system" }); return true; }
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(salesTouchesTable)
    .where(and(eq(salesTouchesTable.prospectId, p.id), eq(salesTouchesTable.kind, "reply"), gte(salesTouchesTable.at, new Date(now.getTime() - 3_600_000))));
  if ((recent?.n ?? 0) >= 6) { await addTouch(p, "note", { text: "تجاوز 6 ردود في الساعة — ينتظر بشرياً", by: "system" }); return true; }

  // A person takes a moment before answering.
  await new Promise((r) => setTimeout(r, o.waitMs ?? 20_000 + randomInt(40_000)));
  const c = await composeFor(s, p, "reply", { incoming: text });
  if (!c.ok) {
    await addTouch(p, "note", { text: `لم يُرسل رد — ${c.issues.join("؛ ").slice(0, 300)}`, by: "system", status: "skipped" });
    void notify(s.waUserId, `⚠️ محل رد ولم يستطع موظف المبيعات الرد بأمان — <code>${p.phone}</code>\n«${text.slice(0, 160)}»`).catch(() => {});
    return true;
  }
  await deliver(s, p, "reply", c, null);
  return true;
}

// ── Memory: what each shop told us ────────────────────────────────

export async function learnFacts(s: SalesSettings, p: SalesProspect, text: string) {
  const rules = ruleFacts(text);
  if (NO_MODEL()) { const facts = mergeFacts(p.facts ?? [], rules, new Date()); await db.update(salesProspectsTable).set({ facts }).where(eq(salesProspectsTable.id, p.id)); return { facts, summary: p.summary, interest: p.interest }; }
  let summary = p.summary, interest = p.interest, vertical = p.vertical, business = p.business;
  let found = rules;
  const history = s.waUserId ? await threadOf(s.waUserId, p.phone, 10) : [];
  const out = await asSeller(s, () => complete([
    { role: "system", content: [
      "أنت مساعد فريق مبيعات منيو فور يو. اقرأ المحادثة مع صاحب المحل واستخرج ما يفيد البيع لاحقاً.",
      "أعد JSON فقط بهذا الشكل بلا أي نص آخر:",
      '{"facts":["حقيقة قصيرة"],"summary":"سطر يلخص أين وصلنا وماذا يريد","interest":0,"vertical":null,"business":null}',
      "facts: من كلامه هو فقط (كيف يستقبل الطلبات، التطبيقات التي يستخدمها، عدد الفروع، اعتراضه، أفضل وقت، من صاحب القرار) — بلا تخمين، 0 إلى 4 عناصر.",
      "interest: 0 غير مهتم، 1 محايد، 2 مهتم، 3 جاهز للتجربة.",
      'vertical: واحد من "restaurant","cafe","sweets","salon","barber" أو null. business: اسم المحل إن ذكره وإلا null.',
      p.summary ? `الخلاصة السابقة: ${p.summary}` : "",
    ].filter(Boolean).join("\n") },
    { role: "user", content: history.map((h) => `${h.role === "user" ? "صاحب المحل" : "نحن"}: ${h.content}`).join("\n").slice(-4000) || `صاحب المحل: ${text}` },
  ], 20_000)).catch(() => null);
  if (out?.text) {
    try {
      const j = JSON.parse(out.text.slice(out.text.indexOf("{"), out.text.lastIndexOf("}") + 1));
      if (Array.isArray(j.facts)) found = [...rules, ...j.facts.filter((f: unknown) => typeof f === "string" && f.trim()).map((f: string) => f.trim().slice(0, 160))];
      if (typeof j.summary === "string" && j.summary.trim()) summary = j.summary.trim().slice(0, 400);
      if (Number.isInteger(j.interest) && j.interest >= 0 && j.interest <= 3) interest = j.interest;
      if (typeof j.vertical === "string" && j.vertical in VERTICAL_AR && !p.vertical) vertical = j.vertical;
      if (typeof j.business === "string" && j.business.trim() && !p.business) business = j.business.trim().slice(0, 160);
    } catch { /* keep the rule facts */ }
  }
  const facts = mergeFacts(p.facts ?? [], found, new Date());
  await db.update(salesProspectsTable).set({ facts, summary, interest, vertical, business, updatedAt: new Date() }).where(eq(salesProspectsTable.id, p.id));
  // The rest of the team (the shop host, the inbox) sees it too.
  if (s.waUserId) {
    await db.insert(contactMemoryTable).values({ userId: s.waUserId, phone: p.phone, facts: facts.map((f) => ({ fact: f.fact, source: "sales", at: f.at })), summary })
      .onConflictDoUpdate({ target: [contactMemoryTable.userId, contactMemoryTable.phone], set: { facts: facts.map((f) => ({ fact: f.fact, source: "sales", at: f.at })), summary, updatedAt: new Date() } });
  }
  return { facts, summary, interest };
}

// ── Clicks and sign-ups ───────────────────────────────────────────

const PREVIEW_UA = /whatsapp|facebookexternalhit|bot|crawler|spider|preview|slurp|curl|wget/i;

/** A shop opened a link we sent: counted (not for link-preview robots) and redirected. */
export async function recordClick(token: string, key: string, ua: string): Promise<string | null> {
  const s = await salesSettings();
  const target = (LINK_KEYS as string[]).includes(key) ? linkTargets(s)[key as LinkKey] : null;
  const [p] = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.token, token)).limit(1);
  if (!p || !target) return target ?? publicUrl("/");
  if (!PREVIEW_UA.test(ua)) {
    const first = p.clicks === 0;
    await db.update(salesProspectsTable).set({ clicks: sql`${salesProspectsTable.clicks} + 1`, lastClickAt: new Date(), updatedAt: new Date() }).where(eq(salesProspectsTable.id, p.id));
    await addTouch(p, "click", { text: key, by: "prospect", meta: { key } });
    if (first && s.waUserId) void notify(s.waUserId, `👀 محل فتح رابط ${key === "signup" ? "التسجيل" : "التجربة"} — <code>${p.phone}</code> ${p.business ?? ""}`).catch(() => {});
  }
  return target;
}

/** Someone registered: if their phone is a shop we have been talking to, that shop is now in its trial. */
export async function markSalesSignup(phone: string, orgId: number | null = null): Promise<number> {
  const tail = phone.replace(/\D/g, "").slice(-9);
  if (tail.length < 8) return 0;
  const rows = await db.select().from(salesProspectsTable).where(sql`right(${salesProspectsTable.phone}, 9) = ${tail} AND ${salesProspectsTable.stage} NOT IN ('trial','won')`);
  for (const p of rows) {
    const out = await lastOutboundText(p.id);
    await setStage(p, "trial", "سجّل في المنصة");
    if (orgId) await db.update(salesProspectsTable).set({ orgId }).where(eq(salesProspectsTable.id, p.id));
    if (out) await remember(p.waUserId, "sales", "win", `آخر رسالة قبل التسجيل: ${out.split("\n")[0]}`, p.phone).catch(() => {});
    void notify(p.waUserId, `🎉 محل من قائمة المبيعات سجّل في التجربة — <code>${p.phone}</code> ${p.business ?? ""}`).catch(() => {});
  }
  return rows.length;
}

/** «علّمه»: a rule the seller keeps from now on. */
export async function teach(text: string, prospectId?: number | null) {
  const s = await salesSettings();
  if (!s.waUserId) throw new Error("اختر رقم واتساب الموظف أولاً");
  let phone: string | undefined;
  if (prospectId) {
    const [p] = await db.select().from(salesProspectsTable).where(eq(salesProspectsTable.id, prospectId)).limit(1);
    if (p) { phone = p.phone; await addTouch(p, "teach", { text, by: "human" }); }
  }
  await remember(s.waUserId, "sales", "instruction", text, phone);
}

// ── Today, in the seller's clock ──────────────────────────────────

export function localMidnight(tz: string, now = new Date()): Date {
  const p = localParts(tz, now);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(guess - offset);
}

export async function sentToday(waUserId: number, tz: string, kinds: TouchKind[], now = new Date()) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(salesTouchesTable)
    .where(and(eq(salesTouchesTable.waUserId, waUserId), inArray(salesTouchesTable.kind, kinds), inArray(salesTouchesTable.status, ["sent", "dry"]), gte(salesTouchesTable.at, localMidnight(tz, now))));
  return r?.n ?? 0;
}

export const newToken = () => Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[randomInt(31)]).join("");

export type { SalesVertical };
