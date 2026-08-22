-- GET /lectures/{id}/segments — immutable once a lecture is ready, so the
-- gateway can cache aggressively. Optional $2/$3 time-window bounds.
SELECT id, start_ms, end_ms, text, speaker
FROM segments
WHERE lecture_id = $1
  AND ($2::bigint IS NULL OR end_ms >= $2)
  AND ($3::bigint IS NULL OR start_ms <= $3)
ORDER BY start_ms;
