// ── Who received it, who opened it ────────────────────────────────
// Flow Hub records ticks for campaign messages only (message_logs). The
// notifications a shop lives on — «جاء دورك», an order's receipt, a booking's
// reminder — went out with nothing coming back, so "did she see it?" had no
// answer.
//
// The WhatsApp service already offers every socket event to diagnostic
// listeners; a listener per linked number reads the same `messages.update`
// ticks and writes them onto the notification that carries the message id.
// Nothing in whatsapp.ts changes.

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { registerDiagListener, registerOnConnectHook, getActiveUserIds } from "../whatsapp";
import { logger } from "../logger";

const listening = new Map<number, () => void>();

/** Baileys status: 3 = delivered (two grey ticks), 4 = read, 5 = played. */
export async function applyReceipt(messageId: string, status: number): Promise<void> {
  if (status === 3) {
    await db.execute(sql`UPDATE notifications SET delivered_at = now() WHERE wa_message_id = ${messageId} AND delivered_at IS NULL`);
  } else if (status === 4 || status === 5) {
    await db.execute(sql`UPDATE notifications SET read_at = now(), delivered_at = coalesce(delivered_at, now()) WHERE wa_message_id = ${messageId} AND read_at IS NULL`);
  }
}

function listen(userId: number) {
  listening.get(userId)?.();
  const off = registerDiagListener(userId, (event) => {
    if (event.type !== "messages.update" || !Array.isArray(event.data)) return;
    for (const u of event.data as Array<{ key?: { id?: string; fromMe?: boolean }; update?: { status?: number } }>) {
      const id = u?.key?.id, status = u?.update?.status;
      if (!u?.key?.fromMe || !id || typeof status !== "number") continue;
      applyReceipt(id, status).catch((err) => logger.warn({ err: String(err?.message ?? err) }, "notification receipt failed"));
    }
  });
  listening.set(userId, off);
}

export function startReceipts() {
  registerOnConnectHook((userId) => listen(userId));
  for (const id of getActiveUserIds()) listen(id);
  logger.info("notification receipts listening");
}
