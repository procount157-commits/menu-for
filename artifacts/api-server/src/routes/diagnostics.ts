import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  getDiagnosticState,
  directSend,
  registerDiagListener,
  validateSession as validateWaSession,
  initWhatsApp,
} from "../lib/whatsapp";
import { getRootCauseDiagnosis, runAutoMaintenance } from "../lib/diagnosis-engine";

const router = Router();
router.use(requireAuth);

// ── GET /api/diagnostics/state ─────────────────────────────────────
// Returns full WA instance state dump — no side effects.
router.get("/state", (req, res) => {
  const userId = (req.session as any).userId as number;
  try {
    res.json(getDiagnosticState(userId));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
});

// ── POST /api/diagnostics/send ─────────────────────────────────────
// Direct send: no campaign, no queue, no human simulation, no anti-ban.
// Bypasses EVERYTHING — calls sock.sendMessage() directly.
// Returns step-by-step trace + ghost-send detection.
router.post("/send", async (req, res) => {
  const userId = (req.session as any).userId as number;
  const { phone, message } = req.body as { phone?: string; message?: string };
  if (!phone || !message) {
    return void res.status(400).json({ error: "phone and message required" });
  }
  try {
    const result = await directSend(userId, phone.trim(), message);
    res.json(result);
  } catch (err: any) {
    // directSend throws with .steps attached when a step fails
    if (err?.steps) {
      res.json({ steps: err.steps, msgId: null, ghostSend: true, upsertReceived: false, updateReceived: false });
    } else {
      res.status(500).json({ error: err?.message ?? "Unknown error", steps: [] });
    }
  }
});

// ── GET /api/diagnostics/validate ─────────────────────────────────
// Validates auth state, creds, keys, Signal, etc.
router.get("/validate", (req, res) => {
  const userId = (req.session as any).userId as number;
  try {
    res.json(validateWaSession(userId));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
});

// ── POST /api/diagnostics/restart ─────────────────────────────────
// Full session restart: tears down socket + listeners, rebuilds from authState.
router.post("/restart", async (req, res) => {
  const userId = (req.session as any).userId as number;
  try {
    await initWhatsApp(userId);
    res.json({ ok: true, message: "Session restart initiated — watch Live Events for connection.update" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
});

// ── GET /api/diagnostics/events ───────────────────────────────────
// SSE stream — emits ALL Baileys events in real-time (no polling).
router.get("/events", (req, res) => {
  const userId = (req.session as any).userId as number;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (type: string, data: unknown) => {
    const payload = JSON.stringify({ type, data, ts: new Date().toISOString() });
    res.write(`event: message\ndata: ${payload}\n\n`);
  };

  write("connected", { message: "SSE connected — waiting for Baileys events" });

  const unsubscribe = registerDiagListener(userId, (event) => {
    const payload = JSON.stringify(event);
    res.write(`event: message\ndata: ${payload}\n\n`);
  });

  // Heartbeat every 15 s to prevent proxy timeout
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ── GET /api/diagnostics/root-cause ────────────────────────────────
// Combines wa_session_events (disconnect analysis) + message_logs
// (send-failure classification) into a single ranked diagnosis with
// concrete Arabic recommendations. Read-only.
router.get("/root-cause", async (req, res) => {
  const userId = (req.session as any).userId as number;
  const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? "24"), 10) || 24, 1), 24 * 7);
  try {
    const diagnosis = await getRootCauseDiagnosis(userId, hours);
    res.json(diagnosis);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
});

// ── POST /api/diagnostics/auto-maintain ────────────────────────────
// Runs the safe, non-destructive self-healing routine on demand.
// Never clears credentials or forces a fresh QR by itself.
router.post("/auto-maintain", async (req, res) => {
  const userId = (req.session as any).userId as number;
  try {
    const result = await runAutoMaintenance(userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
});

export default router;
