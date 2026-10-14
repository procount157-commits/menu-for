// ── شمّة: مديرة مكتب الواتساب، وحلقتها ────────────────────────────
// المنقولة من Flow Hub، بلا بريد ولا تصنيف قطاعات: جمهور هذه المنصة أفرادٌ
// لا شركات، فلا قطاع يُصنَّف. ما يبقى هو ما طلبه صاحب العمل بالاسم:
// مديرةٌ «تعطيهم المهام، وتراجع وراءهم، وتقيّم شغلهم».
//
// والحلقة كود: كل خطوةٍ حسابٌ ونتيجتها رقم، والنموذج يُستدعى مرةً واحدة
// ليكتب التقرير من الوقائع — ولا يملك أن يُرسل لأحد ولا أن يُطلق حملة.
//
//   ١ · الفريق     الناقص يُذكر، والموقوف يُذكر بأثره
//   ٢ · القوائم    تنظيف: المكرّر، من طلب الإيقاف، الأسماء الوهمية
//   ٣ · النتائج    كل حملة بالرقم الواحد: من وصلته، من ردّ، من طلب الإيقاف
//   ٤ · التقييم    درجةٌ لكل موظف من أرقامه، ومهمةٌ تصله رسالةً
//   ٥ · المراجعة   هل تحرّكت درجة من أُعطي مهمةً في الدورة السابقة
//   ٦ · التقرير    مرةً في اليوم

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, botEmployeesTable, businessProfileTable, contactsTable, contactGroupsTable, unsubscribedPhonesTable } from "@workspace/db";
import { complete } from "./llm";
import { asAgent } from "./agent-context";
import { charterBlock } from "./roles/charters";
import { notify, esc } from "./telegram";
import { say } from "./agent-comms";
import { receipt } from "./graph/receipts";
import { logger } from "./logger";
import { cleanName } from "./data-desk/clean";
import { evaluateDesk, evaluationFacts, type Evaluation } from "./team/evaluate";

export const WA_MANAGER_ROLE = "chief";
export const WA_TEAM: Record<string, string> = {
  sales: "لا أحد يردّ على من يكتب لنا",
  followup: "لا أحد يتابع من تكلّم ثم سكت",
  support: "لا أحد يجيب أسئلة العملاء الحاليين",
  intake: "لا أحد ينظّف القوائم ويُخرج من طلب الإيقاف",
  collector: "لا أحد يقرأ المحادثات ويصنّف العملاء",
  ops: "لا أحد يراقب علامات الحظر وحدود الإرسال",
  monitor: "لا أحد يراقب صحة الاتصال",
};

export const WA_MIN = 50;
export type WaVerdict = "scale" | "continue" | "rewrite" | "hold" | "watch";
export const WA_VERDICT_AR: Record<WaVerdict, string> = { scale: "وسِّع", continue: "استمر", rewrite: "أعد الكتابة", hold: "أوقِف", watch: "راقب" };
export interface WaFunnel { key: string; label: string; reached: number; read: number; replied: number; positive: number; stops: number; verdict: WaVerdict; why: string }

/** طلب الإيقاف يُقرأ قبل الردود: ثلاثةٌ من كل مئة علامةُ رقمٍ في طريقه للحظر. صِرفة. */
export function judgeWa(f: { reached: number; replied: number; positive: number; stops: number }): { verdict: WaVerdict; why: string } {
  if (f.reached < WA_MIN) return { verdict: "watch", why: `${f.reached} وصلتهم فقط — الحكم يبدأ من ${WA_MIN}` };
  const stop = (f.stops / f.reached) * 100, pos = (f.positive / f.reached) * 100, rep = (f.replied / f.reached) * 100;
  if (stop >= 3) return { verdict: "hold", why: `${f.stops} طلبوا الإيقاف أو رفضوا من ${f.reached} (${stop.toFixed(1)}٪) — فوق ٣٪ خطرٌ على الرقم` };
  if (pos >= 3) return { verdict: "scale", why: `${f.positive} ردّاً نافعاً من ${f.reached} (${pos.toFixed(1)}٪)` };
  if (f.reached >= 150 && f.replied === 0) return { verdict: "rewrite", why: `${f.reached} وصلتهم ولا ردّ واحد` };
  if (f.reached >= 150 && pos < 0.5 && rep < 2) return { verdict: "rewrite", why: `${f.reached} وصلتهم، ${f.replied} ردّوا و${f.positive} نافع — الرسالة لا تفتح حديثاً` };
  return { verdict: "continue", why: `${f.replied} ردّوا من ${f.reached} (${rep.toFixed(1)}٪)، ${f.positive} نافع` };
}

/** تنظيف قائمة: المكرّر داخلها، ومن طلب الإيقاف، والأسماء الوهمية. لا يُحذف ما لا يُتتبّع. */
export async function cleanList(userId: number, groupId: number): Promise<{ checked: number; fixed: number; removed: number; notes: string[] }> {
  const notes: string[] = []; let fixed = 0, removed = 0;
  const rows = await db.select().from(contactsTable).where(eq(contactsTable.groupId, groupId));
  const junk = rows.filter((r) => r.name && cleanName(r.name) === null).map((r) => r.id);
  if (junk.length) { await db.update(contactsTable).set({ name: null }).where(inArray(contactsTable.id, junk)); fixed += junk.length; notes.push(`${junk.length} اسماً وهمياً أُفرغ`); }
  const seen = new Map<string, number>(); const dup: number[] = [];
  for (const r of [...rows].sort((a, b) => a.id - b.id)) { if (seen.has(r.phone)) dup.push(r.id); else seen.set(r.phone, r.id); }
  if (dup.length) { await db.delete(contactsTable).where(inArray(contactsTable.id, dup)); removed += dup.length; notes.push(`${dup.length} رقماً مكرّراً داخل القائمة حُذف`); }
  const phones = [...seen.keys()];
  if (phones.length) {
    const out = await db.select({ phone: unsubscribedPhonesTable.phone }).from(unsubscribedPhonesTable).where(and(eq(unsubscribedPhonesTable.userId, userId), inArray(unsubscribedPhonesTable.phone, phones)));
    if (out.length) { await db.delete(contactsTable).where(and(eq(contactsTable.groupId, groupId), inArray(contactsTable.phone, out.map((o) => o.phone)))); removed += out.length; notes.push(`${out.length} رقماً طلب الإيقاف أُخرج`); }
  }
  return { checked: rows.length, fixed, removed, notes };
}

export interface WaResults { days: number; overall: WaFunnel; campaigns: WaFunnel[]; followup: { drafted: number; sent: number; dropped: number; mode: string; topDrop: string | null }; needsOwner: string[] }

export async function waResults(userId: number, days = 30): Promise<WaResults> {
  // رقم المحادثة يحمل لاحقة الجهاز («…228:0») ورقم الحملة لا يحملها: المطابقة
  // على الرقم مجرّداً — وإلا قيل «لا ردّ واحد» عن حملةٍ ردّ عليها الربع.
  const base = sql`
    WITH m AS (
      SELECT l.campaign_id, c.name AS campaign, split_part(l.phone, ':', 1) AS phone, l.sent_at, l.read_at
      FROM message_logs l JOIN campaigns c ON c.id = l.campaign_id
      WHERE c.user_id = ${userId} AND l.created_at > now() - (${days} || ' days')::interval AND l.status IN ('sent','delivered','read')
    ),
    x AS (
      SELECT m.*,
        EXISTS (SELECT 1 FROM wa_thread_messages t WHERE t.user_id = ${userId} AND split_part(t.phone, ':', 1) = m.phone AND NOT t.from_me AND t.created_at >= m.sent_at) AS replied,
        (SELECT ls.last_intent FROM lead_sources ls WHERE ls.user_id = ${userId} AND split_part(ls.phone, ':', 1) = m.phone AND ls.last_intent_at >= m.sent_at LIMIT 1) AS intent
      FROM m
    )`;
  const AGG = sql`
    count(DISTINCT phone)::int AS reached, count(DISTINCT phone) FILTER (WHERE read_at IS NOT NULL)::int AS read,
    count(DISTINCT phone) FILTER (WHERE replied)::int AS replied,
    count(DISTINCT phone) FILTER (WHERE replied AND intent IN ('interested','question'))::int AS positive,
    count(DISTINCT phone) FILTER (WHERE intent IN ('opt_out','not_interested','complaint'))::int AS stops`;
  const [all, byC, fu, prof] = await Promise.all([
    db.execute<any>(sql`${base} SELECT ${AGG} FROM x`),
    db.execute<any>(sql`${base} SELECT campaign_id AS k, min(campaign) AS label, ${AGG} FROM x GROUP BY campaign_id ORDER BY campaign_id DESC LIMIT 12`),
    db.execute<any>(sql`
      SELECT count(*) FILTER (WHERE verdict = 'send')::int AS drafted, count(*) FILTER (WHERE executed)::int AS sent, count(*) FILTER (WHERE verdict <> 'send')::int AS dropped,
        (SELECT left(reason, 60) FROM followup_deliberations WHERE user_id = ${userId} AND verdict <> 'send' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS top
      FROM followup_deliberations WHERE user_id = ${userId} AND created_at > now() - interval '7 days'`),
    db.select({ m: businessProfileTable.smartFollowup }).from(businessProfileTable).where(eq(businessProfileTable.userId, userId)).limit(1),
  ]);
  const fn = (r: any, key: string, label: string): WaFunnel => {
    const f = { reached: Number(r?.reached ?? 0), read: Number(r?.read ?? 0), replied: Number(r?.replied ?? 0), positive: Number(r?.positive ?? 0), stops: Number(r?.stops ?? 0) };
    return { key, label, ...f, ...judgeWa(f) };
  };
  const campaigns = byC.rows.map((r: any) => fn(r, String(r.k), String(r.label ?? "").slice(0, 60)));
  const f = fu.rows[0] ?? {}, mode = String(prof[0]?.m ?? "dry");
  const needsOwner: string[] = [];
  if (mode !== "live" && Number(f.drafted ?? 0) > 0) needsOwner.push(`المتابعة في وضع التجربة: ${f.drafted} متابعة كُتبت هذا الأسبوع ولم تُرسَل. تشغيلها الحيّ بيدك.`);
  for (const c of campaigns) if (c.verdict === "hold") needsOwner.push(`حملة «${c.label}»: ${c.why}.`);
  return { days, overall: fn(all.rows[0], "all", "الكل"), campaigns, followup: { drafted: Number(f.drafted ?? 0), sent: Number(f.sent ?? 0), dropped: Number(f.dropped ?? 0), mode, topDrop: f.top ?? null }, needsOwner };
}

export interface WaCycle { at: Date; staffing: { total: number; missing: string[]; offDuty: Array<{ name: string; gap: string }> }; cleaned: Array<{ list: string; fixed: number; removed: number; notes: string[] }>; results: WaResults; evaluations: Evaluation[]; brief: { verdict: string; did: string[]; decided: string[]; needs: string[] } | null }

export function waFacts(c: Omit<WaCycle, "brief" | "at">): string {
  const r = c.results, line = (f: WaFunnel) => `• ${f.label}: وصلت ${f.reached} · ردّ ${f.replied} · نافع ${f.positive} · إيقاف ${f.stops} ← ${WA_VERDICT_AR[f.verdict]} (${f.why})`;
  return [
    `الفريق: ${c.staffing.total} موظفاً.${c.staffing.missing.length ? ` ينقصه: ${c.staffing.missing.join("؛ ")}.` : ""}${c.staffing.offDuty.length ? ` متوقفون: ${c.staffing.offDuty.map((o) => `${o.name} — ${o.gap}`).join("؛ ")}.` : " كلهم على رأس العمل."}`,
    c.cleaned.length ? `القوائم: ${c.cleaned.map((x) => `«${x.list}» أُصلح ${x.fixed} وأُخرج ${x.removed}`).join("؛ ")}.` : "القوائم: لا شيء احتاج تنظيفاً.",
    `النتائج (آخر ${r.days} يوماً، بالرقم الواحد لا بالرسالة):`, line(r.overall), ...r.campaigns.slice(0, 5).map(line),
    `المتابعة (٧ أيام): كُتبت ${r.followup.drafted} · أُرسلت ${r.followup.sent} · سقطت ${r.followup.dropped}${r.followup.topDrop ? ` (أكثر الأسباب: ${r.followup.topDrop})` : ""} — الوضع: ${r.followup.mode === "live" ? "حيّ" : r.followup.mode === "off" ? "متوقف" : "تجربة، لا يُرسَل"}.`,
    "تقييم الموظفين:", evaluationFacts(c.evaluations),
    r.needsOwner.length ? "يحتاج صاحب العمل:" : "", ...r.needsOwner.map((x) => `• ${x}`),
  ].filter(Boolean).join("\n");
}

const RULES = [
  "أنتِ تكتبين تقرير الدورة لصاحب العمل. الدورة انتهت: التقييمات حُسبت والمهام وصلت أصحابها — أنتِ تُخبرين.",
  "قواعد لا تُخالف:",
  "١. لا رقم ولا حالة ولا حادثة ليست في «وقائع الدورة». ما لم يُذكر فيها لم يحدث.",
  "٢. الردّ النافع غير الردّ: «مرحبا» ردٌّ وليس نافعاً. لا تسمّي حملةً ناجحة بعدد من ردّوا.",
  "٣. طلب الإيقاف يُقرأ قبل الردود.",
  "٤. الموظف يُذكر باسمه ودرجته وما أُعطي — لا بصفاتٍ عامة.",
  "٥. لا تكتبي مهاماً ولا أرقاماً من عندك: المهام تُضاف من الكود بعد تقريرك. اكتبي الحكم وما فُعل فقط.",
  "اكتبي بهذا الشكل بالضبط ولا تزيدي:",
  "الحكم: <سطر واحد برقمين على الأكثر>", "فعلتُ:", "- <نقطتان إلى أربع، كلٌّ برقمه>", "قرّرتُ:", "- <المهام ولمن ولماذا — أو: لا مهمة جديدة>", "يحتاجك:", "- <ما يحتاج يده — أو: لا شيء>",
].join("\n");

async function writeBrief(userId: number, facts: string): Promise<WaCycle["brief"]> {
  const [[me], [profile]] = await Promise.all([
    db.select().from(botEmployeesTable).where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, WA_MANAGER_ROLE))).limit(1),
    db.select().from(businessProfileTable).where(eq(businessProfileTable.userId, userId)).limit(1),
  ]);
  const system = [`اسمكِ ${me?.name ?? "شمّة"}، ${me?.title ?? "مديرة المبيعات"}${profile?.name ? ` لدى ${profile.name}` : ""} — تُديرين مكتب الواتساب.`, me?.persona ?? "", profile?.description ? `عن العمل: ${profile.description}` : "", charterBlock(WA_MANAGER_ROLE), RULES].filter(Boolean).join("\n\n");
  const out = await asAgent(userId, WA_MANAGER_ROLE, () => complete([{ role: "system", content: system }, { role: "user", content: `وقائع الدورة:\n${facts}` }], 60_000)).catch(() => null);
  if (!out?.text) return null;
  const sec = (name: string, next: string) => (new RegExp(`${name}\\s*[:：]\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:${next})\\s*[:：]|$)`).exec(out.text)?.[1] ?? "").split("\n").map((l) => l.replace(/^[-•*\s]+/, "").trim()).filter((l) => l.length > 2).slice(0, 5);
  return { verdict: /الحكم\s*[:：]\s*(.+)/.exec(out.text)?.[1]?.trim() ?? "", did: sec("فعلتُ", "قرّرتُ|يحتاجك"), decided: sec("قرّرتُ", "يحتاجك"), needs: sec("يحتاجك", "$^") };
}

async function sayOnce(userId: number, fromRole: string, toRole: string, body: string) {
  const [again] = (await db.execute(sql`SELECT 1 FROM agent_messages WHERE user_id = ${userId} AND from_role = ${fromRole} AND to_role = ${toRole} AND body = ${body.slice(0, 2000)} AND created_at > now() - interval '24 hours' LIMIT 1`)).rows;
  if (!again) await say({ userId, fromRole, toRole, kind: "directive", body });
}

export async function runWaManagerCycle(userId: number, opts: { brief?: boolean; notifyOwner?: boolean } = {}): Promise<WaCycle | null> {
  const [me] = await db.select().from(botEmployeesTable).where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, WA_MANAGER_ROLE))).limit(1);
  if (!me?.isActive) return null;
  const team = await db.select().from(botEmployeesTable).where(and(eq(botEmployeesTable.userId, userId), inArray(botEmployeesTable.role, Object.keys(WA_TEAM))));
  const have = new Set(team.map((t) => t.role));
  const staffing = { total: team.length, missing: Object.entries(WA_TEAM).filter(([r]) => !have.has(r)).map(([, g]) => g), offDuty: team.filter((t) => !t.isActive).map((t) => ({ name: t.name, gap: WA_TEAM[t.role] ?? `${t.title ?? t.role} متوقف` })) };

  // ٢ · القوائم — سالم ينظّف، ويبلّغ بما فعل
  const cleaned: WaCycle["cleaned"] = [];
  for (const g of await db.select().from(contactGroupsTable).where(eq(contactGroupsTable.userId, userId))) {
    const c = await cleanList(userId, g.id).catch(() => null);
    if (c && (c.fixed || c.removed)) { cleaned.push({ list: g.name, fixed: c.fixed, removed: c.removed, notes: c.notes }); receipt({ userId, node: "intake", graph: "whatsapp", action: "data.clean", subject: g.name, why: c.notes.join(" · ").slice(0, 500) }); }
  }
  if (cleaned.length) await say({ userId, fromRole: "intake", toRole: WA_MANAGER_ROLE, kind: "report", body: `نظّفتُ ${cleaned.length} قائمة: ${cleaned.map((c) => `«${c.list}» ${c.notes.join("، ")}`).join("؛ ")}.` }).catch(() => {});

  const results = await waResults(userId);
  const evaluations = await evaluateDesk(userId, { desk: "whatsapp", manager: WA_MANAGER_ROLE, managerName: me.name, roles: Object.keys(WA_TEAM) });
  for (const c of results.campaigns.filter((x) => x.verdict === "rewrite" || x.verdict === "hold").slice(0, 2)) await sayOnce(userId, WA_MANAGER_ROLE, "sales", `حملة «${c.label}»: ${WA_VERDICT_AR[c.verdict]} — ${c.why}. من ردّ منها يُجاب عن سؤاله هو، لا بإعادة نص الحملة.`);
  if (results.followup.dropped > results.followup.drafted && results.followup.topDrop) await sayOnce(userId, WA_MANAGER_ROLE, "followup", `سقط من متابعاتك هذا الأسبوع ${results.followup.dropped} وكُتب ${results.followup.drafted}. أكثر الأسباب: «${results.followup.topDrop}».`);

  const base = { staffing, cleaned, results, evaluations };
  let brief: WaCycle["brief"] = null;
  if (opts.brief !== false) {
    brief = await writeBrief(userId, waFacts(base));
    // «قرّرتُ» و«يحتاجك» من الكود لا من النموذج: أول تقريرٍ على منصةٍ
    // أخرى كتب مهاماً لم تُعطَ («١٥ استفساراً يومياً لمدة أسبوع»). النموذج
    // يكتب الحكم وما فُعل؛ والقرارات هي ما قرّره الكود فعلاً، حرفياً.
    if (brief) {
      brief.decided = evaluations.filter((e) => e.task).slice(0, 5).map((e) => `${e.name}: ${e.task}`);
      if (!brief.decided.length) brief.decided = ["لا مهمة جديدة — من يحتاج مهمةً أُعطيها في دورةٍ سابقة ولم تتغيّر."];
      brief.needs = results.needsOwner.length ? results.needsOwner.slice(0, 4) : ["لا شيء."];
    }
    if (brief) {
      const text = [brief.verdict, "فعلتُ:", ...brief.did.map((x) => `• ${x}`), "قرّرتُ:", ...brief.decided.map((x) => `• ${x}`), "يحتاجك:", ...brief.needs.map((x) => `• ${x}`)].join("\n");
      receipt({ userId, node: WA_MANAGER_ROLE, graph: "whatsapp", action: "manager.brief", why: text.slice(0, 900) });
      await db.execute(sql`INSERT INTO manager_reviews (user_id, summary, directives) VALUES (${userId}, ${text}, ${JSON.stringify(evaluations.filter((e) => e.task).map((e) => ({ role: e.role, task: e.task })))}::jsonb)`).catch(() => {});
      if (opts.notifyOwner) await notify(userId, [`<b>🧭 ${esc(me.name)} — تقرير الواتساب</b>`, esc(brief.verdict), brief.did.length ? "<b>فعلتُ</b>" : "", ...brief.did.map((x) => `• ${esc(x)}`), brief.decided.length ? "<b>قرّرتُ</b>" : "", ...brief.decided.map((x) => `• ${esc(x)}`), brief.needs.length ? "<b>يحتاجك</b>" : "", ...brief.needs.map((x) => `• ${esc(x)}`)].filter(Boolean).join("\n")).catch(() => {});
    }
  }
  logger.info({ userId, reached: results.overall.reached, evaluated: evaluations.length, brief: !!brief }, "دورة مديرة الواتساب");
  return { at: new Date(), ...base, brief };
}

export async function waManagerState(userId: number) {
  const [results, last] = await Promise.all([waResults(userId), db.execute<any>(sql`SELECT summary AS text, created_at AS at FROM manager_reviews WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`)]);
  return { results, brief: last.rows[0] ?? null };
}

export function startWaManagerLoop(): void {
  const SIX_H = 6 * 3_600_000; const lastBrief = new Map<number, number>();
  const round = async () => {
    const rows = await db.execute<{ user_id: number }>(sql`
      SELECT DISTINCT e.user_id FROM bot_employees e WHERE e.role = ${WA_MANAGER_ROLE} AND e.is_active
        AND EXISTS (SELECT 1 FROM contact_groups g WHERE g.user_id = e.user_id)
        AND NOT EXISTS (SELECT 1 FROM business_profile b WHERE b.user_id = e.user_id AND b.team_paused)`).catch(() => ({ rows: [] as Array<{ user_id: number }> }));
    for (const u of rows.rows) {
      const userId = Number(u.user_id), due = Date.now() - (lastBrief.get(userId) ?? 0) > 20 * 3_600_000;
      const r = await runWaManagerCycle(userId, { brief: due, notifyOwner: due }).catch((err) => { logger.warn({ userId, err: String(err?.message ?? err) }, "دورة مديرة الواتساب تعذّرت"); return null; });
      if (r?.brief) lastBrief.set(userId, Date.now());
    }
  };
  setTimeout(() => { void round(); setInterval(() => void round(), SIX_H); }, 8 * 60_000);
  logger.info("حلقة مديرة الواتساب بدأت — دورة كل ست ساعات");
}
