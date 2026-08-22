-- Related questions for GET /concepts/{id}. approved-only, same rule as the
-- quiz endpoint (Stage 6) — a student-facing view never sees an unreviewed
-- question. Empty until A1 generates any; the join is correct now either way.
SELECT id, prompt, source_timestamp_ms
FROM questions
WHERE concept_id = $1 AND approved = true
ORDER BY source_timestamp_ms;
