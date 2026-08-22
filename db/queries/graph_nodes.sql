-- GET /courses/{id}/graph — node data (label, introduction point, mastery).
-- Edges live in AGE, not here — see gateway/app/graph_queries.py. $3 is an
-- optional id allowlist (NULL = every concept in the course), used when
-- collapsing to one lecture's cluster plus its one-hop neighbors.
SELECT
    c.id,
    c.label,
    c.introduced_in AS lecture_id,
    c.introduced_ms AS timestamp_ms,
    m.score AS mastery
FROM concepts c
LEFT JOIN mastery m ON m.concept_id = c.id AND m.student_id = $2
WHERE c.course_id = $1
  AND ($3::text[] IS NULL OR c.id = ANY($3::text[]))
ORDER BY c.introduced_ms;
