-- GET /review-queue?course_id= — unapproved questions with enough context
-- (nearest transcript segment, nearest board frame at-or-before the
-- question's source moment) that an instructor can verify in seconds
-- without leaving this view.
SELECT
    q.id, q.lecture_id, l.title AS lecture_title, q.concept_id, c.label AS concept_label,
    q.prompt, q.options, q.correct_option_id, q.explanation, q.source_timestamp_ms,
    seg.text AS segment_text, seg.start_ms AS segment_start_ms,
    fr.id AS frame_id, fr.thumb_path AS frame_thumb_path
FROM questions q
JOIN lectures l ON l.id = q.lecture_id
LEFT JOIN concepts c ON c.id = q.concept_id
LEFT JOIN LATERAL (
    SELECT text, start_ms FROM segments s
    WHERE s.lecture_id = q.lecture_id
    ORDER BY ABS(s.start_ms - q.source_timestamp_ms)
    LIMIT 1
) seg ON true
LEFT JOIN LATERAL (
    SELECT id, thumb_path FROM frames f
    WHERE f.lecture_id = q.lecture_id AND f.timestamp_ms <= q.source_timestamp_ms
    ORDER BY f.timestamp_ms DESC
    LIMIT 1
) fr ON true
WHERE q.approved = false AND l.course_id = $1
ORDER BY l.sequence, q.source_timestamp_ms;
