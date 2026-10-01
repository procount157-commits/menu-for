// ── First-connection setup ────────────────────────────────────────
// Runs the first time an account links WhatsApp, so a new user lands on a
// system that is already wired rather than a set of empty pages.
//
// What it does NOT do is switch the customer-facing bot on. Auto-reply with an
// empty knowledge base answers nothing anyway, and turning it on for someone
// who has not written a word of it is a decision that belongs to them.

import { and, eq, sql } from "drizzle-orm";
import {
  db, businessProfileTable, followUpSequencesTable, usersTable, botEmployeesTable,
  DEFAULT_FOLLOW_UP_STEPS, DEFAULT_EMPLOYEES,
} from "@workspace/db";
import { logger } from "./logger";

// ── The team, as a shop's team ────────────────────────────────────
// The roster in @workspace/db is Flow Hub's, written for a firm selling
// accounting. The names, roles, priorities and routing stay exactly as they
// are — the engine looks people up by role — but who they are is rewritten
// for a restaurant, a café, a sweets shop or a salon answering its own
// customers. فهد and مارك watch the number, not the customer, and are left
// as they were.
export const SHOP_PERSONAS: Record<string, { title: string; persona: string }> = {
  sales: {
    title: "المضيّف",
    persona: "مضيّف المحل على واتساب — أول من يرد على الزبون، مثل اللي يستقبلك عند الباب: دافئ، سريع، ومختصر. يكتب بلهجة من يكاتبه — خليجية مع الخليجي، مصرية مع المصري، شامية مع الشامي، وإنجليزية مع من يكتب إنجليزي. يجاوب من المنيو والمعلومات المكتوبة فقط: السعر كما هو، الساعات كما هي، الفروع كما هي — وإذا ما لقى الجواب يقول «بتأكد لك» ولا يخترع صنفاً ولا سعراً ولا موعداً فاضياً. يعرف أن أغلب الزباين يبون شي واحد: يطلبون، أو ياخذون دورهم، أو يحجزون — فيعطيهم الرابط المناسب في وقته. يسأل سؤالاً واحداً فقط حين ينقصه شي (كم شخص، أي وقت، أي منطقة)، ويحوّل الشكوى والطلب الخاص لشخص من المحل. يقيس نفسه بسؤال واحد: هل صار أسهل على الزبون يطلب أو يجي بعد ردّي؟",
  },
  support: {
    title: "خدمة الزبائن",
    persona: "موظف خدمة زبائن هادئ ومتعاطف وصادق، يكتب بلهجة من يكاتبه. يستلم الشكاوى — طلب تأخر، أكل وصل بارد أو غلط، موعد ضاع، تعامل ما عجب الزبون. يعرف أن الزبون الزعلان يبي يحس أنه انسمع، ثم يبي خطوة. يعترف بالتحديد لا بالعموم، ولا يبرّر ولا يلوم، ولا يعِد بتعويض أو استرجاع — هذا قرار صاحب المحل. ياخذ رقم الطلب والفرع، ويحوّل لشخص من المحل بسرعة بدل أن يماطل. لا يعرض صنفاً ولا عرضاً في محادثة شكوى إطلاقاً.",
  },
  chief: {
    title: "رئيسة الفريق",
    persona: "سيدة إماراتية، رئيسة فريق الضيافة بخبرة طويلة في المطاعم والكافيهات والصالونات في الإمارات. تعرف أن الزبون اللي يكتب «عندكم توصيل؟» ما يبي محاضرة — يبي جواب صحيح ورابط. أسلوبها راقٍ وواثق وموجز. تقيس الفريق بالنتيجة: كم سؤال انجاب من المنيو صح، كم زبون طلب أو حجز بعد الرد، وكم رد اخترع شي مو مكتوب. لا تقبل رداً يصلح لأي زبون، ولا رداً فيه سعر أو صنف ليس في المنيو. حين تتولّى محادثة بنفسها تضيّف كأفضل موظفيها، وحين تُدرّب تعطي قاعدة واحدة واضحة لا محاضرة. وهي اللي تقابل صاحب المحل أول مرة وتكتب ملفه من كلامه.",
  },
  intake: {
    title: "منسّق القوائم",
    persona: "منسّق قوائم خليجي، منظّم ومحافظ. يقرر من يدخل تسلسل متابعة ومن لا: زبون حجز وما حضر، زبون زار وما قيّم، زبون غاب عن المحل من فترة — وكلهم ممن وافقوا على الرسائل. لا يضيف أحداً لمجرد وجود رقمه، ولا يضع من اشتكى أو طلب التوقف في أي تسلسل. يعرف أن قائمة قصيرة تُنجَز خير من طويلة تُهمَل، وأن ملاحقة من لم يرد على رسالة واحدة تجلب شكوى لا زبوناً.",
  },
  followup: {
    title: "موظف المتابعة",
    persona: "موظف متابعة صبور لا يُلحّ، يكتب بلهجة من يكاتبه. شغله بعد الزيارة: شكر وطلب تقييم بعد ما يزور الزبون (لو فعّلها صاحب المحل)، تذكير لطيف لمن حجز، ورسالة ترجّع الزبون اللي غاب — بسبب جديد مكتوب في المنيو لا بتذكير فاضي. ما يخترع عرضاً ولا خصماً، وما يراسل من ما وافق على الرسائل أو طلب التوقف. كل رسالة منه تختلف عن سابقتها في الزاوية لا في الصياغة، ويحترم صمت الزبون.",
  },
  collector: {
    title: "جامعة البيانات",
    persona: "محللة بيانات خليجية، تحليلية ومباشرة. تقرأ الصف والطلبات والحجوزات وإيصالات القراءة: متى الزحمة، كم ينتظر الزبون، كم واحد مشى قبل دوره، أي الأصناف أكثر طلباً وأي فرع أبطأ. الرقم الكبير ليس خبراً والرقم الذي تحرّك هو الخبر. لا تقول رقماً دون أن تقول ماذا يعني، ولا تقترح متابعة زبون دون سبب من سلوكه هو. توصيتها واحدة قابلة للتنفيذ اليوم، لا قائمة.",
  },
};

/** The roster to hire for a new account: Flow Hub's, with the shop's personas. */
export function shopRoster(userId: number) {
  return DEFAULT_EMPLOYEES.map((e) => ({ userId, ...e, ...(SHOP_PERSONAS[e.role] ?? {}) }));
}

/**
 * An account hired before the rewrite carries Flow Hub's accounting personas.
 * One the owner never touched — still word for word the old default — is
 * brought up to the shop's; one they edited is theirs and stays.
 */
export async function refreshUntouchedPersonas(userId: number, rows: Array<{ role: string; persona: string | null }>): Promise<number> {
  let n = 0;
  for (const def of DEFAULT_EMPLOYEES) {
    const shop = SHOP_PERSONAS[def.role];
    if (!shop || !def.persona) continue;
    if (!rows.some((r) => r.role === def.role && r.persona === def.persona)) continue;
    await db.update(botEmployeesTable).set({ persona: shop.persona, title: shop.title, updatedAt: new Date() })
      .where(and(eq(botEmployeesTable.userId, userId), eq(botEmployeesTable.role, def.role), eq(botEmployeesTable.persona, def.persona)));
    n++;
  }
  if (n) logger.info({ userId, n }, "شخصيات الفريق حُدّثت لنسخة المحل");
  return n;
}

export async function provisionOnConnect(userId: number): Promise<void> {
  try {
    // Profile row: settings have somewhere to live, auto-reply off.
    const [profile] = await db.select().from(businessProfileTable)
      .where(eq(businessProfileTable.userId, userId));

    if (!profile) {
      const [user] = await db.select({ name: usersTable.displayName })
        .from(usersTable).where(eq(usersTable.id, userId));
      await db.insert(businessProfileTable)
        .values({ userId, name: user?.name ?? null, tone: "friendly", autoReply: false })
        .onConflictDoNothing();
      logger.info({ userId }, "provisioned business profile on first connect");
    }

    // A follow-up sequence, ready but idle. Building one from nothing is the
    // step most people never get to; reviewing one and pressing play is not.
    const [existing] = await db.select({ n: sql<number>`count(*)` })
      .from(followUpSequencesTable).where(eq(followUpSequencesTable.userId, userId));

    if (Number(existing?.n ?? 0) === 0) {
      await db.insert(followUpSequencesTable).values({
        userId,
        name: "متابعة العملاء (جاهزة — فعّلها متى شئت)",
        isActive: false,
        sourceFilter: "all",
        stopOnReply: true,
        steps: [...DEFAULT_FOLLOW_UP_STEPS] as any,
      });
      logger.info({ userId }, "provisioned default follow-up sequence (inactive)");
    }
  } catch (err) {
    // Never let setup failure affect the connection itself.
    logger.warn({ err, userId }, "provisioning on connect failed");
  }
}
