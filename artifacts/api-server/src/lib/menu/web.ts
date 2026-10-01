// ── Serving the public pages ──────────────────────────────────────
// /{slug}, /{slug}/{branch}, /t/…, /o/…, /b/…, /d/… are the public app
// (artifacts/menu-web). Each is the same HTML with two things filled in here:
//   • Open Graph tags — the link preview in WhatsApp is the shop's first ad,
//     so it carries the shop's name, tagline and cover rather than a blank
//   • the page's data, inlined, so the first paint needs no second request
// Paths that are not a shop fall through to the dashboard.

import fs from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { RESERVED_SLUGS } from "@workspace/menu-shared";
import { orgBySlug, branchFor, publicMenu } from "./service";
import { ticketByToken, ticketView } from "../queue/engine";
import { orderByToken, orderView } from "../orders/service";
import { bookingByToken, bookingView } from "../booking/service";
import { displayView } from "../../routes/menu-public";
import { publicBase, rememberOrigin } from "./urls";
import { logger } from "../logger";

const ROOT = path.resolve(import.meta.dirname, "../../menu-web/dist");
const ROOT_DEV = path.resolve(import.meta.dirname, "../../../../menu-web/dist");

let cache: { html: string; mtime: number } | null = null;

function root(): string | null {
  for (const r of [ROOT, ROOT_DEV]) if (fs.existsSync(path.join(r, "index.html"))) return r;
  return null;
}

function template(): string | null {
  const r = root();
  if (!r) return null;
  const file = path.join(r, "index.html");
  const m = fs.statSync(file).mtimeMs;
  if (!cache || cache.mtime !== m) cache = { html: fs.readFileSync(file, "utf8"), mtime: m };
  return cache.html;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const abs = (u: string | null | undefined) => (!u ? null : /^https?:/.test(u) ? u : `${publicBase()}${u}`);

interface Meta { title: string; description?: string | null; image?: string | null; icon?: string | null; theme?: string; lang?: string; noindex?: boolean }

function render(res: Response, meta: Meta, boot: unknown, status = 200) {
  const html = template();
  if (!html) { res.status(503).send("الواجهة العامة غير مبنية — شغّل pnpm build"); return; }
  const url = `${publicBase()}${res.req.originalUrl.split("?")[0]}`;
  const head = [
    `<title>${esc(meta.title)}</title>`,
    meta.description ? `<meta name="description" content="${esc(meta.description)}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    meta.description ? `<meta property="og:description" content="${esc(meta.description)}" />` : "",
    meta.image ? `<meta property="og:image" content="${esc(abs(meta.image))}" />` : "",
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    meta.icon ? `<link rel="icon" href="${esc(meta.icon)}" /><link rel="apple-touch-icon" href="${esc(meta.icon)}" />` : "",
    meta.noindex ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${esc(url)}" />`,
  ].filter(Boolean).join("\n    ");
  let out = html.replace(/<title>[^<]*<\/title>/, "").replace("<!--mfy:head-->", head)
    .replace("<!--mfy:boot-->", `<script>window.__MFY__=${json(boot)}</script>`);
  if (meta.lang === "en") out = out.replace('<html lang="ar" dir="rtl">', '<html lang="en" dir="ltr">');
  res.status(status).setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(out);
}

function shopMeta(org: { name: string; nameEn: string | null; tagline: string | null; about: string | null; coverUrl: string | null; logoUrl: string | null; defaultLang: string }, extra = ""): Meta {
  return {
    title: `${org.name}${extra ? ` — ${extra}` : ""}`,
    description: org.tagline ?? org.about ?? "المنيو، الطلب على واتساب، والصف الرقمي",
    image: org.coverUrl ?? org.logoUrl, icon: org.logoUrl, lang: org.defaultLang,
  };
}

export function mountMenuWeb(app: Express) {
  const r = root();
  if (!r) { logger.warn({ root: ROOT }, "public pages not built — run pnpm build"); }
  app.use("/mw", express.static(r ?? ROOT, {
    index: false,
    setHeaders: (res, p) => { if (/-[A-Za-z0-9_-]{8}\.(js|css|woff2?|png|svg)$/.test(p)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); },
  }));

  const wrap = (fn: (req: Request, res: Response) => Promise<boolean | void>) => async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    try { rememberOrigin(req); if ((await fn(req, res)) === false) next(); } catch (err) { next(err); }
  };

  app.get("/t/:token", wrap(async (req, res) => {
    const t = await ticketByToken(String(req.params.token));
    const v = t ? await ticketView(t) : null;
    if (!v) return render(res, { title: "منيو فور يو", noindex: true }, null, 404);
    render(res, { ...shopMeta({ ...v.org, tagline: null, about: null, coverUrl: null }, `تذكرة ${v.displayCode}`), noindex: true }, { kind: "ticket", path: req.path, data: v });
  }));
  app.get("/o/:token", wrap(async (req, res) => {
    const o = await orderByToken(String(req.params.token));
    const v = o ? await orderView(o) : null;
    if (!v) return render(res, { title: "منيو فور يو", noindex: true }, null, 404);
    render(res, { ...shopMeta({ ...v.org, tagline: null, about: null, coverUrl: null }, `طلب #${v.code}`), noindex: true }, { kind: "order", path: req.path, data: v });
  }));
  app.get("/b/:token", wrap(async (req, res) => {
    const b = await bookingByToken(String(req.params.token));
    const v = b ? await bookingView(b) : null;
    if (!v) return render(res, { title: "منيو فور يو", noindex: true }, null, 404);
    render(res, { ...shopMeta({ ...v.org, tagline: null, about: null, coverUrl: null }, "حجز"), noindex: true }, { kind: "booking", path: req.path, data: v });
  }));
  app.get("/d/:token", wrap(async (req, res) => {
    const v = await displayView(String(req.params.token));
    if (!v) return render(res, { title: "منيو فور يو", noindex: true }, null, 404);
    render(res, { title: `${v.org.name} — الشاشة`, icon: v.org.logoUrl, noindex: true }, { kind: "display", path: req.path, data: v });
  }));

  // A shop's menu. Anything that is not a shop goes on to the dashboard.
  app.get(["/:slug", "/:slug/:branch"], wrap(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    if (RESERVED_SLUGS.has(slug) || slug.includes(".")) return false;
    const org = await orgBySlug(slug);
    if (!org) return false;
    if (org.status !== "active") { render(res, { title: org.name, noindex: true }, null, 404); return; }
    const branch = await branchFor(org, req.params.branch ? String(req.params.branch) : null);
    if (!branch) return false;
    const menu = await publicMenu(org, branch);
    render(res, shopMeta(org, branch.slug === "main" ? "" : branch.name), { kind: "menu", path: req.path, data: menu });
  }));
}
