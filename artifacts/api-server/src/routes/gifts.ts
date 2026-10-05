// ── /api/gifts — gift cards, as the shop sells and redeems them ───

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, giftCardsTable, orgsTable, staffTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { withTenant, MANAGERS, OWNER, ANYONE, type Tenant } from "../lib/tenancy/context";
import { menuPlan } from "../lib/plans";
import { createGift, giftByCode, giftProblem, spendGift, listGifts, giftUses, giftPath, GiftError } from "../lib/growth/gifts";
import { publicUrl } from "../lib/menu/urls";

const router = Router();

const view = (g: typeof giftCardsTable.$inferSelect) => ({
  id: g.id, code: g.code, amount: Number(g.amount), balance: Number(g.balance), status: g.status, problem: giftProblem(g),
  recipientName: g.recipientName, recipientPhone: g.recipientPhone, buyerName: g.buyerName, message: g.message,
  expiresAt: g.expiresAt, createdBy: g.createdBy, createdAt: g.createdAt, url: publicUrl(giftPath(g.token)),
});

/** Who did it, as the owner will read it in the card's history. */
async function who(t: Tenant): Promise<string> {
  if (!t.staffId) return "صاحب المحل";
  const [s] = await db.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.id, t.staffId)).limit(1);
  return s?.name ?? "موظف";
}

async function allowed(ownerUserId: number) {
  const plan = await menuPlan(ownerUserId);
  return { ok: plan.features.gifts, planName: plan.planName };
}

router.get("/gifts", requireAuth, withTenant(MANAGERS, async (_req, res, t) => {
  const a = await allowed(t.org.ownerUserId);
  const { stats, cards } = await listGifts(t.org.id);
  res.json({ allowed: a.ok, planName: a.planName, onMenu: !!t.org.features?.gifts, stats, cards: cards.map(view) });
}));

router.post("/gifts", requireAuth, withTenant(MANAGERS, async (req, res, t) => {
  const a = await allowed(t.org.ownerUserId);
  if (!a.ok) return res.status(402).json({ error: `بطاقات الهدايا من خطة «أعمال» — خطتك ${a.planName}.`, plan: true });
  try {
    const g = await createGift(t.org, t.branch, req.body ?? {}, await who(t));
    res.status(201).json(view(g));
  } catch (err) {
    if (err instanceof GiftError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

/** At the counter: find a card by its code (staff too — they take the payment). */
router.get("/gifts/code/:code", requireAuth, withTenant(ANYONE, async (req, res, t) => {
  const g = await giftByCode(t.org.id, String(req.params.code));
  if (!g) return res.status(404).json({ error: "لا توجد بطاقة بهذا الرمز" });
  res.json({ ...view(g), uses: await giftUses(g.id) });
}));

router.post("/gifts/:id/redeem", requireAuth, withTenant(ANYONE, async (req, res, t) => {
  const [g] = await db.select().from(giftCardsTable).where(and(eq(giftCardsTable.id, Number(req.params.id)), eq(giftCardsTable.orgId, t.org.id))).limit(1);
  if (!g) return res.status(404).json({ error: "البطاقة غير موجودة" });
  const problem = giftProblem(g);
  if (problem) return res.status(409).json({ error: problem });
  const amount = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!(amount > 0)) return res.status(400).json({ error: "اكتب المبلغ" });
  if (amount > Number(g.balance)) return res.status(409).json({ error: `الرصيد ${Number(g.balance)} فقط` });
  const ok = await spendGift(g.id, amount, { note: String(req.body?.note ?? "").slice(0, 200) || "عند الكاشير", byWho: await who(t) });
  if (!ok) return res.status(409).json({ error: "تغيّر الرصيد — أعد المحاولة" });
  const [after] = await db.select().from(giftCardsTable).where(eq(giftCardsTable.id, g.id)).limit(1);
  res.json(view(after!));
}));

router.post("/gifts/:id/void", requireAuth, withTenant(OWNER, async (req, res, t) => {
  await db.update(giftCardsTable).set({ status: "void" }).where(and(eq(giftCardsTable.id, Number(req.params.id)), eq(giftCardsTable.orgId, t.org.id)));
  res.json({ ok: true });
}));

/** «أهدِ بطاقة» on the menu. */
router.patch("/gifts/menu", requireAuth, withTenant(OWNER, async (req, res, t) => {
  const f = { ...(t.org.features ?? {}), gifts: !!req.body?.onMenu };
  await db.update(orgsTable).set({ features: f }).where(eq(orgsTable.id, t.org.id));
  res.json({ onMenu: f.gifts });
}));

export default router;
