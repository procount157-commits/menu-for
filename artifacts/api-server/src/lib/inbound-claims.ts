// ── Who answers an inbound message ────────────────────────────────
// Every inbound hook sees every message. "انضمام للصف A-27 · رمز 7F3K" is
// answered by the queue, not by the sales agent, and the agent must not also
// write back to it. A hook that will handle a message claims it here,
// synchronously, before the follow-up engine's hook runs; the claim resolves
// to whether it actually did (a code that matched nothing is released, and
// the agent answers as usual).

type Key = string;
const claims = new Map<Key, Promise<boolean>>();
const keyOf = (userId: number, phone: string, text: string) => `${userId}|${phone}|${text}`;

export function claimInbound(userId: number, phone: string, text: string, handled: Promise<boolean>) {
  const k = keyOf(userId, phone, text);
  claims.set(k, handled.catch(() => false));
  setTimeout(() => claims.delete(k), 60_000).unref?.();
}

/** Whether another hook handled this message, waiting for it to decide. */
export async function isClaimed(userId: number, phone: string, text: string): Promise<boolean> {
  const p = claims.get(keyOf(userId, phone, text));
  return p ? p : false;
}
