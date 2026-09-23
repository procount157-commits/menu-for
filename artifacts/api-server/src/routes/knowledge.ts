import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, knowledgeBaseTable, businessProfileTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { retrieve, answerFromKnowledge, getProfile, recentAutoReplies } from "../lib/knowledge";
import { providerStatus, complete, activeProvider } from "../lib/llm";

const router = Router();
router.use(requireAuth);

// ── Which model, if any ───────────────────────────────────────────
router.get("/provider", (_req, res) => res.json(providerStatus()));

/** Round-trip the configured provider so a key can be verified before relying on it. */
router.post("/provider/test", async (_req, res) => {
  const p = activeProvider();
  if (p === "none") {
    return res.json({ ok: false, provider: p, error: "لا يوجد مزوّد مضبوط — أضف مفتاحاً في .env" });
  }
  const out = await complete([
    { role: "system", content: "أجب بكلمة واحدة فقط بالعربية." },
    { role: "user",   content: "قل: جاهز" },
  ], 15_000);
  res.json(out
    ? { ok: true, provider: out.provider, sample: out.text.slice(0, 80) }
    : { ok: false, provider: p, error: "المزوّد لم يستجب — تحقق من المفتاح أو الحصة" });
});

// ── Business profile ──────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  res.json((await getProfile(req.session.userId!)) ?? null);
});

router.put("/profile", async (req, res) => {
  const userId = req.session.userId!;
  const { name, industry, description, tone, guardrails, autoReply } = req.body ?? {};
  const values = {
    userId,
    name: name ?? null, industry: industry ?? null, description: description ?? null,
    tone: ["friendly", "professional", "casual"].includes(tone) ? tone : "friendly",
    guardrails: guardrails ?? null,
    autoReply: !!autoReply,
    updatedAt: new Date(),
  };
  const [row] = await db.insert(businessProfileTable).values(values)
    .onConflictDoUpdate({ target: businessProfileTable.userId, set: values })
    .returning();
  res.json(row);
});

// ── Entries ───────────────────────────────────────────────────────
router.get("/entries", async (req, res) => {
  const rows = await db.select().from(knowledgeBaseTable)
    .where(eq(knowledgeBaseTable.userId, req.session.userId!))
    .orderBy(desc(knowledgeBaseTable.updatedAt));
  res.json(rows);
});

router.post("/entries", async (req, res) => {
  const userId = req.session.userId!;
  const { title, content, keywords, category } = req.body ?? {};
  if (!String(title ?? "").trim() || !String(content ?? "").trim()) {
    return res.status(400).json({ error: "العنوان والمحتوى مطلوبان" });
  }
  const [row] = await db.insert(knowledgeBaseTable).values({
    userId, title: String(title).trim(), content: String(content).trim(),
    keywords: keywords ? String(keywords).trim() : null,
    category: category ? String(category).trim() : null,
  }).returning();
  res.json(row);
});

router.patch("/entries/:id", async (req, res) => {
  const userId = req.session.userId!;
  const id = parseInt(req.params.id!);
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of ["title", "content", "keywords", "category"]) {
    if (req.body?.[f] !== undefined) updates[f] = String(req.body[f]).trim() || null;
  }
  if (req.body?.isActive !== undefined) updates.isActive = !!req.body.isActive;

  const [row] = await db.update(knowledgeBaseTable).set(updates)
    .where(and(eq(knowledgeBaseTable.id, id), eq(knowledgeBaseTable.userId, userId)))
    .returning();
  if (!row) return res.status(404).json({ error: "العنصر غير موجود" });
  res.json(row);
});

router.delete("/entries/:id", async (req, res) => {
  await db.delete(knowledgeBaseTable).where(and(
    eq(knowledgeBaseTable.id, parseInt(req.params.id!)),
    eq(knowledgeBaseTable.userId, req.session.userId!),
  ));
  res.json({ success: true });
});

/**
 * Bulk add, for pasting an FAQ in one go.
 *
 * Accepts either a list of {title, content} or plain text split on blank
 * lines, where the first line of each block becomes the title.
 */
router.post("/entries/bulk", async (req, res) => {
  const userId = req.session.userId!;
  const { entries, text } = req.body ?? {};

  let rows: Array<{ title: string; content: string }> = [];
  if (Array.isArray(entries)) {
    rows = entries
      .map((e: any) => ({ title: String(e?.title ?? "").trim(), content: String(e?.content ?? "").trim() }))
      .filter((e) => e.title && e.content);
  } else if (typeof text === "string" && text.trim()) {
    rows = text.split(/\n\s*\n/).map((block) => {
      const lines = block.trim().split("\n");
      const title = (lines.shift() ?? "").replace(/^[-*•\d.\s]+/, "").trim();
      const content = lines.join("\n").trim() || title;
      return { title: title.slice(0, 255), content };
    }).filter((e) => e.title);
  }
  if (rows.length === 0) return res.status(400).json({ error: "لا يوجد محتوى صالح" });

  const inserted = await db.insert(knowledgeBaseTable)
    .values(rows.map((r) => ({ userId, ...r })))
    .returning({ id: knowledgeBaseTable.id });
  res.json({ added: inserted.length });
});

// ── Try it ────────────────────────────────────────────────────────

/**
 * Ask a question the way a customer would and see exactly what comes back,
 * including which entries were used — so a wrong answer points at the entry
 * that caused it.
 */
router.post("/ask", async (req, res) => {
  const userId = req.session.userId!;
  const question = String(req.body?.text ?? "").trim();
  if (!question) return res.status(400).json({ error: "أرسل سؤالاً" });

  const [found, answer] = await Promise.all([
    retrieve(userId, question),
    answerFromKnowledge(userId, question),
  ]);

  res.json({
    question,
    reply: answer.reply,
    provider: answer.provider,
    reason: answer.reason ?? null,
    matched: found.map((f) => ({
      id: f.entry.id, title: f.entry.title,
      score: Number(f.score.toFixed(3)), hits: f.hits,
    })),
  });
});

router.get("/log", async (req, res) => res.json(await recentAutoReplies(req.session.userId!)));

export default router;
