import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const PgSession = connectPgSimple(session);

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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

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
      secure: false,
      httpOnly: true,
      maxAge: SESSION_TTL_SECS * 1_000, // ms — must match TTL
      sameSite: "lax",
      path: "/",
    },
  })
);


app.use("/api", router);

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
