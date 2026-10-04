// ── Counting what the menu is looked at for ───────────────────────
// Small batches of «menu opened / item opened / added / cart opened», sent
// every few seconds and when the page hides. The session id lives only in
// this tab; nothing identifies the person, and the server keeps counters.

type Ev = { k: "menu" | "item" | "add" | "cart" | "upsell"; id?: number };

let ctx: { slug: string; branch: string } | null = null;
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function sid(): string {
  try {
    let s = sessionStorage.getItem("mfy:sid");
    if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("mfy:sid", s); }
    return s;
  } catch { return "anon" + Math.random().toString(36).slice(2, 10); }
}

function flush() {
  timer = null;
  if (!ctx || !queue.length) return;
  const body = JSON.stringify({ slug: ctx.slug, branch: ctx.branch, sid: sid(), events: queue.splice(0, 50) });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/public/events", blob)) return;
  } catch { /* fall through */ }
  void fetch("/api/public/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

export function initTrack(slug: string, branch: string) {
  ctx = { slug, branch };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  track({ k: "menu" });
}

export function track(e: Ev) {
  queue.push(e);
  if (!timer) timer = setTimeout(flush, 4_000);
}
