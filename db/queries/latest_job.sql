-- X5's trace panel needs *something* to subscribe to. Ingestion runs from
-- the CLI (scripts/ingest.py), not a browser-triggered flow, so there's no
-- "start job" request to hand back an id from — the panel discovers the
-- most recent job instead and follows it while it's running.
SELECT id, lecture_id, status, error FROM jobs ORDER BY created_at DESC LIMIT 1;
