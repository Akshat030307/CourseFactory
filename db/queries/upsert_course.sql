-- Upload flow: create the course if the user typed a new one. A no-op if
-- they picked an existing course_id — never overwrites a real title with
-- a placeholder (scripts/ingest.py's own ensure_lecture() does the same
-- ON CONFLICT DO NOTHING for this exact reason).
INSERT INTO courses (id, title) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING;
