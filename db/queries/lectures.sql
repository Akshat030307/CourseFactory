-- GET /lectures — one row per lecture, with mastery averaged across its
-- introduced concepts for the hardcoded demo student ($1).
SELECT
    l.id,
    l.title,
    l.course_id,
    l.sequence,
    l.duration_ms,
    l.status,
    (
        SELECT avg(m.score)
        FROM concepts c
        JOIN mastery m ON m.concept_id = c.id AND m.student_id = $1
        WHERE c.introduced_in = l.id
    ) AS mastery
FROM lectures l
ORDER BY l.course_id, l.sequence;
