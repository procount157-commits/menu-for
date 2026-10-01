// ── Public addresses ──────────────────────────────────────────────
// Links that go into a WhatsApp message must be absolute. SITE_URL is the
// real answer; until it is set, the address the last public visitor used is
// a better guess than localhost (it is what a phone on the same Wi-Fi can
// reach).

import crypto from "node:crypto";
import type { Request } from "express";

let seen: string | null = null;

export function rememberOrigin(req: Request) {
  if (process.env["SITE_URL"]) return;
  const host = req.get("x-forwarded-host") ?? req.get("host");
  if (!host) return;
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
  seen = `${proto}://${host}`;
}

export function publicBase(): string {
  return (process.env["SITE_URL"] || seen || `http://localhost:${process.env["PORT"] ?? 8090}`).replace(/\/+$/, "");
}

export const publicUrl = (path: string) => `${publicBase()}${path.startsWith("/") ? path : `/${path}`}`;

export const menuPath = (slug: string, branchSlug?: string | null, mainSlug = "main") =>
  branchSlug && branchSlug !== mainSlug ? `/${slug}/${branchSlug}` : `/${slug}`;
export const ticketPath = (token: string) => `/t/${token}`;
export const orderPath = (token: string) => `/o/${token}`;
export const bookingPath = (token: string) => `/b/${token}`;
export const displayPath = (token: string) => `/d/${token}`;

// ── The in-store join key ─────────────────────────────────────────
// A queue set to "from inside the shop only" accepts a join only with the key
// printed in the QR on the shop's screen, which changes every five minutes —
// so a photo of the QR sent around stops working shortly after.

const WINDOW_MS = 5 * 60_000;

export function joinKey(secret: string, at = Date.now()): string {
  const w = Math.floor(at / WINDOW_MS);
  return crypto.createHmac("sha256", secret).update(String(w)).digest("base64url").slice(0, 8);
}

export function joinKeyValid(secret: string, key: unknown, at = Date.now()): boolean {
  if (typeof key !== "string" || key.length !== 8) return false;
  return key === joinKey(secret, at) || key === joinKey(secret, at - WINDOW_MS);
}
