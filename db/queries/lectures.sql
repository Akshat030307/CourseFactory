-- GET /lectures — one row per lecture, with mastery averaged across its
-- introduced concepts for the hardcoded demo student ($1).
SELECT
    l.id,
    l.title,
    l.course_id,
    l.sequence,
    l.duration_ms,
    l.status,
    -- l01-l04's fixtures never had source_path populated (predates the
    -- upload flow) — falls back to the <id>.mp4 convention they were
    -- actually ingested under, so this stays correct for both.
    '/lectures/' || COALESCE(NULLIF(l.source_path, ''), l.id || '.mp4') AS video_url,
    (
        SELECT avg(m.score)
        FROM concepts c
        JOIN mastery m ON m.concept_id = c.id AND m.student_id = $1
        WHERE c.introduced_in = l.id
    ) AS mastery
FROM lectures l
ORDER BY l.course_id, l.sequence;
