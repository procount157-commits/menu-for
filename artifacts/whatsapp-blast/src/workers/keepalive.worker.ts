/**
 * Background Keep-Alive Worker
 *
 * Runs on a SEPARATE THREAD — browser does NOT throttle Web Worker timers
 * even when the tab is hidden, minimized, or the screen is locked.
 *
 * Responsibilities:
 *   1. Ping /api/healthz every 3.5 min → prevents Replit dev container from sleeping
 *      (threshold ≈ 5 min; 3.5 min gives a 1.5 min safety buffer)
 *   2. Poll /api/whatsapp/status every 5 s → streams live WA state to main thread
 *      so the UI stays accurate even when the tab is hidden
 *   3. Poll /api/auth/me every 3 min → keeps the rolling session cookie alive
 *      without waiting for the main-thread heartbeat (which is visibility-gated)
 */

const SERVER_PING_MS  = 2 * 60_000;      // 2 minutes — matches server-side interval
const WA_STATUS_MS    = 5_000;           // 5 seconds
const AUTH_RENEW_MS   = 3 * 60_000;     // 3 minutes

function pingServer() {
  fetch("/api/healthz", { cache: "no-store" }).catch(() => {});
}

function pollWaStatus() {
  fetch("/api/whatsapp/status", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data !== null) {
        self.postMessage({ type: "WA_STATUS", data });
      }
    })
    .catch(() => {});
}

function renewSession() {
  fetch("/api/auth/me", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data !== null) {
        self.postMessage({ type: "AUTH_RENEWED", data });
      }
    })
    .catch(() => {});
}

// Fire immediately on start
pingServer();
pollWaStatus();

setInterval(pingServer,    SERVER_PING_MS);
setInterval(pollWaStatus,  WA_STATUS_MS);
setInterval(renewSession,  AUTH_RENEW_MS);
