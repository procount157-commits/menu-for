// ── طارق: a whole campaign on request ─────────────────────────────
// The owner names a selling angle and an audience of shops; طارق builds the
// campaign — two subjects to test, the first email, a follow-up for those
// who open and do not reply and one for those who never open — in the
// language asked, with two of the owner's own templates for that angle as
// examples of the voice. It becomes a mission that waits for the owner's
// approval like any other, so nothing goes out until the owner says so.

import { db, emailTemplatesTable, type SegmentFilter } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createMission, runMission } from "./missions";
import { count, describe } from "./segments";
import { activity, ensureEmailTeam } from "./team";
import { CONTACT } from "./library";
import { logger } from "../logger";

// Menu For You's selling angles, one per vertical and one per problem. The
// key is what the form sends; the category is where the owner's templates
// for it live; the goal is what نورة and طارق write from.
export const SERVICES: Record<string, { label: string; category: string; goal: string }> = {
  about:       { label: "تعريف بمنيو فور يو", category: "تعريف", goal: "تعريف بمنيو فور يو: رابط وQR واحد يفتح منيو أنيق بدون تطبيق، الطلب يوصل على واتساب المحل مكتوب ومحسوب، صف انتظار رقمي يرسل «جاء دورك»، حجوزات وطلبات مسبقة، فروع تحت حساب واحد. الدعوة: «شوف منيو تجريبي»." },
  restaurants: { label: "المطاعم — الزحمة والطلبات", category: "مطاعم", goal: "للمطاعم: زحمة الباب وقت العشاء، ناس يملّون ويمشون، طلبات بالتلفون تنكتب وتنعاد، حجوزات الطاولات في دفتر. منيو فور يو: صف رقمي على QR الباب، طلب على واتساب محسوب من المنيو، حجز طاولة بتذكير. الدعوة: «شوف منيو تجريبي» أو عرض ١٠ دقايق." },
  cafes:       { label: "الكافيهات — الطابور والمنيو المتغيّر", category: "كافيهات", goal: "للكافيهات: زحمة الصبح عند الكاونتر، الناس ما يعرفون طلب مين جاهز، منيو يتغيّر كل موسم. منيو فور يو: الطلب من الـ QR برقم، واتساب لما يجهز، منيو يتعدّل من الجوال بالصور والخيارات. الدعوة: «شوف منيو تجريبي»." },
  sweets:      { label: "الحلويات — الطلبات المسبقة والمواسم", category: "حلويات", goal: "لمحلات الحلويات: الطلبات المسبقة (صواني، كيك) بتاريخ استلام تضيع في محادثات الواتساب، ومواسم رمضان والعيد والأعراس. منيو فور يو: طلب مسبق بتاريخ من المنيو، قائمة الطلبات باليوم، تذكير قبل الاستلام. الدعوة: «شوف منيو تجريبي»." },
  beauty:      { label: "الصالونات — المواعيد وانتظار الزبونات", category: "تجميل", goal: "لصالونات التجميل: المواعيد بالتلفون والواتساب، مواعيد تضيع، زبونات ينتظرن في الاستقبال بدون ما يعرفن كم. منيو فور يو: الخدمات بمدتها وسعرها، حجز موعد مع تذكير «جاية / ألغي»، صف للزبونات بدون موعد. الدعوة: عرض ١٠ دقايق." },
  queue:       { label: "صف الانتظار الرقمي", category: "تعريف", goal: "صف الانتظار الرقمي: الزبون ياخذ دوره من QR الباب، يشوف كم قدامه والوقت التقريبي، ويوصله واتساب «قرّب دورك» ثم «جاء دورك» — ينتظر في سيارته بدل الباب، والموظف عنده زر «التالي» بس. الدعوة: عرض ١٠ دقايق." },
  orders:      { label: "الطلب على واتساب بدل التلفون", category: "تعريف", goal: "الطلب على واتساب: بدل طلبات التلفون اللي تنكتب وتنعاد، الزبون يبني طلبه من المنيو ويرسله رسالة واحدة فيها الأصناف والإجمالي ونوع الطلب (محلي، سفري، توصيل، طاولة)، والسعر من المنيو مو من الزبون. الدعوة: «شوف منيو تجريبي»." },
  menu:        { label: "المنيو الرقمي بدل المطبوع", category: "تعريف", goal: "المنيو الرقمي: المطبوع يصير قديم أول ما يتغيّر سعر أو يخلص صنف. منيو فور يو يتعدّل من الجوال في دقيقة — سعر، صورة، «غير متوفر اليوم» — ويظهر على كل QR فوراً. الدعوة: «شوف منيو تجريبي»." },
  customers:   { label: "قائمة الزباين والتقييمات", category: "تعريف", goal: "قائمة الزباين: أغلب المحلات تعرف زباينها بالوجه لا بالرقم. كل طلب وتذكرة وحجز في منيو فور يو يحفظ رقم الزبون، وبموافقته يقدر المحل يرسل شكر أو طلب تقييم أو جديد من رقمه هو. الدعوة: عرض ١٠ دقايق." },
  ai_host:     { label: "مضيّف واتساب يرد من المنيو", category: "تعريف", goal: "مضيّف واتساب بالذكاء الاصطناعي: يرد على «عندكم توصيل؟» و«بكم الكنافة؟» و«تفتحون الجمعة؟» من منيو المحل وساعاته وفروعه، ما يخترع سعر ولا صنف، يرسل رابط المنيو أو الدور أو الحجز، ويحوّل الشكاوى لشخص. الدعوة: عرض ١٠ دقايق." },
  branches:    { label: "الفروع المتعددة", category: "تعريف", goal: "للمحلات اللي عندها فروع: كل فرع له صفه وشاشة موظفيه ورقم واتساب خاص لو يبون، وصاحب المحل يشوف الكل من حساب واحد. الدعوة: عرض ١٠ دقايق." },
  trial:       { label: "دعوة للتجربة المجانية", category: "تعريف", goal: "دعوة للتجربة: لمن فتح أو نقر ولم يبدأ. ما نحتاجه للبدء: صورة المنيو الحالي، الشعار، الساعات، الفروع، رقم واتساب الطلبات. الأسعار تبدأ من [السعر الشهري] والتجربة [مدة التجربة] — اترك الأقواس كما هي. الدعوة: «ابدأ التجربة المجانية»." },
};

const plain = (html: string) => html.replace(/<li>/g, "\n- ").replace(/<\/p>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

export async function createWithCreator(userId: number, input: {
  service: string; language?: string; listIds?: number[]; folderIds?: number[]; sectors?: string[]; take?: number; notes?: string;
}): Promise<{ missionId: number; audience: number; description: string }> {
  const svc = SERVICES[input.service];
  if (!svc) throw new Error("اختر زاوية الحملة");
  await ensureEmailTeam(userId);
  const filter: SegmentFilter = {
    ...(input.listIds?.length ? { listIds: input.listIds } : {}),
    ...(input.folderIds?.length ? { folderIds: input.folderIds } : {}),
    ...(input.sectors?.length ? { sectors: input.sectors } : {}),
    maxTouches: 3,
    ...(input.take ? { take: Math.min(2000, Math.max(10, Math.floor(input.take))) } : {}),
  };
  const n = await count(userId, filter, true);
  // Two of the owner's own templates for this angle, as the voice to write in.
  const examples = await db.select().from(emailTemplatesTable)
    .where(and(eq(emailTemplatesTable.userId, userId), eq(emailTemplatesTable.category, svc.category))).limit(2);
  const notes = [
    input.notes?.trim() ? `تعليمات صاحب العمل لهذه الحملة: ${input.notes.trim()}` : "",
    // Placeholders on purpose: the owner fills them in at approval, so a wrong number never goes out.
    `بيانات التواصل للدعوة: واتساب ${CONTACT.phone}، الموقع ${CONTACT.websiteLabel}، المنيو التجريبي ${CONTACT.demoMenu} — اكتبها بالأقواس كما هي ليملأها صاحب المنصة قبل الإرسال.`,
    examples.length ? `أمثلة من مكتبة قوالب صاحب المنصة لهذه الزاوية — استلهم الأسلوب والبنية ولا تنسخها:\n${examples.map((t) => `العنوان: ${t.subject}\n${plain(t.html).slice(0, 900)}`).join("\n---\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const m = await createMission(userId, {
    name: `${svc.label} — ${input.language === "en" ? "English" : input.language === "both" ? "عربي/English" : "عربي"} — ${new Date().toLocaleDateString("en-GB")}`.slice(0, 160),
    goal: `${svc.goal}\n\n${notes}`, filter, language: input.language ?? "ar", requireApproval: true, agentRole: "email_creator",
  });
  await activity(userId, "email_creator", "create", `بدأ بناء حملة «${svc.label}» لـ ${n} محل (${describe(filter)}) — تنتظر موافقتك حين تُكتب.`, { missionId: m.id });
  // He writes now rather than at the next round, so the owner can read it in a minute.
  void runMission(m).catch((err) => logger.warn({ userId, err: String(err?.message ?? err) }, "creator write failed"));
  return { missionId: m.id, audience: n, description: describe(filter) };
}
