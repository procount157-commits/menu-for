// ── The graphs, as contracts ─────────────────────────────────────
// The diagram is not the system; these are. Each node says what it is for,
// what it reads and writes, which tools it may use, what side effect it has,
// and who may authorise that effect. Each edge says when it fires, what it
// carries, and where the work goes when it fails. The tests hold the code to
// them: no node reviews itself, every side effect that reaches a customer
// or a shop owner passes a gate that is code or a person — never the
// model's own judgement.
//
// Three graphs in Menu For You: a branch's WhatsApp (the shop answering its
// customers), the email team (the platform selling to shops by email), and
// the platform's seller on WhatsApp. Five working nodes per graph at most,
// plus the code nodes (router, guard, gate, sender) that are not employees.

export type SideEffect = "none" | "idempotent" | "compensatable" | "approval";
export type NodeKind = "agent" | "reviewer" | "code" | "human";

export type NodeContract = {
  id: string;                 // the role in bot_employees, or a code node's name
  kind: NodeKind;
  responsibility: string;
  reads: string[];
  writes: string[];
  tools: string[];
  sideEffect: SideEffect;
  /** Who authorises the side effect — never "model". */
  authorisedBy: "code" | "owner" | "none";
  /** A reviewer never reviews its own output. */
  reviews?: string[];
};

export type EdgeContract = {
  from: string; to: string;
  when: string;               // the activation condition, in words
  carries: string;            // the payload
  onFail: string;             // retry, fallback or hold
  timeout?: string;
};

export type GraphContract = { id: string; goal: string; oneBreath: string; nodes: NodeContract[]; edges: EdgeContract[] };

export const WHATSAPP_GRAPH: GraphContract = {
  id: "whatsapp",
  goal: "orders_completed",
  oneBreath: "رسالة زبون ← تُفرز آلياً (دور، طلب، رد آلي، إيقاف) ← هال يكتب ← الفحص يحكم ← فهد يسمح ← تُرسل؛ ومن سكت يكتب له خالد على نفس الطريق.",
  nodes: [
    { id: "chief", kind: "agent", responsibility: "تُدير المكتب: تقيّم كل موظف من أرقامه، تعطي كلاً مهمةً واحدة، تراجع هل تحرّكت درجته، وتكتب التقرير اليومي", reads: ["receipts", "results", "evaluations"], writes: ["evaluations", "directives", "brief"], tools: ["evaluateDesk", "waResults"], sideEffect: "none", authorisedBy: "none", reviews: ["sales", "followup"] },
    { id: "router", kind: "code", responsibility: "يفرز الرسالة: رمز دور أو طلب، نية، رد آلي، إيقاف، بشري يتولاها", reads: ["incoming", "thread", "lead_card"], writes: ["lead_card.intent"], tools: [], sideEffect: "none", authorisedBy: "none" },
    { id: "sales", kind: "agent", responsibility: "المضيّف: رد واحد من المنيو يقرّب الزبون من طلب أو دور أو حجز", reads: ["thread", "outreach", "lead_card", "menu_knowledge"], writes: ["draft"], tools: ["knowledge.retrieve"], sideEffect: "none", authorisedBy: "none" },
    { id: "support", kind: "agent", responsibility: "يستلم الشكوى: اعتراف واعتذار وخطوة، بلا وعد بتعويض", reads: ["thread", "lead_card", "order"], writes: ["draft"], tools: ["knowledge.retrieve"], sideEffect: "none", authorisedBy: "none" },
    { id: "followup", kind: "agent", responsibility: "يكتب متابعة واحدة بزاوية جديدة من المنيو لمن كتب ثم سكت، أو يرفض", reads: ["thread", "outreach", "lead_card", "menu_knowledge", "earlier_followups"], writes: ["draft"], tools: ["knowledge.retrieve"], sideEffect: "none", authorisedBy: "none" },
    { id: "reviewer", kind: "reviewer", responsibility: "يحكم على المسودة بمعايير ثابتة: يمر، أو يُعاد مرة، أو يُحجز (خانة قالب، رقم مخترع، كشف أنه آلة)", reads: ["draft", "thread", "lead_card", "menu_knowledge"], writes: ["verdict"], tools: ["reply-check"], sideEffect: "none", authorisedBy: "none", reviews: ["sales", "support", "followup"] },
    { id: "gate", kind: "code", responsibility: "يسمح بالإرسال أو يمنعه: الحد اليومي، علامات الحظر، ساعات الإرسال، رسائل الخطة، الإيقاف", reads: ["ops_signals", "unsubscribed", "daily_count", "plan_quota"], writes: ["send_permit"], tools: [], sideEffect: "none", authorisedBy: "code" },
    { id: "sender", kind: "code", responsibility: "يرسل ما سُمح به مرة واحدة فقط", reads: ["send_permit", "draft"], writes: ["thread"], tools: ["whatsapp.send"], sideEffect: "idempotent", authorisedBy: "code" },
  ],
  edges: [
    { from: "chief", to: "sales", when: "حملةٌ حُكم عليها بإعادة الكتابة أو الإيقاف، أو درجته تحتاج مهمة", carries: "الحكم برقمه، والمهمة", onFail: "تُعاد في الدورة القادمة" },
    { from: "chief", to: "followup", when: "سقطت متابعاتٌ أكثر مما كُتب، أو درجته تحتاج مهمة", carries: "أكثر أسباب السقوط، والمهمة", onFail: "تُعاد في الدورة القادمة" },
    { from: "router", to: "sales", when: "شخص لا رد آلي، بلا رمز دور أو طلب، بلا إيقاف، ولا بشري يتولاها", carries: "الرسالة + بطاقة الزبون + ما أرسلناه له", onFail: "لا رد، بإيصال السبب" },
    { from: "router", to: "support", when: "شكوى", carries: "الرسالة + الطلب أو الحجز إن وُجد", onFail: "تحويل لشخص من المحل" },
    { from: "sales", to: "reviewer", when: "مسودة جاهزة", carries: "المسودة + سياقها", onFail: "إعادة بعد قليل، مرتين ثم لا رد" },
    { from: "support", to: "reviewer", when: "مسودة جاهزة", carries: "المسودة + سياقها", onFail: "تحويل لشخص من المحل" },
    { from: "followup", to: "reviewer", when: "مسودة متابعة جاهزة", carries: "المسودة + المتابعات السابقة", onFail: "رفض بإيصال، ينتهي السلم لهذا الزبون" },
    { from: "reviewer", to: "sales", when: "خلل يمكن إصلاحه — مرة واحدة فقط", carries: "المسودة + ما يجب إصلاحه", onFail: "حجز: لا يُرسل" },
    { from: "reviewer", to: "gate", when: "مرّت", carries: "المسودة المعتمدة", onFail: "—" },
    { from: "gate", to: "sender", when: "الرقم سليم والحد يسمح", carries: "إذن إرسال", onFail: "تأجيل للجولة التالية" },
  ],
};

export const EMAIL_GRAPH: GraphContract = {
  id: "email",
  goal: "shops_paying",
  oneBreath: "ماجد ينظّف القائمة ← سلمى تقسّمها بالقطاع وتوصي ← نورة تكتب ← ماجد يحكم ← طارق يجهّز بطاقة الموافقة ← صاحب المنصة يوافق ← تُرسل ← ليلى تقرأ الردود وتسلّم المهتم.",
  nodes: [
    { id: "email_strategist", kind: "agent", responsibility: "قراءة القائمة وحتى ٣ توصيات، موجة لكل قطاع بحملته", reads: ["lists", "sectors", "results"], writes: ["mission", "list_analysis"], tools: [], sideEffect: "none", authorisedBy: "none" },
    { id: "email", kind: "agent", responsibility: "رسالة: ملخص، زر، تفاصيل لمن يرغب", reads: ["mission", "knowledge", "lessons"], writes: ["draft"], tools: ["knowledge.retrieve"], sideEffect: "none", authorisedBy: "none" },
    { id: "email_guard", kind: "reviewer", responsibility: "يحكم: أرقام من المعرفة فقط، لا مبالغة، الشكل الصحيح؛ وينظّف القوائم", reads: ["draft", "knowledge", "lists", "dns"], writes: ["verdict", "list_membership"], tools: ["guardCheck", "formatIssues", "hygiene"], sideEffect: "compensatable", authorisedBy: "code", reviews: ["email", "email_followup"] },
    { id: "email_creator", kind: "agent", responsibility: "بطاقة الموافقة: العنوان واختباره، الجمهور، مدة الإرسال بالإحماء، المتابعات، ملاحظات ماجد", reads: ["draft", "verdict", "audience", "warmup"], writes: ["approval_card"], tools: [], sideEffect: "none", authorisedBy: "none" },
    { id: "owner", kind: "human", responsibility: "يوافق على الإطلاق في وضع الموافقة", reads: ["approval_card", "draft"], writes: ["approval"], tools: [], sideEffect: "approval", authorisedBy: "owner" },
    { id: "sender", kind: "code", responsibility: "يرسل في حدود الإحماء والساعة", reads: ["approval", "queue"], writes: ["email_messages"], tools: ["smtp"], sideEffect: "idempotent", authorisedBy: "code" },
    { id: "email_replies", kind: "agent", responsibility: "يقرأ الرد ويصنفه ويكتب مسودة رد ويسلّم المهتم", reads: ["inbound", "campaign", "contact"], writes: ["draft_reply"], tools: ["knowledge.retrieve"], sideEffect: "approval", authorisedBy: "owner" },
  ],
  edges: [
    { from: "email_guard", to: "email_strategist", when: "رُفعت قائمة ونُظّفت", carries: "القائمة النظيفة", onFail: "تُعاد السلسلة من صفحة القائمة" },
    { from: "email_strategist", to: "email", when: "قطاع فيه ١٥ لم يُراسَلوا على الأقل، ولا موجة جارية له", carries: "موجز: الجمهور والزاوية ولماذا", onFail: "إعادة في الجولة القادمة" },
    { from: "email", to: "email_guard", when: "مسودة مقروءة", carries: "العناوين والرسالة والمتابعات", onFail: "إعادة في الجولة القادمة" },
    { from: "email_guard", to: "email_creator", when: "وضع الموافقة، أو وجد ماجد خللاً", carries: "المسودة + ملاحظاته", onFail: "تبقى معلقة" },
    { from: "email_creator", to: "owner", when: "البطاقة جاهزة", carries: "بطاقة الموافقة", onFail: "تبقى معلقة" },
    { from: "owner", to: "sender", when: "وافق", carries: "الحملة", onFail: "—" },
    { from: "sender", to: "email_replies", when: "وصل رد", carries: "الرد + الحملة", onFail: "—" },
  ],
};

export const PLATFORM_GRAPH: GraphContract = {
  id: "platform",
  goal: "shops_paying",
  oneBreath: "سارة تكتب لصاحب المحل ← الحارس يفحص الأرقام والروابط ← البوابة تسمح (التجربة، الحد اليومي، الإيقاف) ← تُرسل؛ ومن سجّل يُطابق بآخر ٩ أرقام.",
  nodes: [
    { id: "shop_sales", kind: "agent", responsibility: "رسالة أولى أو متابعة أو رد لصاحب محل، تقوده لتجربة مجانية", reads: ["thread", "prospect_card", "plan_facts", "links", "trainer"], writes: ["draft"], tools: [], sideEffect: "none", authorisedBy: "none" },
    { id: "guard", kind: "code", responsibility: "يفحص: أرقام من حقائق الخطط فقط، الروابط المسموحة فقط، لا تكرار — وإلا قالب", reads: ["draft", "plan_facts", "links"], writes: ["verdict"], tools: ["guardMessage"], sideEffect: "none", authorisedBy: "code" },
    { id: "gate", kind: "code", responsibility: "التشغيل والتجربة الجافة، الحد اليومي، ساعات الإرسال، الإيقاف ١٥٠ يوماً", reads: ["settings", "daily_count", "unsubscribed"], writes: ["send_permit"], tools: [], sideEffect: "none", authorisedBy: "code" },
    { id: "sender", kind: "code", responsibility: "يرسل مرة واحدة ويسجّل اللمسة", reads: ["send_permit", "draft"], writes: ["sales_touches"], tools: ["whatsapp.send"], sideEffect: "idempotent", authorisedBy: "code" },
  ],
  edges: [
    { from: "shop_sales", to: "guard", when: "مسودة جاهزة", carries: "المسودة + الروابط المطلوبة", onFail: "إعادة مرة، ثم القالب" },
    { from: "guard", to: "gate", when: "مرّت أو استُبدلت بالقالب", carries: "الرسالة", onFail: "الرد يُترك لبشري" },
    { from: "gate", to: "sender", when: "التشغيل والحد يسمحان", carries: "إذن إرسال", onFail: "الجولة القادمة" },
  ],
};

export const GRAPHS = [WHATSAPP_GRAPH, EMAIL_GRAPH, PLATFORM_GRAPH];

/** What is wrong with a graph's contracts — empty when sound. Pure. */
export function contractProblems(g: GraphContract): string[] {
  const out: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    if (!ids.has(e.from)) out.push(`حافة من عقدة غير موجودة: ${e.from}`);
    if (!ids.has(e.to)) out.push(`حافة إلى عقدة غير موجودة: ${e.to}`);
  }
  for (const n of g.nodes) {
    if (n.reviews?.includes(n.id)) out.push(`${n.id} يراجع نفسه`);
    if ((n.sideEffect === "idempotent" || n.sideEffect === "compensatable" || n.sideEffect === "approval") && n.authorisedBy === "none") out.push(`${n.id} له أثر خارجي بلا جهة تأذن به`);
    if (n.kind === "agent" && n.sideEffect !== "none" && n.authorisedBy !== "owner") out.push(`${n.id} وكيل يُحدث أثراً خارجياً بلا موافقة صاحب العمل`);
  }
  const working = g.nodes.filter((n) => n.kind === "agent" || n.kind === "reviewer").length;
  if (working > 5) out.push(`${working} عقد عاملة — الحد في المرحلة الأولى خمس`);
  return out;
}
