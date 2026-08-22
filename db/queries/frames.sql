-- GET /lectures/{id}/frames — deduped board states for the strip. Optional
-- $2/$3 time-window bounds, $4 caps the row count for windowed loading.
SELECT id, timestamp_ms, thumb_path, ocr_text, ocr_confidence, vision_description, spoken_elsewhere
FROM frames
WHERE lecture_id = $1
  AND ($2::bigint IS NULL OR timestamp_ms >= $2)
  AND ($3::bigint IS NULL OR timestamp_ms <= $3)
ORDER BY timestamp_ms
LIMIT $4;
