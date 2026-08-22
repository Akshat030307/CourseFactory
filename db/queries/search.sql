-- POST /search — dual-lane vector search. $4 (source) is NULL for lane=both,
-- 'transcript' for lane=spoken, 'board' for lane=written: a real WHERE
-- predicate, not a post-filter, so `written` genuinely only touches board
-- chunks rather than fetching everything and hiding the transcript rows.
SELECT
    l.id AS lecture_id,
    l.title AS lecture_title,
    c.timestamp_ms,
    c.text AS snippet,
    1 - (c.embedding <=> $1::vector) AS score,
    c.source,
    f.spoken_elsewhere,
    c.frame_id
FROM chunks c
JOIN lectures l ON l.id = c.lecture_id
LEFT JOIN frames f ON f.id = c.frame_id
WHERE l.course_id = $2
  AND ($3::text IS NULL OR c.lecture_id = $3)
  AND ($4::chunk_source IS NULL OR c.source = $4)
ORDER BY c.embedding <=> $1::vector
LIMIT $5;
