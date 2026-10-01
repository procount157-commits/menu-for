// ── Talking to /api/public ────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const r = await fetch(path, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!r.ok) throw new ApiError(r.status, body?.error ?? "تعذّر الاتصال — حاول مرة أخرى", body);
  return body as T;
}

/**
 * A live view: SSE from `streamUrl`, falling back to polling `pollUrl` while
 * the stream is down (a phone switching from Wi-Fi to 4G, a proxy that
 * buffers). `initial` is what the server already put in the page.
 */
export function useLive<T>(streamUrl: string | null, pollUrl: string | null, initial: T | null, pollMs = 10_000) {
  const [data, setData] = useState<T | null>(initial);
  const [gone, setGone] = useState(false);
  const [live, setLive] = useState(false);
  const setRef = useRef(setData);
  setRef.current = setData;

  useEffect(() => {
    if (!streamUrl) return;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const pollOnce = () => pollUrl && api<T>(pollUrl).then((d) => !dead && setRef.current(d)).catch((e) => { if (e instanceof ApiError && e.status === 404) setGone(true); });
    const startPoll = () => { if (!poll && pollUrl) { pollOnce(); poll = setInterval(pollOnce, pollMs); } };
    const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    const open = () => {
      if (dead) return;
      es = new EventSource(streamUrl);
      es.onmessage = (ev) => {
        try { const m = JSON.parse(ev.data); if (m?.type === "update") { setRef.current(m.data); setLive(true); stopPoll(); } } catch { /* ignore */ }
      };
      es.addEventListener("gone", () => { setGone(true); es?.close(); });
      es.onerror = () => {
        setLive(false); startPoll();
        // EventSource retries by itself; if the browser gave up, reopen later.
        if (es?.readyState === EventSource.CLOSED) { retry = setTimeout(open, 8_000); }
      };
    };
    open();
    // A phone that slept: catch up at once on wake.
    const onVis = () => { if (document.visibilityState === "visible") pollOnce(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { dead = true; es?.close(); stopPoll(); if (retry) clearTimeout(retry); document.removeEventListener("visibilitychange", onVis); };
  }, [streamUrl, pollUrl, pollMs]);

  return { data, setData, gone, live };
}

/** Navigate within the public app without a full reload. */
export function go(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function usePath(): string {
  const [p, setP] = useState(() => location.pathname);
  useEffect(() => {
    const on = () => setP(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return p.replace(/^\/mw(?=\/)/, "");
}

/** Open WhatsApp: the app on a phone, web elsewhere. Same tab on mobile so "back" returns here. */
export function openWhatsApp(link: string) {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) window.location.href = link;
  else window.open(link, "_blank", "noopener");
}

/** Remember the customer's last tickets/orders on this phone, per shop, so the menu can show "your ticket". */
export function remember(kind: "ticket" | "order" | "booking", slug: string, token: string) {
  try {
    const k = `mfy:${slug}:${kind}s`;
    const list: Array<{ token: string; at: number }> = JSON.parse(localStorage.getItem(k) ?? "[]");
    const next = [{ token, at: Date.now() }, ...list.filter((x) => x.token !== token)].slice(0, 5);
    localStorage.setItem(k, JSON.stringify(next));
  } catch { /* private mode */ }
}

export function recall(kind: "ticket" | "order" | "booking", slug: string, maxAgeMs = 12 * 3_600_000): string[] {
  try {
    const list: Array<{ token: string; at: number }> = JSON.parse(localStorage.getItem(`mfy:${slug}:${kind}s`) ?? "[]");
    return list.filter((x) => Date.now() - x.at < maxAgeMs).map((x) => x.token);
  } catch { return []; }
}

export function forget(kind: "ticket" | "order" | "booking", slug: string, token: string) {
  try {
    const k = `mfy:${slug}:${kind}s`;
    const list: Array<{ token: string; at: number }> = JSON.parse(localStorage.getItem(k) ?? "[]");
    localStorage.setItem(k, JSON.stringify(list.filter((x) => x.token !== token)));
  } catch { /* ignore */ }
}
