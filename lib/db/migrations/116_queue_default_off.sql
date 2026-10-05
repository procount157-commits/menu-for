-- The queue is a salon's and a barber's door; a restaurant, café or sweets
-- shop that never chose it has it off (one switch in «ماذا يقدّم منيوك؟»).
UPDATE orgs SET features = features || '{"queueOn": false}'::jsonb
WHERE vertical IN ('restaurant', 'cafe', 'sweets') AND NOT (features ? 'queueOn');
