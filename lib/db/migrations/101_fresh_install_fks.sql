-- A database created by `drizzle-kit push` and then migrated never got the
-- document foreign key on agent_memory: the column already existed when 029
-- ran, so its ADD COLUMN IF NOT EXISTS skipped the REFERENCES with it, and
-- deleting a knowledge document left its facts behind. Older databases
-- already have it as agent_memory_doc_id_fkey.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_memory'::regclass AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%email_knowledge_docs%'
  ) THEN
    ALTER TABLE agent_memory ADD CONSTRAINT agent_memory_doc_id_fkey
      FOREIGN KEY (doc_id) REFERENCES email_knowledge_docs(id) ON DELETE CASCADE;
  END IF;
END $$;
