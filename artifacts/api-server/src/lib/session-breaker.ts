// ── Dead-credential breaker ───────────────────────────────────────
// Decides when a WhatsApp pairing has stopped being usable, so the credentials
// can be cleared and a QR offered — and, just as importantly, when it has not.
//
// Clearing the pairing is the most destructive thing this system can do on its
// own: nothing works again until a person scans a code. The first version of
// this breaker fired fifty times on one account in three days, and every one
// of those fifty was wrong. The close reason each time was 405, which is
// WhatsApp refusing the *client version* in the handshake — the credentials
// were fine, and the version was stale because the lookup had failed on a
// laptop that was asleep. Wiping the pairing turned a two-minute problem into
// a two-day outage.
//
// So the rules are now:
//
//   1. Only a reason that names the credentials counts toward clearing them:
//      401 (logged out) and 403 (forbidden). Five of those in a row with no
//      connection having held in between, and the pairing is dead.
//
//   2. 405 is a handshake refusal. The caller refreshes the client version and
//      retries; the credentials are never touched over it.
//
//   3. Connects that never hold — eight inside fifteen minutes — mean the
//      environment is unstable, not the pairing. The verdict is a cooldown:
//      stop hammering for a while, credentials intact.
//
// "Held" means survived STABLE_AFTER_MS. A connection that dies in five
// seconds is not evidence the credentials are good, and clearing the count on
// it is what let a connect-die loop run for a day looking healthy.

export const CREDENTIAL_REJECTED = new Set([401, 403]);
export const HANDSHAKE_REJECTED  = new Set([405]);
export const MAX_REJECTS_BEFORE_REPAIR = 5;
export const STABLE_AFTER_MS = 45_000;
export const FLAP_WINDOW_MS = 15 * 60_000;
export const FLAP_LIMIT = 8;
/** How long a cooldown keeps the socket down. */
export const COOLDOWN_MS = 10 * 60_000;

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
  /** Clear the credentials; a scan will be needed. */
  repair: boolean;
  /** Keep the credentials but stop reconnecting for COOLDOWN_MS. */
  cooldown: boolean;
  cause?: "credentials_rejected" | "flapping";
  reason?: string;
}

const QUIET: BreakerVerdict = { repair: false, cooldown: false };

export function isRejection(reason?: number): boolean {
  return reason !== undefined && CREDENTIAL_REJECTED.has(reason);
}

export function isHandshakeRejection(reason?: number): boolean {
  return reason !== undefined && HANDSHAKE_REJECTED.has(reason);
}

export function assessSession(input: BreakerInput): BreakerVerdict {
  if (input.manualLogout) return QUIET;

  const now = input.now ?? Date.now();
  const connects = input.recentConnects.filter((t) => now - t < FLAP_WINDOW_MS);

  if (input.failuresSinceStable >= MAX_REJECTS_BEFORE_REPAIR) {
    return {
      repair: true, cooldown: false,
      cause: "credentials_rejected",
      reason: `رفض واتساب الاعتمادات ${input.failuresSinceStable} مرات متتالية${input.reason ? ` (آخرها ${input.reason})` : ""}`,
    };
  }

  if (connects.length >= FLAP_LIMIT) {
    return {
      repair: false, cooldown: true,
      cause: "flapping",
      reason: `اتصل ${connects.length} مرات خلال ${FLAP_WINDOW_MS / 60_000} دقيقة دون أن يثبت — توقّف ${COOLDOWN_MS / 60_000} دقائق قبل المحاولة التالية`,
    };
  }

  return QUIET;
}
