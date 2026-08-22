-- lectures has UNIQUE(course_id, sequence) — the upload endpoint needs the
-- next free slot before it can insert a new lecture row.
SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM lectures WHERE course_id = $1;
