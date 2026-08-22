-- Upload flow inserts the lecture row itself (status='uploaded',
-- source_path set to the real saved filename) rather than leaving it to
-- scripts/ingest.py's own ensure_lecture() — that call only sets
-- id/course_id/title/sequence/status, never source_path, and its
-- ON CONFLICT branch only touches status, so pre-inserting here means the
-- real extension is known immediately (VideoPlayer can play the file the
-- moment upload finishes, without waiting for ingestion to even start).
INSERT INTO lectures (id, course_id, title, sequence, source_path, status)
VALUES ($1, $2, $3, $4, $5, 'uploaded');
