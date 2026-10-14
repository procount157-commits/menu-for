-- ── تقييم الموظفين: مديرة الواتساب تقيّم فريقها وتراجع وراءهم ──────
-- منقولٌ من Flow Hub. درجةٌ من أرقام كل موظف، وملاحظةٌ، ومهمة؛ و
-- prev_score يحفظ الدورة السابقة: «يراجع وراهم» معناها أن يُرى هل تحرّك
-- الرقم بعد المهمة.
CREATE TABLE IF NOT EXISTS employee_evaluations (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        varchar(40) NOT NULL,
  desk        varchar(20) NOT NULL,
  manager     varchar(40) NOT NULL,
  score       integer,
  prev_score  integer,
  grade       varchar(12) NOT NULL,
  facts       jsonb NOT NULL,
  finding     text,
  task        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_evaluations ON employee_evaluations (user_id, role, created_at DESC);
