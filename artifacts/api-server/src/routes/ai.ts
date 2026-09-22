import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { getStatus, getHealth } from "../lib/whatsapp";
import { db, campaignsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

const POLLINATIONS_URL = "https://text.pollinations.ai/";
const MODEL = "openai";

interface PollinationsResponse {
  choices?: { message?: { content?: string } }[];
}

async function callAI(
  messages: { role: string; content: string }[],
  timeoutMs = 30_000
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(POLLINATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, seed: -1, private: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    const data = (await res.json()) as PollinationsResponse;
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("استجابة فارغة من الذكاء الاصطناعي");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ── POST /api/ai/optimize-message ───────────────────────────────────────────

router.post("/optimize-message", requireAuth, async (req, res) => {
  const body = req.body as { message?: unknown; tone?: unknown };
  const message = typeof body.message === "string" ? body.message.slice(0, 4000) : "";
  if (!message) { res.status(400).json({ error: "الرسالة مطلوبة" }); return; }

  const tone = (["friendly","professional","urgent","promotional"] as const)
    .includes(body.tone as "friendly")
    ? (body.tone as string)
    : "friendly";

  const toneMap: Record<string, string> = {
    friendly:     "ودود وطبيعي",
    professional: "مهني ورسمي",
    urgent:       "عاجل ومقنع",
    promotional:  "ترويجي وجذاب",
  };

  const result = await callAI([
    {
      role: "system",
      content: `أنت خبير تسويق عبر واتساب.
مهمتك: تحسين رسالة واتساب لتكون أكثر تأثيراً وتفاعلاً.
الأسلوب المطلوب: ${toneMap[tone]}.
القواعد:
- احتفظ بأي متغيرات مثل {الاسم} أو {الشركة} أو {تحية} أو {ختام} كما هي بالضبط
- لا تغير الروابط أو الأرقام
- اجعل الرسالة طبيعية وغير إعلانية بشكل صارخ
- أقصى طول: 500 حرف
- أرسل الرسالة المحسّنة فقط بدون تعليقات أو شرح`,
    },
    { role: "user", content: `الرسالة الأصلية:\n${message}` },
  ]);

  res.json({ result });
});

// ── POST /api/ai/analyze-connection ─────────────────────────────────────────

router.post("/analyze-connection", requireAuth, async (req, res) => {
  const userId = (req.session as { userId?: number }).userId!;

  let healthData: Record<string, unknown> = {};
  try {
    const status = getStatus(userId);
    const health = getHealth(userId);
    healthData = { status, health };
  } catch {
    healthData = { error: "could not read connection state" };
  }

  const result = await callAI([
    {
      role: "system",
      content: `أنت خبير في اتصالات واتساب ومشاكل الشبكة.
حلل البيانات التالية عن حالة الاتصال وأعطِ توصيات عملية بالعربية.
استخدم رموز تعبيرية لجعل التقرير مقروءاً.
الإجابة يجب أن تكون:
1. تشخيص الحالة الحالية (سطرين)
2. أبرز المشاكل المكتشفة (إن وجدت)
3. توصيات عملية فورية (3-5 نقاط)
4. توصيات إعدادات طويلة المدى (2-3 نقاط)`,
    },
    {
      role: "user",
      content: `بيانات الاتصال:\n${JSON.stringify(healthData, null, 2)}`,
    },
  ]);

  res.json({ result });
});

// ── POST /api/ai/chat ────────────────────────────────────────────────────────

interface ChatMsg { role: "user" | "assistant"; content: string }

router.post("/chat", requireAuth, async (req, res) => {
  const body = req.body as { messages?: unknown };
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "messages مطلوب" });
    return;
  }

  const msgs: ChatMsg[] = (body.messages as ChatMsg[])
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (msgs.length === 0) { res.status(400).json({ error: "رسائل غير صالحة" }); return; }

  const userId = (req.session as { userId?: number }).userId!;

  // Quick account context
  let contextStr = "";
  try {
    const [stats] = await db
      .select({
        total:   sql<number>`count(*)`,
        running: sql<number>`count(*) filter (where status = 'running')`,
      })
      .from(campaignsTable)
      .where(eq(campaignsTable.userId, userId));

    const waStatus = getStatus(userId);
    const connected = (waStatus as { connected?: boolean })?.connected ?? false;

    contextStr = `معلومات حساب المستخدم:
- حالة واتساب: ${connected ? "متصل ✅" : "غير متصل ❌"}
- إجمالي الحملات: ${stats?.total ?? 0}
- حملات نشطة الآن: ${stats?.running ?? 0}`;
  } catch {
    // context is optional — don't fail the request
  }

  const aiMessages = [
    {
      role: "system",
      content: `أنت مساعد ذكاء اصطناعي متخصص في التسويق عبر واتساب.
تعمل داخل منصة "واتساب ماركتر" العربية لإرسال رسائل جماعية.
${contextStr ? `\n${contextStr}\n` : ""}
يمكنك مساعدة المستخدم في:
- تحسين رسائل الحملات وجعلها أكثر تأثيراً
- استراتيجيات التسويق عبر واتساب
- تحليل جودة الاتصال واقتراح إعدادات أفضل
- كتابة ردود للشات بوت
- أي سؤال يتعلق بالتسويق الرقمي
أجب دائماً بالعربية. كن مفيداً ومحدداً.`,
    },
    ...msgs.map((m) => ({ role: m.role, content: m.content })),
  ];

  const result = await callAI(aiMessages, 45_000);
  res.json({ result });
});

export default router;
