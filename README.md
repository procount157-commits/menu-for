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

> **Media storage is still Replit-bound.** `artifacts/api-server/src/lib/objectStorage.ts`
> authenticates to Google Cloud Storage through the Replit sidecar at `127.0.0.1:1106`.
> Campaign media upload/serve will not work off Replit until this is repointed at a real
> storage backend (Supabase Storage, S3, or local disk).


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
