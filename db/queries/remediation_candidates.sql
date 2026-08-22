-- Node data for R1's candidate prerequisite pool ($1 = ids from the AGE
-- backward walk). Eligibility itself (earlier lecture + mastery below
-- threshold) is decided in Python — this just supplies what's needed to
-- decide it.
SELECT c.id, c.label, c.introduced_in AS lecture_id, l.title AS lecture_title, l.sequence AS lecture_sequence,
       c.introduced_ms AS timestamp_ms, m.score AS mastery
FROM concepts c
JOIN lectures l ON l.id = c.introduced_in
LEFT JOIN mastery m ON m.concept_id = c.id AND m.student_id = $2
WHERE c.id = ANY($1::text[]);
