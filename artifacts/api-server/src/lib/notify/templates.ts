// ── What each WhatsApp notification says ──────────────────────────
// Defaults in plain Gulf Arabic and English; the owner rewrites any of them
// under «الرسائل». A row exists only once the owner has edited one.

import { and, eq } from "drizzle-orm";
import { db, waTemplatesTable } from "@workspace/db";
import { renderTemplate, type TemplateVars } from "@workspace/menu-shared";

export type TemplateKey =
  | "queue_joined" | "queue_ahead" | "queue_turn" | "queue_recall" | "queue_no_show" | "queue_left"
  | "order_received" | "order_preparing" | "order_ready" | "order_cancelled"
  | "booking_confirmed" | "booking_reminder" | "booking_cancelled"
  | "review_request" | "winback" | "status_reply";

export interface TemplateDef { key: TemplateKey; label: string; ar: string; en: string; marketing?: boolean }

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  { key: "queue_joined", label: "تأكيد الانضمام للصف",
    ar: "أهلاً {الاسم} 👋\nتم تسجيلك في صف {المحل} — {الفرع}.\nرقمك: *{الرقم}*\nقدامك: {قدامك}\nالوقت التقريبي: {الوقت}\n\nتابع دورك مباشرة: {الرابط}\nبنرسل لك هنا لما يقرب دورك.\n\nلمعرفة دورك أرسل: كم قدامي\nللخروج من الصف أرسل: إلغاء الدور",
    en: "Hi {name} 👋\nYou're in the queue at {shop} — {branch}.\nYour number: *{number}*\nAhead of you: {ahead}\nEstimated wait: {eta}\n\nFollow live: {link}\nWe'll message you here when you're close.\n\nSend \"status\" for your position, \"leave queue\" to cancel." },
  { key: "queue_ahead", label: "قرّب دورك",
    ar: "{الاسم}، قرّب دورك ⏳\nرقمك *{الرقم}* — قدامك {قدامك} فقط.\nخلك قريب من {المحل}.",
    en: "{name}, you're almost up ⏳\nNumber *{number}* — only {ahead} ahead of you.\nPlease stay close to {shop}." },
  { key: "queue_turn", label: "جاء دورك",
    ar: "🔔 جاء دورك يا {الاسم}!\nرقمك *{الرقم}* — تفضّل الحين إلى {الفرع}.",
    en: "🔔 It's your turn, {name}!\nNumber *{number}* — please come to {branch} now." },
  { key: "queue_recall", label: "تذكير بالدور",
    ar: "🔔 تذكير: ننتظرك يا {الاسم} — رقمك *{الرقم}*.\nإذا ما وصلت خلال دقائق بننتقل للتالي.",
    en: "🔔 Reminder: we're waiting for you, {name} — number *{number}*.\nIf you're not here in a few minutes we'll move to the next guest." },
  { key: "queue_no_show", label: "فاتك الدور",
    ar: "فاتك دورك يا {الاسم} 😔\nتقدر ترجع للصف من هنا: {الرابط}",
    en: "We missed you, {name} 😔\nYou can rejoin the queue here: {link}" },
  { key: "queue_left", label: "تم الخروج من الصف",
    ar: "تم إلغاء دورك ({الرقم}). نشوفك قريب في {المحل} 🌿",
    en: "Your place ({number}) has been cancelled. Hope to see you soon at {shop} 🌿" },
  { key: "status_reply", label: "الرد على «كم قدامي»",
    ar: "رقمك *{الرقم}*\nقدامك: {قدامك}\nالوقت التقريبي: {الوقت}\n{الرابط}",
    en: "Your number: *{number}*\nAhead of you: {ahead}\nEstimated wait: {eta}\n{link}" },
  { key: "order_received", label: "استلام الطلب",
    ar: "وصلنا طلبك يا {الاسم} ✅\nرقم الطلب: *{الرقم}*\n{التفاصيل}\nالإجمالي: {الاجمالي}\n\nتابع الطلب: {الرابط}",
    en: "We've got your order, {name} ✅\nOrder: *{number}*\n{details}\nTotal: {total}\n\nTrack it: {link}" },
  { key: "order_preparing", label: "الطلب قيد التحضير",
    ar: "طلبك *{الرقم}* قيد التحضير الحين 👨‍🍳",
    en: "Your order *{number}* is being prepared 👨‍🍳" },
  { key: "order_ready", label: "الطلب جاهز",
    ar: "طلبك *{الرقم}* جاهز 🎉\nتفضّل استلمه من {الفرع}.",
    en: "Your order *{number}* is ready 🎉\nPlease collect it from {branch}." },
  { key: "order_cancelled", label: "إلغاء الطلب",
    ar: "نعتذر، تم إلغاء طلبك *{الرقم}*. للاستفسار رد على هذه الرسالة.",
    en: "Sorry, your order *{number}* was cancelled. Reply here if you have any questions." },
  { key: "booking_confirmed", label: "تأكيد الحجز",
    ar: "تم تأكيد حجزك يا {الاسم} ✅\n{التفاصيل}\nالموعد: {الوقت}\n{الفرع}\n\nتفاصيل الحجز أو الإلغاء: {الرابط}",
    en: "Your booking is confirmed, {name} ✅\n{details}\nWhen: {eta}\n{branch}\n\nDetails or cancel: {link}" },
  { key: "booking_reminder", label: "تذكير بالموعد",
    ar: "تذكير بموعدك في {المحل} ⏰\n{الوقت}\n\nإذا تغيّرت خطتك ألغِ من هنا: {الرابط}",
    en: "Reminder of your booking at {shop} ⏰\n{eta}\n\nIf your plans changed, cancel here: {link}" },
  { key: "booking_cancelled", label: "إلغاء الحجز",
    ar: "تم إلغاء حجزك ({الرقم}). نتمنى نشوفك قريب 🌿",
    en: "Your booking ({number}) was cancelled. Hope to see you soon 🌿" },
  { key: "review_request", label: "طلب التقييم بعد الزيارة",
    ar: "شكراً لزيارتك {المحل} يا {الاسم} 🙏\nكيف كانت تجربتك؟ رد برقم من 1 إلى 5.",
    en: "Thanks for visiting {shop}, {name} 🙏\nHow was it? Reply with a number from 1 to 5." },
  { key: "winback", label: "اشتقنا لك (لمن وافق على العروض)", marketing: true,
    ar: "اشتقنا لك يا {الاسم} 💛\nعندنا جديد في {المحل} — شوف المنيو: {الرابط}\n\nلإيقاف العروض أرسل: توقف",
    en: "We miss you, {name} 💛\nThere's something new at {shop} — see the menu: {link}\n\nSend STOP to opt out." },
];

const BY_KEY = new Map(DEFAULT_TEMPLATES.map((t) => [t.key, t]));

export async function templateText(orgId: number, key: TemplateKey, lang: "ar" | "en"): Promise<string | null> {
  const def = BY_KEY.get(key);
  const [row] = await db.select().from(waTemplatesTable).where(and(eq(waTemplatesTable.orgId, orgId), eq(waTemplatesTable.key, key))).limit(1);
  if (row && !row.enabled) return null;
  const text = lang === "en" ? (row?.textEn || def?.en) : (row?.textAr || def?.ar);
  return text ?? null;
}

export async function renderFor(orgId: number, key: TemplateKey, lang: "ar" | "en", vars: TemplateVars): Promise<string | null> {
  const t = await templateText(orgId, key, lang);
  return t ? renderTemplate(t, vars) : null;
}

export async function listTemplates(orgId: number) {
  const rows = await db.select().from(waTemplatesTable).where(eq(waTemplatesTable.orgId, orgId));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return DEFAULT_TEMPLATES.map((d) => {
    const r = byKey.get(d.key);
    return {
      key: d.key, label: d.label, marketing: !!d.marketing,
      textAr: r?.textAr ?? d.ar, textEn: r?.textEn ?? d.en,
      enabled: r ? r.enabled : true, customised: !!r,
      defaultAr: d.ar, defaultEn: d.en,
    };
  });
}

export async function saveTemplate(orgId: number, key: string, patch: { textAr?: string; textEn?: string; enabled?: boolean; reset?: boolean }) {
  const def = BY_KEY.get(key as TemplateKey);
  if (!def) throw new Error("قالب غير معروف");
  if (patch.reset) { await db.delete(waTemplatesTable).where(and(eq(waTemplatesTable.orgId, orgId), eq(waTemplatesTable.key, key))); return; }
  const textAr = String(patch.textAr ?? def.ar).slice(0, 2000);
  const textEn = patch.textEn === undefined ? def.en : String(patch.textEn).slice(0, 2000);
  await db.insert(waTemplatesTable).values({ orgId, key, textAr, textEn, enabled: patch.enabled ?? true })
    .onConflictDoUpdate({ target: [waTemplatesTable.orgId, waTemplatesTable.key], set: { textAr, textEn, ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), updatedAt: new Date() } });
}
