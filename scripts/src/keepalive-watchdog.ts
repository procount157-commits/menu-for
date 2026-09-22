/**
 * keepalive-watchdog — runs as a SEPARATE workflow process.
 *
 * Purpose: keep the Replit container awake 24/7 by making continuous
 * HTTP requests to the API server even when no browser is connected.
 *
 * Why a separate process:
 *   - The main server already self-pings every 60 s, but if the container
 *     starts sleeping (no browser WebSocket), that timer may not fire in
 *     time.  A dedicated lightweight process is harder to silence.
 *   - Runs on a 90-second cycle (different from the server's 60 s) so
 *     Replit's infrastructure sees two distinct activity patterns.
 *
 * What it does every 90 s:
 *   1. Ping localhost:8080/api/ping  (direct to API, no proxy layer)
 *   2. Ping localhost:80/api/ping   (through Replit proxy — registers
 *      as proxy-layer activity which is what Replit measures for sleep)
 *   3. Log result with timestamp
 */

import http from "http";
import https from "https";

const LOCAL_API  = "http://localhost:8080/api/ping";
const PROXY_URL  = "http://localhost:80/api/ping";
const devDomain  = process.env["REPLIT_DEV_DOMAIN"];
const PUBLIC_URL = devDomain ? `https://${devDomain}/api/ping` : null;

const INTERVAL_MS = 90_000; // 90 seconds — intentionally offset from server's 60 s

function ping(url: string, label: string): void {
  const mod = url.startsWith("https") ? https : http;
  const req = mod.get(url, { timeout: 8_000 }, (res) => {
    res.resume();
    const ts = new Date().toISOString();
    if (res.statusCode === 200) {
      console.log(`[${ts}] watchdog ✓ ${label} (${res.statusCode})`);
    } else {
      console.warn(`[${ts}] watchdog ⚠ ${label} → HTTP ${res.statusCode}`);
    }
  });
  req.on("error", (err) => {
    console.warn(`[${new Date().toISOString()}] watchdog ✗ ${label} — ${err.message}`);
  });
  req.end();
}

function tick(): void {
  ping(LOCAL_API,  "localhost:8080");
  ping(PROXY_URL,  "proxy:80");
  if (PUBLIC_URL) ping(PUBLIC_URL, "public");
}

// Run immediately on start, then every 90 s
tick();
setInterval(tick, INTERVAL_MS);

console.log(`[${new Date().toISOString()}] keepalive-watchdog started`);
console.log(`  → local API  : ${LOCAL_API}`);
console.log(`  → proxy      : ${PROXY_URL}`);
console.log(`  → public URL : ${PUBLIC_URL ?? "(no REPLIT_DEV_DOMAIN)"}`);
console.log(`  → interval   : ${INTERVAL_MS / 1000} s`);
