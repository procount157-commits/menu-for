import { useEffect, useRef } from "react";

const PING_INTERVAL_MS   = 4 * 60_000;  // ping server every 4 minutes
const RELOAD_INTERVAL_MS = 20 * 60_000; // silent reload every 20 minutes

/**
 * useKeepAlive — prevents browser idle / computer sleep while the app is open.
 *
 * Three mechanisms:
 * 1. Screen Wake Lock API  — requests the OS not to sleep the screen.
 *    Automatically re-acquired when the tab regains visibility.
 * 2. Server ping every 4 min — keeps the HTTP session cookie alive.
 * 3. Page reload every 20 min — refreshes React state and clears stale data.
 *    The reload is deferred if the user is actively typing (input focused).
 */
export function useKeepAlive(enabled = true) {
  const wakeLockRef   = useRef<WakeLockSentinel | null>(null);
  const pingTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Wake Lock ────────────────────────────────────────────────────
  const acquireWakeLock = async () => {
    if (!enabled) return;
    if (!("wakeLock" in navigator)) return; // not supported (HTTP or old browser)
    try {
      if (wakeLockRef.current) return; // already held
      const lock = await (navigator as any).wakeLock.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // silently ignore — permission denied or not supported
    }
  };

  const releaseWakeLock = () => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  };

  // Re-acquire wake lock when tab becomes visible again
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") acquireWakeLock();
  };

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    acquireWakeLock();
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Server ping — keeps session cookie alive
    pingTimerRef.current = setInterval(async () => {
      try {
        await fetch("/api/auth/me", { credentials: "include" });
      } catch { /* ignore network hiccup */ }
    }, PING_INTERVAL_MS);

    // Silent page reload every 20 min — skip if user is actively typing
    reloadTimerRef.current = setInterval(() => {
      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement)?.isContentEditable;
      if (!isTyping) {
        window.location.reload();
      }
    }, RELOAD_INTERVAL_MS);

    return () => {
      releaseWakeLock();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (pingTimerRef.current)  clearInterval(pingTimerRef.current);
      if (reloadTimerRef.current) clearInterval(reloadTimerRef.current);
    };
  }, [enabled]);
}
