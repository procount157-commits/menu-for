import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const PgSession = connectPgSimple(session);

import path from "node:path";
import fs from "node:fs";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    customReceivedMessage: (req) => `→ ${req.method} ${req.url?.split("?")[0]}`,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  })
);

// ── Hardening ─────────────────────────────────────────────────────
// This was `cors({ origin: true, credentials: true })`: reflect any origin
// and send the session cookie with it, which means any page on the internet
// could make authenticated calls on behalf of a logged-in user. The app
// calls the API same-origin — the Vite proxy in development, nginx on the
// VPS — so cross-origin is only ever needed for what CORS_ORIGINS lists.
const allowedOrigins = new Set([
  ...(process.env["CORS_ORIGINS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  "http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173",
]);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
  credentials: true,
}));

// Behind nginx the connection is TLS at the proxy; this is what lets the
// session cookie's `secure: "auto"` below tell the difference.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// Login and registration get a budget per address. A password form with no
// limit is a password list's favourite thing. In memory, per process — good
// enough for one server, and reset by a restart, which is fine.
const attempts = new Map<string, { n: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX = 20;
app.use(["/api/auth/login", "/api/auth/register", "/api/auth/bootstrap-admin"], (req, res, next) => {
  const key = req.ip ?? "?";
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.resetAt < now) { attempts.set(key, { n: 1, resetAt: now + LOGIN_WINDOW_MS }); return next(); }
  if (++a.n > LOGIN_MAX) {
    res.setHeader("Retry-After", String(Math.ceil((a.resetAt - now) / 1000)));
    return res.status(429).json({ error: "محاولات كثيرة — انتظر ربع ساعة" });
  }
  next();
});
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (a.resetAt < now) attempts.delete(k); }, 60_000).unref();

// 100 MB of JSON was a limit for something that never happens; media goes
// through its own upload route. A contact import of ten thousand rows is
// under a megabyte.
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Session middleware ─────────────────────────────────────────────
const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) throw new Error("SESSION_SECRET environment variable is required");

const dbUrl = process.env["DATABASE_URL"];
if (!dbUrl) throw new Error("DATABASE_URL is required");

// Session TTL: 10 years in seconds — explicit so connect-pg-simple never misreads it
const SESSION_TTL_SECS = 10 * 365 * 24 * 60 * 60; // 315 359 040 s ≈ 10 years

app.use(
  session({
    store: new PgSession({
      conString: dbUrl,
      tableName: "user_sessions",
      createTableIfMissing: true,
      ttl: SESSION_TTL_SECS,
      pruneSessionInterval: false as unknown as number, // disable auto-prune — manual logout only
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,   // renew cookie on every request
    cookie: {
      // Secure when the request arrived over TLS (nginx sets the forwarded
      // proto), plain on a laptop over http://localhost. A fixed `true`
      // would break the local login; a fixed `false` sends the cookie in
      // clear on the VPS.
      secure: "auto",
      httpOnly: true,
      maxAge: SESSION_TTL_SECS * 1_000, // ms — must match TTL
      sameSite: "lax",
      path: "/",
    },
  })
);


app.use("/api", router);

// ── The web interface ──────────────────────────────────────────────
// On the VPS nginx serves these files; on a laptop nothing did, so running the
// app meant starting a Vite dev server as well as this one. Two processes is
// two things to remember after a reboot, and forgetting either looks like the
// whole application is broken.
//
// Serving the build from here makes it one process: start this, and the
// interface is at the same port as the API. In development the files may not
// be built yet, which is not an error — the dev server is still there for
// anyone who wants hot reload.
const WEB_ROOT = path.resolve(import.meta.dirname, "../../whatsapp-blast/dist/public");
if (fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
  // The public home page is generated HTML (scripts/seo/build-site.mjs),
  // not the app shell: a crawler gets a page it can read, and so does a
  // visitor who is not signed in. Someone with a session goes to the app.
  const STATIC_HOME = path.join(WEB_ROOT, "home", "index.html");
  app.get("/", (req, res, next) => {
    if (req.session?.userId || !fs.existsSync(STATIC_HOME)) return next();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.sendFile(STATIC_HOME);
  });

  app.use(express.static(WEB_ROOT, {
    // Hashed asset filenames can be cached hard; index.html must not be, or a
    // deploy leaves people on the previous build until they clear their cache.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      else if (/\.[0-9a-f]{8,}\./.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));

  // Client-side routing: any path that is not an API call and not a file gets
  // the app shell, so a reload on /board does not 404.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.method !== "GET" || path.extname(req.path)) return next();
    res.sendFile(path.join(WEB_ROOT, "index.html"));
  });
  logger.info({ webRoot: WEB_ROOT }, "الواجهة تُخدَم من السيرفر نفسه");
} else {
  logger.warn({ webRoot: WEB_ROOT }, "واجهة غير مبنية — شغّل pnpm build، أو استخدم خادم التطوير");
}

// ── Global JSON error handler ──────────────────────────────────────
// Express's default error handler sends HTML — browsers see
// "Unexpected token 'I', "Internal Server Error" is not valid JSON".
// This handler ensures every unhandled error comes back as { error: "..." }
// so the frontend never crashes trying to parse non-JSON.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status  = Number(err.status ?? err.statusCode ?? 500);
  const message = typeof err.message === "string" ? err.message : "Internal Server Error";
  logger.error({ err, status }, "Unhandled server error");
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

export default app;
