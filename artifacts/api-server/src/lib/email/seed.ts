// ── The ready-made Menu For You outreach ──────────────────────────
// What the platform owner sends to a shop that has never heard of it: an
// opening that names one problem the shop lives every day and points to a
// demo menu, a second that shows the queue from the customer's side, and a
// third that offers a way out of the thread. Installed on the first
// configured account; re-seeding never overwrites a sequence or template
// the owner has edited.
//
// Everything the owner decides — the price, the trial's length, the demo
// menu link, the phone — is a bracketed placeholder they fill in. Nothing
// here states a result («زيادة المبيعات ٣٠٪») or a count of shops: those
// would be invented, and the guard would stop them anyway.

import { and, eq } from "drizzle-orm";
import { db, emailSequencesTable, emailTemplatesTable, type EmailStep } from "@workspace/db";
import { logger } from "../logger";

export const DEFAULT_SEQUENCE_NAME = "منيو فور يو — تعريف ومتابعة";

const P = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;
const UL = (items: string[]) => `<ul style="margin:0 0 14px;padding-right:22px">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join("")}</ul>`;
const ULL = (items: string[]) => `<ul style="margin:0 0 14px;padding-left:22px">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join("")}</ul>`;
const SIGN = "{{sender}}<br>منيو فور يو<br>[رقم واتساب المبيعات] · [موقع منيو فور يو]";

const STEP1: EmailStep = {
  afterHours: 0,
  subject: "{{company|محلكم}}: المنيو والدور وطلبات واتساب في رابط واحد",
  html: [
    P("السلام عليكم {{first_name|هلا والله}}،"),
    P("معك {{sender}} من <b>منيو فور يو</b>. نشتغل مع المطاعم والكافيهات ومحلات الحلويات والصالونات على شي واحد: رابط وQR يفتح للزبون منيو أنيق من جواله، بدون تطبيق ولا تسجيل."),
    P("ومن نفس الصفحة الزبون يطلب ويوصلك الطلب على واتساب مكتوب ومحسوب، أو ياخذ دوره في صف رقمي وتوصله رسالة «جاء دورك»، أو يحجز طاولة أو موعد."),
    P("سؤال واحد يوفّر علينا الوقت: <b>وقت الزحمة، كيف تنظّمون الناس اللي ينتظرون عند الباب؟</b>"),
    P("وإذا تحب تشوف الفكرة بنفسك، افتح هالمنيو التجريبي من جوالك: [رابط المنيو التجريبي]"),
    P(`مع التحية،<br>${SIGN}`),
  ].join(""),
};

const STEP2: EmailStep = {
  afterHours: 72,
  subject: "الدور من جهة الزبون — بدون ورق ولا أسماء تنصاح",
  html: [
    P("{{first_name|هلا}}،"),
    P("كتبت لكم قبل أيام عن منيو فور يو. أكثر شي يسأل عنه أصحاب المحلات هو صف الانتظار، فهذا شكله بالضبط:"),
    UL([
      "الزبون يمسح الـ <b>QR</b> عند الباب ويكتب اسمه وكم شخص.",
      "يشوف <b>كم واحد قدامه</b> والوقت التقريبي، ويتحدّث لحاله.",
      "الموظف عنده شاشة فيها زر واحد: <b>«التالي»</b>.",
      "الزبون يوصله واتساب <b>«قرّب دورك»</b> ثم <b>«جاء دورك»</b> — فيقدر ينتظر في سيارته أو في المول.",
      "ورقمه يبقى عندك، فتقدر بعدين — بموافقته — تشكره أو تطلب تقييمه.",
    ]),
    P("نفس الرابط فيه المنيو والطلب على واتساب والحجز، ولكل فرع صفه وشاشته. [أضف هنا ما يميّز باقتك: السعر، مدة التجربة، من يساعدهم في التركيب.]"),
    P("<b>تحب نجهّز لكم نسخة تجريبية بمنيوكم أنتم؟</b> نحتاج بس صورة المنيو الحالي."),
    P("مع التحية،<br>{{sender}}<br>منيو فور يو"),
  ].join(""),
};

const STEP3: EmailStep = {
  afterHours: 168,
  subject: "آخر رسالة مني",
  html: [
    P("{{first_name|هلا}}،"),
    P("ما راح أزعجكم أكثر من كذا. إذا الموضوع مو أولوية الحين فأتفهّم تماماً، وأترك لكم الرابط لين يجي وقته."),
    P("وإذا اللي مانعكم الوقت أو السعر، اكتبوا لي كلمة وحدة وأقترح بداية تناسبكم — مثلاً نبدأ بالمنيو والطلب على واتساب، ونضيف الدور والحجز بعدين."),
    P("[رابط المنيو التجريبي] · [رقم واتساب المبيعات]"),
    P("مع التحية،<br>{{sender}}<br>منيو فور يو"),
  ].join(""),
};

const TEMPLATES: Array<{ name: string; subject: string; html: string; category: string }> = [
  { name: "منيو فور يو — الرسالة الأولى", subject: STEP1.subject, html: STEP1.html, category: "تعريف" },
  { name: "منيو فور يو — الدور من جهة الزبون", subject: STEP2.subject, html: STEP2.html, category: "تعريف" },
  { name: "منيو فور يو — الرسالة الأخيرة", subject: STEP3.subject, html: STEP3.html, category: "تعريف" },
  {
    name: "Menu For You — English opener", category: "تعريف",
    subject: "{{company|Your shop}}'s menu, queue and WhatsApp orders — in one link",
    html: [
      P("Hello {{first_name|there}},"),
      P("I'm {{sender}} from <b>Menu For You</b>. We work with restaurants, cafés, sweets shops and salons on one thing: a link and a QR code that open an elegant menu on the customer's phone — no app, no sign-up."),
      P("From that same page the customer orders and the order reaches your WhatsApp written out and priced, or takes a place in a digital queue and gets a «جاء دورك» message when it is their turn, or books a table or an appointment."),
      P("One question saves us both time: <b>on a busy evening, how do you handle the people waiting at the door?</b>"),
      P("If you would rather see it first, open this demo menu on your phone: [demo menu link]"),
      P("Kind regards,<br>{{sender}}<br>Menu For You<br>[WhatsApp number] · [website]"),
    ].join(""),
  },
  {
    name: "Menu For You — English follow-up", category: "تعريف",
    subject: "The queue, from {{company|your}} customer's side",
    html: [
      P("Hello {{first_name|there}},"),
      P("Following up on my note about Menu For You. The part owners ask about most is the queue:"),
      ULL([
        "The customer scans the QR at the door and enters a name and party size.",
        "They see how many are ahead and roughly how long — live.",
        "Your host has one button: <b>Next</b>.",
        "The customer gets a WhatsApp «جاء دورك» and can wait in the car instead of the doorway.",
      ]),
      P("Plans start at [monthly price], and you can try it for [trial length]. <b>Shall we set up a demo with your own menu?</b> A photo of your current one is all we need."),
      P("Kind regards,<br>{{sender}}<br>Menu For You"),
    ].join(""),
  },
  {
    name: "صالونات — المواعيد", category: "تجميل",
    subject: "مواعيد {{company|صالونكم}} — بالتلفون ولا من رابط؟",
    html: [
      P("{{first_name|هلا والله}}،"),
      P("معك {{sender}} من منيو فور يو. أغلب الصالونات تاخذ المواعيد بالتلفون والواتساب، وبعدين اليوم كله في دفتر أو في بال وحدة من الموظفات."),
      P("مع منيو فور يو الزبونة تشوف خدماتكم بمدتها وسعرها، تختار الوقت (والموظفة لو تبون)، ويوصلها تذكير قبل الموعد فيه «جاية / ألغي»."),
      P("سؤال واحد: <b>كم موعد يضيع عليكم في الأسبوع بسبب ناس ما جوا؟</b> ما نحتاج رقم دقيق — بس عشان نعرف إذا الموضوع يهمكم."),
      P(`مع التحية،<br>${SIGN}`),
    ].join(""),
  },
  {
    name: "حلويات — الطلبات المسبقة", category: "حلويات",
    subject: "طلبات الصواني عند {{company|محلكم}} — مكتوبة ولا ضايعة في المحادثات؟",
    html: [
      P("{{first_name|هلا والله}}،"),
      P("معك {{sender}} من منيو فور يو. صينية كنافة ليوم الخميس الساعة خمس، كيكة ليوم السبت — محلات الحلويات عايشة على الطلبات المسبقة، وأغلبها توصل رسائل متفرقة في الواتساب."),
      P("مع منيو فور يو الزبون يختار الصينية وتاريخ الاستلام من منيوكم ويرسلها طلب واحد واضح. وأنتم تشوفون كل الطلبات مرتبة باليوم، والزبون يوصله تذكير قبل الاستلام."),
      P("<b>تحب نوريك شكل قائمة الطلبات المسبقة؟</b> [رابط المنيو التجريبي]"),
      P(`مع التحية،<br>${SIGN}`),
    ].join(""),
  },
];

/** Install the sequence and the templates. `force` re-adds anything missing; nothing edited is touched. */
export async function seedEmailDefaults(userId: number, force = false): Promise<{ sequence: boolean; templates: number }> {
  let sequence = false, templates = 0;
  const [existing] = await db.select({ id: emailSequencesTable.id }).from(emailSequencesTable)
    .where(and(eq(emailSequencesTable.userId, userId), eq(emailSequencesTable.name, DEFAULT_SEQUENCE_NAME))).limit(1);
  if (!existing) {
    await db.insert(emailSequencesTable).values({ userId, name: DEFAULT_SEQUENCE_NAME, steps: [STEP1, STEP2, STEP3], stopOnReply: true, stopOnOpen: false, isActive: true });
    sequence = true;
  }
  const have = new Set((await db.select({ name: emailTemplatesTable.name }).from(emailTemplatesTable).where(eq(emailTemplatesTable.userId, userId))).map((t) => t.name));
  for (const t of TEMPLATES) {
    if (have.has(t.name)) continue;
    if (!force && have.size > 0 && !sequence) continue;
    await db.insert(emailTemplatesTable).values({ userId, ...t });
    templates++;
  }
  if (sequence || templates) logger.info({ userId, sequence, templates }, "قوالب البريد الجاهزة ثُبّتت");
  return { sequence, templates };
}
