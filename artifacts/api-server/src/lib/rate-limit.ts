// ── Budgets for the public pages ──────────────────────────────────
// The menu and queue are open to anyone with the link, which is the point
// and also the risk: a script can fill a queue with fake tickets. In memory,
// per process, like the login limiter in app.ts.

import type { Request, Response, NextFunction } from "express";

interface Bucket { n: number; resetAt: number }
const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, 60_000).unref();

export function limit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}|${req.ip ?? "?"}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt < now) { buckets.set(key, { n: 1, resetAt: now + windowMs }); return next(); }
    if (++b.n > max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ error: "طلبات كثيرة — انتظر قليلاً وحاول مرة أخرى" });
    }
    next();
  };
}
