// ── Live updates ──────────────────────────────────────────────────
// Server-sent events from an in-process emitter: a customer's ticket page,
// the staff screen and the TV each hold one stream and redraw on every
// change to their queue. One process is the deployment today; across several
// the emitter becomes Postgres LISTEN/NOTIFY and nothing above it changes.
//
// A stream sends the whole view each time rather than a diff — a ticket view
// is a few hundred bytes, and a client that missed an event cannot drift.

import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { logger } from "./logger";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export type Channel = `queue:${number}` | `orders:${number}` | `bookings:${number}` | `branch:${number}`;

export function publish(channel: Channel, payload: unknown = null) {
  bus.emit(channel, payload);
}

const PING_MS = 25_000;
let open = 0;
export const openStreams = () => open;

/**
 * Hold a stream open on `channels`, sending `render()` now and after every
 * event (coalesced, so a burst of ten calls is one redraw). `render` returning
 * null ends the stream — the ticket is gone.
 */
export function stream(req: Request, res: Response, channels: Channel[], render: () => Promise<unknown | null>) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx would otherwise buffer the stream until it closes.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  open++;

  let closed = false;
  let pending: NodeJS.Timeout | null = null;
  let running = false;
  let again = false;

  const send = async () => {
    if (closed) return;
    if (running) { again = true; return; }
    running = true;
    try {
      const data = await render();
      if (closed) return;
      if (data === null) { res.write(`event: gone\ndata: {}\n\n`); end(); return; }
      res.write(`data: ${JSON.stringify({ type: "update", data })}\n\n`);
    } catch (err) {
      logger.warn({ err: String((err as Error)?.message ?? err) }, "stream render failed");
    } finally {
      running = false;
      if (again && !closed) { again = false; schedule(); }
    }
  };
  const schedule = () => {
    if (pending || closed) return;
    pending = setTimeout(() => { pending = null; void send(); }, 120);
  };
  const ping = setInterval(() => { if (!closed) res.write(`: ping\n\n`); }, PING_MS);
  for (const c of channels) bus.on(c, schedule);

  const end = () => {
    if (closed) return;
    closed = true;
    open--;
    clearInterval(ping);
    if (pending) clearTimeout(pending);
    for (const c of channels) bus.off(c, schedule);
    try { res.end(); } catch { /* already gone */ }
  };
  req.on("close", end);
  void send();
}
