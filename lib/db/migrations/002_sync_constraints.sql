-- Restores four constraints the code depends on but the Drizzle schemas never
-- declared, so the tables were created without them.
--
-- wa_conversations and wa_contacts are upserted with ON CONFLICT (user_id,
-- phone). With no matching constraint Postgres rejects the statement outright,
-- so every chat and every WhatsApp contact the sync produced was discarded —
-- the counters in wa_sync_state recorded thousands while the tables stayed
-- empty. The two message tables use onConflictDoNothing(), which does not
-- error without a target; it simply never dedupes, so each reconnect
-- re-inserted the same history.
--
-- Duplicates are collapsed first, otherwise the constraints cannot be added.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/002_sync_constraints.sql
-- Safe to re-run.

BEGIN;

-- ── wa_conversations: keep the most recent row per (user_id, phone) ──
DELETE FROM wa_conversations a
USING wa_conversations b
WHERE a.user_id = b.user_id
  AND a.phone   = b.phone
  AND (a.last_msg_at, a.ctid) < (b.last_msg_at, b.ctid);

ALTER TABLE wa_conversations DROP CONSTRAINT IF EXISTS wa_conversations_pkey;
ALTER TABLE wa_conversations ADD  CONSTRAINT wa_conversations_pkey PRIMARY KEY (user_id, phone);

-- ── wa_contacts: keep the most recently seen row ─────────────────────
DELETE FROM wa_contacts a
USING wa_contacts b
WHERE a.user_id = b.user_id
  AND a.phone   = b.phone
  AND (COALESCE(a.last_message_at, 0), a.ctid) < (COALESCE(b.last_message_at, 0), b.ctid);

ALTER TABLE wa_contacts DROP CONSTRAINT IF EXISTS wa_contacts_pkey;
ALTER TABLE wa_contacts ADD  CONSTRAINT wa_contacts_pkey PRIMARY KEY (user_id, phone);

-- ── wa_thread_messages: keep the earliest copy of each message ───────
DELETE FROM wa_thread_messages a
USING wa_thread_messages b
WHERE a.user_id = b.user_id
  AND a.message_id = b.message_id
  AND a.message_id IS NOT NULL
  AND a.id > b.id;

DROP INDEX IF EXISTS idx_wa_thread_msgs_dedup;
CREATE UNIQUE INDEX idx_wa_thread_msgs_dedup
  ON wa_thread_messages (user_id, message_id)
  WHERE message_id IS NOT NULL;

-- ── incoming_messages: same ──────────────────────────────────────────
DELETE FROM incoming_messages a
USING incoming_messages b
WHERE a.user_id = b.user_id
  AND a.message_id = b.message_id
  AND a.message_id IS NOT NULL
  AND a.id > b.id;

DROP INDEX IF EXISTS idx_incoming_msgs_dedup;
CREATE UNIQUE INDEX idx_incoming_msgs_dedup
  ON incoming_messages (user_id, message_id)
  WHERE message_id IS NOT NULL;

COMMIT;
