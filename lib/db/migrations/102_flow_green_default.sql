-- A new shop starts in Flow Hub's green rather than gold.
ALTER TABLE orgs ALTER COLUMN theme SET DEFAULT '{"template":"noir","brand":"#22c55e"}'::jsonb;
