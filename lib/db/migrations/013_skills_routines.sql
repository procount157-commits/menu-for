-- Skills and routines, after Grok Bot's own two mechanisms.
--
-- A skill is a reusable instruction set invoked by name: written once, used by
-- any employee, instead of the same paragraph copied into three personas.
--
-- A routine is scheduled work: a name, an instruction, and a trigger. The
-- monitor's twenty-minute sweep was the only scheduled thing in this system and
-- its interval lived in the source, so the owner could not add a second one
-- without a deploy.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/013_skills_routines.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS agent_skills (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What it is invoked as. Unique per account so a persona can name it.
  name        VARCHAR(60) NOT NULL,
  instruction TEXT NOT NULL,
  -- When it applies. Empty means an employee that holds this skill always
  -- carries it; otherwise only on these intents, so a long instruction set is
  -- not pasted into every single reply.
  intents     JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_name ON agent_skills (user_id, lower(name));

-- Who holds which skill. Many-to-many on purpose: "how to handle a price
-- objection" belongs to sales and collections both.
CREATE TABLE IF NOT EXISTS agent_skill_grants (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     VARCHAR(30) NOT NULL,
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role, skill_id)
);

CREATE TABLE IF NOT EXISTS agent_routines (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The employee who carries it out, in their own voice.
  role         VARCHAR(30) NOT NULL,
  name         VARCHAR(80) NOT NULL,
  instruction  TEXT NOT NULL,
  -- 'interval' every N minutes, or 'daily' at a given Gulf-time hour.
  trigger_kind VARCHAR(20) NOT NULL DEFAULT 'interval',
  every_minutes INTEGER,
  at_hour      INTEGER,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routines_due ON agent_routines (user_id, is_active, last_run_at);

-- What a routine produced, so the owner can read it and the next run can see
-- what the last one said.
CREATE TABLE IF NOT EXISTS agent_routine_runs (
  id          SERIAL PRIMARY KEY,
  routine_id  INTEGER NOT NULL REFERENCES agent_routines(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  output      TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routine_runs ON agent_routine_runs (routine_id, created_at DESC);

-- A manager is an employee like any other, marked so the router treats it as
-- the fallback owner rather than a specialist.
-- 'customer' answers customers, 'internal' never does, 'manager' delegates.
