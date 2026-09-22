import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import { pool } from "@workspace/db";

const router = Router();

const VALID_STATUSES = ["new", "contacted", "negotiating", "converted", "lost"] as const;

// ── Public: submit a lead ─────────────────────────────────────────
// POST /api/leads — called from the landing page subscription modal
router.post("/", async (req, res) => {
  const { name, phone, planName, businessType, estimatedCustomers, notes, source } = req.body;

  // minimal validation — phone is required
  if (!phone) return res.status(400).json({ error: "Phone is required" });

  const { rows } = await pool.query(
    `INSERT INTO subscription_leads
       (name, phone, plan_name, business_type, estimated_customers, notes, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'new')
     RETURNING id`,
    [name || null, phone, planName || null, businessType || null,
     estimatedCustomers || null, notes || null, source || "landing"]
  );
  logger.info({ leadId: rows[0].id, phone, planName }, "New subscription lead captured");
  res.status(201).json({ success: true, id: rows[0].id });
});

// ── Admin: list + update ──────────────────────────────────────────
router.use(requireAuth, requireAdmin as any);

// GET /api/leads — list all leads with optional status filter
router.get("/", async (req, res) => {
  const { status } = req.query;
  const params: any[] = [];
  const where = status ? `WHERE status = $1` : "";
  if (status) params.push(status);

  const { rows } = await pool.query(
    `SELECT * FROM subscription_leads ${where} ORDER BY created_at DESC LIMIT 500`,
    params
  );
  res.json(rows);
});

// PATCH /api/leads/:id — update lead status
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(", ")}` });
  }
  const { rows } = await pool.query(
    `UPDATE subscription_leads SET status=$1 WHERE id=$2 RETURNING *`,
    [status, id]
  );
  if (!rows.length) return res.status(404).json({ error: "Lead not found" });
  res.json(rows[0]);
});

// DELETE /api/leads/:id — delete lead
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await pool.query(`DELETE FROM subscription_leads WHERE id=$1`, [id]);
  res.json({ success: true });
});

export default router;
