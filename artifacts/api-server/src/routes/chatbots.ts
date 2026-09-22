import { Router } from "express";
import { db, chatbotsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = req.session.userId!;
  const bots = await db.select().from(chatbotsTable).where(eq(chatbotsTable.userId, userId)).orderBy(desc(chatbotsTable.createdAt));
  res.json(bots);
});

router.post("/", async (req, res) => {
  const userId = req.session.userId!;
  const { name, welcomeMessage, nodes = "[]" } = req.body;
  if (!name || !welcomeMessage) return res.status(400).json({ error: "Name and welcomeMessage are required" });
  const [bot] = await db.insert(chatbotsTable).values({ userId, name, welcomeMessage, nodes, enabled: false }).returning();
  res.status(201).json(bot);
});

router.get("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);
  const [bot] = await db.select().from(chatbotsTable).where(and(eq(chatbotsTable.id, id), eq(chatbotsTable.userId, userId)));
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json(bot);
});

router.patch("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);
  const updates: Record<string, any> = {};
  const allowed = ["name", "welcomeMessage", "nodes", "enabled"];
  for (const f of allowed) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
  const [bot] = await db.update(chatbotsTable).set(updates).where(and(eq(chatbotsTable.id, id), eq(chatbotsTable.userId, userId))).returning();
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json(bot);
});

router.delete("/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);
  await db.delete(chatbotsTable).where(and(eq(chatbotsTable.id, id), eq(chatbotsTable.userId, userId)));
  res.json({ success: true, message: "Deleted" });
});

router.post("/:id/toggle", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id);
  const [current] = await db.select({ enabled: chatbotsTable.enabled }).from(chatbotsTable).where(and(eq(chatbotsTable.id, id), eq(chatbotsTable.userId, userId)));
  if (!current) return res.status(404).json({ error: "Not found" });
  const [bot] = await db.update(chatbotsTable).set({ enabled: !current.enabled }).where(eq(chatbotsTable.id, id)).returning();
  res.json(bot);
});

// ── AI Chatbot Generator (Pollinations — free, no API key) ────────
router.post("/ai-generate", async (req, res) => {
  const { description } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: "وصف الشات بوت مطلوب" });

  const xs = [40, 280, 520, 760, 1000];
  const example = {
    name: "اسم الشات بوت",
    welcomeMessage: "رسالة ترحيب مع قائمة مرقمة 1️⃣ خيار أول  2️⃣ خيار ثاني",
    nodes: [
      { id: "n1", type: "keyword", label: "خيار أول", keywords: "1,خيار أول", message: "رد على الخيار الأول 🎯", mediaType: "text", mediaUrl: "", options: [{ text: "رجوع", keyword: "رجوع", nodeId: "" }], x: 40, y: 250 },
      { id: "n2", type: "response", label: "رد نهائي", keywords: "رجوع,رد", message: "شكراً لك ✅", mediaType: "text", mediaUrl: "", options: [], x: 280, y: 470 },
    ],
  };

  const userMsg = `أنشئ شات بوت واتساب احترافي باللغة العربية لـ: "${description}".
أعطني JSON واحد فقط بدون أي نص إضافي، بهذا الشكل بالضبط:
${JSON.stringify(example)}

القواعد:
- كل النصوص بالعربية مع إيموجي
- 4-6 عقد من نوع keyword (قائمة) ثم عقد response (ردود نهائية)
- keywords: نص الرقم والكلمات المفتاحية المفصولة بفاصلة
- x للعقد: ${xs.join(",")} (من اليسار لليمين)
- y للعقد keyword: 250، y للعقد response: 470
- options فارغ [] في عقد response`;

  try {
    const apiRes = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "أنت خبير في بناء شات بوت واتساب. أرجع JSON فقط بدون markdown أو شرح." },
          { role: "user",   content: userMsg },
        ],
        model:    "openai-fast",
        jsonMode: true,
        seed:     Date.now() % 9999,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!apiRes.ok) throw new Error("خدمة الذكاء الاصطناعي غير متاحة حالياً");
    const text = await apiRes.text();
    // Extract first JSON object from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("فشل تحليل الاستجابة — حاول مجدداً");
    const raw = JSON.parse(jsonMatch[0]);

    // Normalize to our schema regardless of what Pollinations returned
    const botName = raw.name || raw.botName || raw.title || `شات بوت ${description}`;
    const welcomeMessage = raw.welcomeMessage || raw.welcome || raw.greeting || `أهلاً بك في ${description}`;
    const rawNodes: any[] = Array.isArray(raw.nodes) ? raw.nodes :
                            Array.isArray(raw.steps) ? raw.steps :
                            Array.isArray(raw.flow)  ? raw.flow  : [];

    const nodes = rawNodes.map((n: any, i: number) => ({
      id:        n.id   || `n${i + 1}`,
      type:      n.type || (Array.isArray(n.options) && n.options.length > 0 ? "keyword" : "response"),
      label:     n.label || n.name || n.title || `عقدة ${i + 1}`,
      keywords:  n.keywords || n.triggers || n.keyword || String(i + 1),
      message:   n.message || n.response || n.reply || n.text || "",
      mediaType: (n.mediaType as string) || "text",
      mediaUrl:  n.mediaUrl || n.media || "",
      options: Array.isArray(n.options)
        ? n.options.map((o: any, j: number) => ({
            text:    typeof o === "string" ? o : (o.text || o.label || o.name || String(o)),
            keyword: typeof o === "string" ? o : (o.keyword || o.key || o.text || String(j + 1)),
            nodeId:  typeof o === "string" ? "" : (o.nodeId || o.node || o.id || ""),
          }))
        : [],
      x: typeof n.x === "number" ? n.x : (xs[i % xs.length] ?? 40),
      y: typeof n.y === "number" ? n.y : (i < 6 ? 250 : 470),
    }));

    res.json({ name: botName, welcomeMessage, nodes });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل إنشاء الشات بوت" });
  }
});

export default router;
