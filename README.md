# واتساب ماركتر

أداة إرسال جماعي احترافية عبر WhatsApp، بواجهة عربية RTL وثيم أخضر داكن — نظام SaaS متعدد المستخدمين.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/whatsapp-blast run dev` — run the frontend (proxied at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — session signing secret

## Local setup (from a clean machine)

```bash
# 1. pnpm (via corepack, shipped with Node 20+)
corepack enable && corepack prepare pnpm@latest --activate

# 2. PostgreSQL
docker run -d --name wam-postgres \
  -e POSTGRES_USER=wam -e POSTGRES_PASSWORD=wam_dev_pw \
  -e POSTGRES_DB=whatsapp_marketer -p 5433:5432 postgres:16-alpine

# 3. Config
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # -> SESSION_SECRET

# 4. Install and create the schema
pnpm install
pnpm --filter @workspace/db run push

# 5. Run (two terminals)
pnpm --filter @workspace/api-server run dev    # :8080
PORT=5173 pnpm --filter @workspace/whatsapp-blast run dev   # :5173
```

Open http://localhost:5173, register, then link WhatsApp from the Connect page.

### Linking notes

`whatsapp.ts` fetches the live WhatsApp Web version at connect time and identifies
as ubuntu/Chrome. Do not change the browser identity to anything named `"Desktop"` —
WhatsApp closes that handshake with 428 before a QR is ever issued, and a stale
client version closes it with 405. Both were live in the original code at once.


## Sending safety

The goal these serve is 1500 messages a day without losing the number. What
actually gets a WhatsApp number banned is recipient behaviour — blocks, reports
and undelivered mail — not message content, so that is what these watch.

**Delivery guard** (`artifacts/api-server/src/lib/delivery-health.ts`)
The important failure mode is silent: when WhatsApp throttles a number, sends
keep succeeding and nothing arrives. The failure-rate guard cannot see this at
all — it only counts send-time errors, and there are none. So the campaign loop
re-reads `message_logs.deliveredAt` every 25 sends and acts on the delivery rate:

| Delivered | Action |
|---|---|
| ≥ 75% | continue |
| 55–75% | slow mode — every gap ×2.5 |
| 35–55% | auto-pause (`high_risk`) |
| < 35% | auto-pause (`critical`) |

Messages younger than 20 minutes are excluded (a receipt needs time to return)
and fewer than 25 mature messages is treated as no evidence, so ordinary
offline recipients cannot trip it.

**Adaptive pacing** (`artifacts/api-server/src/lib/pacing.ts`)
Campaigns default to `pacingMode: "auto"` and derive the gap before each
message from three things that all move while the campaign runs: contacts
still unsent, allowance still unspent today, and time still left in the
sending window. No fixed delayMin/delayMax pair can track a daily target —
a campaign that loses an hour to a disconnect needs a different gap than it
started with.

1500 messages across a 12-hour window works out to a ~19s gap, with the
loop's own breaks (~4h of them) already subtracted. Never faster than 12s
however the arithmetic comes out, never slower than 3 minutes, and multiplied
by the delivery guard's slow factor when it engages. Set `pacingMode` to
`"manual"` to pin a campaign to delayMin/delayMax instead.

**Canary batch** — a campaign over 100 contacts sends 30, holds until those
receipts mature, and only then releases the rest. Without it the delivery guard
is blind for its first ~20 minutes, which at a 19s pace is another ~60 messages
sent before anything can be judged. Small lists skip the hold entirely.

**Account-wide circuit breaker** — WhatsApp bans a number, not a campaign. Two
campaigns at 73% and 27% delivery each look survivable alone; together they are
50% and the number is in trouble. Every 60 sends the aggregate across all of the
account's campaigns in the last 6 hours is checked, and a collapse stops all of
them, not just the current one.

**Known contacts first** — recipients who already have a thread in
`wa_conversations` are ordered to the front of the queue. They are very unlikely
to block or report, the non-contact ratio is part of what enforcement keys on,
and if a guard stops the campaign early the budget was spent on the safest
recipients rather than at random.

**Sending hours** — default 09:00–21:00 `Asia/Dubai`. Previously a no-op, so
campaigns ran overnight; a 03:00 marketing message earns blocks and reports far
out of proportion to its reach. Override with `SENDING_HOUR_START`,
`SENDING_HOUR_END`, `SENDING_TIMEZONE`, or `SENDING_HOURS_ENABLED=false`.

**List validation** — `POST /api/contacts/:id/validate` asks WhatsApp which
numbers in a group are real and parks the rest as `status="invalid"`. Dead
numbers cost twice: each consumes one of the day's 1500 slots and adds to the
failure rate. Numbers the check cannot resolve are left alone. All four
contact-selection paths (start, resume, send-remaining, retry) now skip
non-active contacts — previously only resume did.

Already present and unchanged: warm-up ramp (50/day on day 0, +30%/day, 1500
ceiling), opt-out enforcement, cross-campaign 72h dedup, per-send number check.

## Campaign reports

`GET /api/campaigns/:id/report` returns the funnel — attempted, sent, failed,
delivered, read, and how many are still awaiting a receipt — with delivery and
read rates, timing (duration, average gap, messages/hour) and failures grouped
by cause. `GET /api/campaigns/:id/report/export` is the same as an Excel file
with a summary sheet and a per-recipient sheet, reachable from the campaign
page. Every figure comes from `message_logs` rather than the counter columns on
the campaign row, which drift when a receipt lands during a restart.

Note `readOfDelivered` alongside `readRate`: the first is engagement among
people who actually received the message, the second is diluted by undelivered
mail.

Run the checks:

```bash
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/storage.test.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/pacing.test.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/delivery-health.test.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/account-health.test.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/follow-up.test.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/sending-hours.test.ts
```


## Follow-up sequences

Follows up with a lead on a cadence after first contact — by default 1h, 6h,
12h, 1 day, 3 days, 1 week, 1 month — and stops the moment they reply. A
sequence that keeps firing at someone who already answered is not a follow-up,
so `stopOnReply` defaults on and cancellation is re-checked at send time.

**Ad leads identify themselves.** A click-to-WhatsApp ad stamps the first
incoming message with referral data (`contextInfo.externalAdReply` plus
`entryPointConversionSource`), so `sourceFilter: "ad"` needs no manual tagging.
Detection accepts any of a `ctwaClid`, a `sourceId`, or an entry point naming
an ad surface, and looks for the referral on whichever message variant carries
it rather than assuming `extendedTextMessage`.

The raw referral payload is stored on every lead, ad or not. Before the first
ad runs there is nothing real to verify against, so `GET /follow-ups/leads`
reports `adDetected` — watch it leave zero when ads start, rather than assuming
the referral data is coming through.

| Route | |
|---|---|
| `GET/POST /api/follow-ups/sequences` | list / create (no `steps` → the default cadence) |
| `PATCH/DELETE /api/follow-ups/sequences/:id` | edit, activate, remove |
| `POST /api/follow-ups/sequences/:id/enrol` | enrol a number by hand — how to try a sequence before any ad exists |
| `POST /api/follow-ups/cancel` | drop a lead's remaining steps |
| `GET /api/follow-ups/leads` | detected leads and their source |
| `GET /api/follow-ups/jobs` | what is scheduled, sent, cancelled |

The worker ticks every minute and is deliberately cautious: it sends nothing
outside sending hours (a 3am follow-up becomes a 9am one rather than being
dropped), at most 5 per user per tick so a hundred leads hitting their one-hour
mark together do not go out as a burst, never to an opted-out number, and
never at all if WhatsApp is disconnected — those stay pending. Anything more
than a week overdue is skipped rather than sent late.

```bash
psql "$DATABASE_URL" -f lib/db/migrations/003_follow_ups.sql
```


## Sync constraints (important)

Four constraints the code depends on were never declared in the Drizzle
schemas, so the tables were created without them:

| Table | Constraint | Effect when missing |
|---|---|---|
| `wa_conversations` | PK `(user_id, phone)` | every chat silently discarded |
| `wa_contacts` | PK `(user_id, phone)` | every contact silently discarded |
| `wa_thread_messages` | unique `(user_id, message_id)` | history duplicated per reconnect |
| `incoming_messages` | unique `(user_id, message_id)` | duplicates |

The first two are upserted with `ON CONFLICT (user_id, phone)`, which Postgres
rejects outright without a matching constraint. The sync counters in
`wa_sync_state` were incremented before the write and the error was swallowed,
so the app reported thousands of synced chats and contacts while both tables
stayed empty. Counters now reflect what was actually written.

```bash
psql "$DATABASE_URL" -f lib/db/migrations/002_sync_constraints.sql
```

Run this on any database created before the fix — including production. It
collapses duplicates first, then adds the constraints, and is safe to re-run.
Existing data that was already dropped does not come back: WhatsApp only
replays full history on a fresh pairing, so recovering it means re-scanning
the QR.


## Deploy (standalone — no Replit)

Ports and production commands, previously held in the Replit artifact manifests:

| Service | Port | Path | Production |
|---|---|---|---|
| API Server | 8080 | `/api` | `node --enable-source-maps artifacts/api-server/dist/index.mjs` |
| Frontend (whatsapp-blast) | 24101 | `/` | static build served from `artifacts/whatsapp-blast/dist/public` (SPA rewrite `/* -> /index.html`) |
| Canvas (mockup-sandbox) | 8081 | `/__mockup` | dev only |

Build: `pnpm run build` (runs typecheck first). The frontend needs `PORT` and `BASE_PATH`
at dev/preview time; the API server needs `PORT`, `DATABASE_URL` and `SESSION_SECRET`.
Put a reverse proxy in front so `/api` reaches 8080 and `/` reaches the static build.

Media storage goes through `artifacts/api-server/src/lib/storage.ts`, which
writes to local disk by default (`MEDIA_DIR`, default
`artifacts/api-server/uploads`) and switches to Google Cloud Storage when
`DEFAULT_OBJECT_STORAGE_BUCKET_ID` is set — so a Replit deployment keeps
working and localhost works without one.

Object names come from URL parameters and are resolved inside the media root,
so a name like `../../etc/passwd` is refused rather than served.


## First Admin User

The first user to register gets `isAdmin=false`. To upgrade to admin:

```bash
psql "$DATABASE_URL" -c "UPDATE users SET is_admin = true WHERE phone = '<phone>';"
```

Or use the seed script after adding your credentials:

```bash
ADMIN_PHONE=xxx ADMIN_PASSWORD=xxx pnpm --filter @workspace/scripts run seed-admin
```

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS (Arabic RTL, dark green theme)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- WhatsApp: @whiskeysockets/baileys (real WhatsApp Web protocol)
- Auth: express-session + bcryptjs + connect-pg-simple (PostgreSQL session store)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks
- `lib/db/src/schema/` — DB schema (users.ts, contacts.ts, campaigns.ts, chatbots.ts)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/whatsapp.ts` — Baileys WhatsApp service (multi-instance)
- `artifacts/api-server/src/lib/auth.ts` — requireAuth, requireAdmin middleware
- `artifacts/api-server/src/routes/auth.ts` — register, login, logout, me
- `artifacts/api-server/src/routes/admin.ts` — admin CRUD for users
- `artifacts/whatsapp-blast/src/pages/` — Frontend pages
- `artifacts/whatsapp-blast/src/context/AuthContext.tsx` — useAuth() hook + AuthProvider
- `whatsapp-session/{userId}/` — per-user Baileys session storage

## Where session events live

- `lib/db/src/schema/wa_sessions.ts` — `wa_session_events` table (userId, event, detail, createdAt)
- Events logged automatically: `connected`, `reconnecting`, `qr_ready`, `logged_out`
- Health endpoint: `GET /api/whatsapp/health` — returns status + uptime + reconnect count + last 20 events
- Live uptime counter runs client-side; health data polls every 5s

## Architecture decisions

- **Multi-tenant SaaS**: each user has isolated WhatsApp instance, contact lists, campaigns, chatbots
- Contract-first: OpenAPI spec drives both backend validation and frontend hooks via codegen
- WhatsApp sessions stored per-user in `whatsapp-session/{userId}/` via Baileys multi-file auth
- Sessions stored in PostgreSQL `user_sessions` table via connect-pg-simple
- All routes protected with `requireAuth` middleware; admin routes with `requireAdmin`
- Campaign sending runs as async background loop with configurable per-message delay (min/max seconds)
- Chatbot nodes stored as JSON in the DB; keyword matching done server-side on incoming messages
- Dashboard stats served from `/api/dashboard/stats` (separate router from campaigns)
- `{الاسم}` variable in campaign messages auto-personalized from contact.name field

## Product

- **تسجيل / دخول**: صفحة login/register مع session cookie آمنة
- **لوحة التحكم**: إحصائيات شاملة + آخر الحملات (مفلترة للمستخدم)
- **ربط الواتساب**: QR كود حقيقي عبر Baileys، جلسة مستمرة منفصلة لكل مستخدم — لوحة صحة الجلسة مع مدة التشغيل وعدد إعادات الاتصال وسجل الأحداث
- **قوائم الأرقام**: إنشاء قوائم، استيراد من Excel أو لصق نصي
- **الحملات**: إنشاء حملات (نص/صورة/فيديو/أزرار/كاروسيل)، تشغيل/إيقاف، جدولة، سجل إرسال
- **الشات بوت**: بناء شجرة محادثة بكلمات مفتاحية، تفعيل/تعطيل
- **إدارة المشتركين**: (للمدير فقط) قائمة المستخدمين، تعليق/حذف، إحصائيات

## Gotchas

- protobufjs must be installed as explicit dep in api-server (Baileys peer dep not auto-resolved)
- Dashboard stats is at `/api/dashboard/stats`, NOT `/api/campaigns/dashboard/stats`
- `pnpm approve-builds` may be needed if Baileys postinstall scripts are blocked
- Session auto-reconnects on disconnect; QR regenerates every 20s until scanned
- `user_sessions` table must exist in DB — created by connect-pg-simple with `createTableIfMissing: true` (uses conString, not pool)
- userId columns in contacts/campaigns/chatbots are nullable for migration safety; all queries filter by `eq(table.userId, userId)`
