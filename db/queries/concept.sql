-- GET /concepts/{id} — definition and where it was introduced.
-- revisited_in[] comes from AGE (graph_queries.py); related questions from
-- concept_questions.sql.
SELECT
    c.id,
    c.label,
    c.definition,
    c.introduced_in AS lecture_id,
    l.title AS lecture_title,
    c.introduced_ms AS timestamp_ms
FROM concepts c
JOIN lectures l ON l.id = c.introduced_in
WHERE c.id = $1;
