// ── A browser an employee can use ─────────────────────────────────
// Grok Bot gives each agent its own computer; this is the useful half of that
// for a business that sells accounting services — an employee that can look
// something up before it answers, instead of asking the customer for facts
// that are on their own website.
//
// Three decisions shape everything here.
//
// **Reading is free, changing is not.** Navigating and extracting text happen
// on the agent's own initiative. Anything that submits, posts, buys or sends
// stops and waits for the owner, because an agent that can act on a page can
// act wrongly on it, and the owner is the one who lives with that.
//
// **One session per employee, not per request.** A session keeps its cookies,
// so signing in once holds; and the sessions are named after employees so the
// board can show which one is holding a page open.
//
// **It drives the Chrome already installed**, rather than downloading a second
// browser. Playwright's bundled Chromium is another 150MB to keep current, and
// a machine that already has Chrome does not need it.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { existsSync } from "node:fs";
import { logger } from "./logger";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

function chromePath(): string | null {
  return process.env["CHROME_PATH"] ?? CHROME_PATHS.find((p) => existsSync(p)) ?? null;
}

export type Session = {
  userId: number;
  role: string;
  context: BrowserContext;
  page: Page;
  openedAt: Date;
  lastUsedAt: Date;
  url: string;
};

let browser: Browser | null = null;
const sessions = new Map<string, Session>();
const key = (userId: number, role: string) => `${userId}:${role}`;

/** Closed after this long idle, so a forgotten tab is not a permanent process. */
const IDLE_MS = 20 * 60_000;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const exe = chromePath();
  if (!exe) throw new Error("لا يوجد متصفح على هذا الجهاز — ثبّت Google Chrome");
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  });
  logger.info({ exe }, "المتصفح الداخلي جاهز");
  return browser;
}

export async function openSession(userId: number, role: string): Promise<Session> {
  const k = key(userId, role);
  const existing = sessions.get(k);
  if (existing && !existing.page.isClosed()) {
    existing.lastUsedAt = new Date();
    return existing;
  }

  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 820 },
    locale: "ar-AE",
    timezoneId: "Asia/Dubai",
  });
  const page = await context.newPage();
  const s: Session = { userId, role, context, page, openedAt: new Date(), lastUsedAt: new Date(), url: "about:blank" };
  sessions.set(k, s);
  return s;
}

export async function closeSession(userId: number, role: string): Promise<void> {
  const k = key(userId, role);
  const s = sessions.get(k);
  if (!s) return;
  await s.context.close().catch(() => {});
  sessions.delete(k);
}

/** What is open, for the board. */
export function listSessions(userId: number) {
  return [...sessions.values()]
    .filter((s) => s.userId === userId)
    .map((s) => ({
      role: s.role, url: s.url,
      openedAt: s.openedAt, lastUsedAt: s.lastUsedAt,
      idleMinutes: Math.round((Date.now() - s.lastUsedAt.getTime()) / 60_000),
    }));
}

// ── Reading ──────────────────────────────────────────────────────

// ── Scripts that run inside the page ─────────────────────────────
// Passed as source strings rather than functions. The server's tsconfig has no
// DOM lib, which is correct for a Node process — adding it so these type-check
// would also let `document` slip into server code, where it is always a bug.
// These are small enough that losing type checking inside them is the cheaper
// trade.

const EXTRACT_TEXT = `(() => {
  // Chrome, menus and cookie banners are not the page. Removing them is what
  // makes the extract short enough to put in a prompt.
  for (const sel of ["script","style","nav","header","footer","noscript","[role=banner]","[role=navigation]","[aria-hidden=true]"]) {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  }
  const main = document.querySelector("main, article, [role=main]") || document.body;
  return main.innerText.replace(/\\n{3,}/g, "\\n\\n").trim();
})()`;

const EXTRACT_LINKS = `(() =>
  Array.from(document.querySelectorAll("a[href]"))
    .map((a) => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
    .filter((l) => l.text && l.href.indexOf("http") === 0)
    .slice(0, 40)
)()`;

const EXTRACT_FORM = `(() =>
  Array.from(document.querySelectorAll("input, textarea, select"))
    .filter((e) => e.type !== "hidden")
    .map((e) => {
      const label = (e.labels && e.labels[0] && e.labels[0].innerText.trim())
        || e.getAttribute("aria-label") || e.placeholder || e.name || "";
      return {
        label: String(label).slice(0, 80),
        name: e.name || e.id || "",
        type: e.type || e.tagName.toLowerCase(),
        // Read so the owner can see what is there — except a password field,
        // whose contents never leave the page.
        value: e.type === "password" ? "" : String(e.value == null ? "" : e.value).slice(0, 200),
        required: !!e.required,
      };
    })
    .slice(0, 40)
)()`;

export type FormField = {
  label: string; name: string; type: string; value: string; required: boolean;
};

export type PageRead = {
  url: string; title: string; text: string;
  links: Array<{ text: string; href: string }>;
};

/**
 * Open a page and read it.
 *
 * `networkidle` rather than `load`, because the pages worth reading here —
 * company sites, licence registries — render their content after the shell
 * arrives, and `load` would return an empty frame.
 */
export async function readPage(
  userId: number, role: string, url: string, timeoutMs = 30_000,
): Promise<PageRead> {
  const target = normalizeUrl(url);
  const s = await openSession(userId, role);
  s.lastUsedAt = new Date();

  await s.page.goto(target, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await s.page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  s.url = s.page.url();

  const [title, text, links] = await Promise.all([
    s.page.title().catch(() => ""),
    s.page.evaluate<string>(EXTRACT_TEXT).catch(() => ""),
    s.page.evaluate<Array<{ text: string; href: string }>>(EXTRACT_LINKS).catch(() => []),
  ]);

  logger.info({ userId, role, url: s.url, chars: text.length }, "قرأ صفحة");
  return { url: s.url, title, text: text.slice(0, 20_000), links };
}

/** A picture of what the employee is looking at, for the live view. */
export async function screenshot(userId: number, role: string): Promise<Buffer | null> {
  const s = sessions.get(key(userId, role));
  if (!s || s.page.isClosed()) return null;
  s.lastUsedAt = new Date();
  return s.page.screenshot({ type: "jpeg", quality: 60, fullPage: false }).catch(() => null);
}

/** Form fields on the page, so the owner can see what would be filled. */
export async function readForm(userId: number, role: string) {
  const s = sessions.get(key(userId, role));
  if (!s || s.page.isClosed()) return [];
  return s.page.evaluate<FormField[]>(EXTRACT_FORM).catch(() => []);
}

// ── Changing ─────────────────────────────────────────────────────
// Everything below alters the page, so none of it is reachable without the
// owner asking for it by name. The route layer is where that is enforced; the
// functions themselves stay small and honest about what they do.

export async function fillField(
  userId: number, role: string, selector: string, value: string,
): Promise<void> {
  const s = sessions.get(key(userId, role));
  if (!s || s.page.isClosed()) throw new Error("لا توجد جلسة مفتوحة");
  await s.page.fill(selector, value, { timeout: 10_000 });
  s.lastUsedAt = new Date();
  logger.info({ userId, role, selector }, "ملأ حقلاً");
}

export async function click(userId: number, role: string, selector: string): Promise<void> {
  const s = sessions.get(key(userId, role));
  if (!s || s.page.isClosed()) throw new Error("لا توجد جلسة مفتوحة");
  await s.page.click(selector, { timeout: 10_000 });
  await s.page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  s.url = s.page.url();
  s.lastUsedAt = new Date();
  logger.info({ userId, role, selector, url: s.url }, "ضغط عنصراً");
}

function normalizeUrl(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}

/** Close idle sessions. Chrome contexts are not free to leave sitting. */
export function startBrowserReaper(): void {
  setInterval(() => {
    for (const [k, s] of sessions) {
      if (Date.now() - s.lastUsedAt.getTime() < IDLE_MS) continue;
      void s.context.close().catch(() => {});
      sessions.delete(k);
      logger.info({ role: s.role }, "أُغلقت جلسة تصفّح خاملة");
    }
    if (sessions.size === 0 && browser?.isConnected()) {
      void browser.close().catch(() => {});
      browser = null;
    }
  }, 5 * 60_000);
}
