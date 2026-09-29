-- Plans start meaning something.
--
-- PLAN_LIMITS existed as a constant, the admin page could set a plan and an
-- expiry, and nothing read either: a free account could hold ten thousand
-- contacts and a lapsed subscription kept sending. From now on the limits
-- apply and an expired paid plan falls back to the free ones.
--
-- Every account that exists today predates the rule and was created by the
-- owner for the owner's own use, with data far past the free limits. They
-- are moved to pro so nothing they rely on stops working the morning this
-- ships. New accounts start free, as the schema always said.
--
-- Apply with:  psql "$DATABASE_URL" -f lib/db/migrations/023_plans_enforced.sql
-- Safe to re-run.

UPDATE users SET plan = 'pro' WHERE plan = 'free' AND created_at < '2026-09-29';
