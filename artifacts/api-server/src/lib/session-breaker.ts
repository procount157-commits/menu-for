// ── Dead-credential breaker ───────────────────────────────────────
// Decides when a WhatsApp pairing has stopped being usable, so the credentials
// can be cleared and a QR offered.
//
// Two failure modes hide behind an endless reconnect loop, and neither
// announces itself:
//
//   1. WhatsApp refuses the pairing — the socket closes with 401/403/405 and
//      Baileys never offers a QR, because it can see stored credentials and
//      assumes it should restore rather than pair. Retrying identical rejected
//      credentials cannot recover, so it runs for ever: connected? no. QR? no.
//
//   2. It accepts and drops, repeatedly, so nothing ever holds. Counting a
//      connection as success the moment it opens makes this invisible — the
//      counter resets on every pass of a connect-die loop.
//
// Hence "stable", not "connected": a connection has to survive long enough to
// mean something before it clears the record.

export const CREDENTIAL_REJECTED = new Set([401, 403, 405]);
export const MAX_REJECTS_BEFORE_REPAIR = 5;
export const STABLE_AFTER_MS = 45_000;
export const FLAP_WINDOW_MS = 15 * 60_000;
export const FLAP_LIMIT = 8;

export interface BreakerInput {
  /** Disconnect reason from the last close, if any. */
  reason?: number;
  /** Rejections counted since a connection last held. */
  failuresSinceStable: number;
  /** Open timestamps inside the flap window, none of which held. */
  recentConnects: number[];
  /** True while the user asked to disconnect — never repair over that. */
  manualLogout?: boolean;
  now?: number;
}

export interface BreakerVerdict {
  repair: boolean;
  cause?: "credentials_rejected" | "flapping";
  reason?: string;
}

export function isRejection(reason?: number): boolean {
  return reason !== undefined && CREDENTIAL_REJECTED.has(reason);
}

export function assessSession(input: BreakerInput): BreakerVerdict {
  if (input.manualLogout) return { repair: false };

  const now = input.now ?? Date.now();
  const connects = input.recentConnects.filter((t) => now - t < FLAP_WINDOW_MS);

  if (input.failuresSinceStable >= MAX_REJECTS_BEFORE_REPAIR) {
    return {
      repair: true,
      cause: "credentials_rejected",
      reason: `رفض واتساب الاعتمادات ${input.failuresSinceStable} مرات متتالية${input.reason ? ` (آخرها ${input.reason})` : ""}`,
    };
  }

  if (connects.length >= FLAP_LIMIT) {
    return {
      repair: true,
      cause: "flapping",
      reason: `اتصل ${connects.length} مرات خلال ${FLAP_WINDOW_MS / 60_000} دقيقة دون أن يثبت`,
    };
  }

  return { repair: false };
}
