-- GET /remediation — resolve the failed question to its concept and
-- "current" lecture (the question's own lecture_id — the authoritative
-- "where the student is right now" signal per docs/API.md's contract).
SELECT q.concept_id, q.lecture_id, l.sequence AS lecture_sequence, l.course_id, c.label AS concept_label
FROM questions q
JOIN lectures l ON l.id = q.lecture_id
LEFT JOIN concepts c ON c.id = q.concept_id
WHERE q.id = $1;
