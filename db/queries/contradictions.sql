-- GET /courses/{id}/contradictions. Scoped via claim_a's concept ->
-- course_id (both claims in a pair always share a course by construction —
-- scripts/detect_contradictions.py only ever compares graph-adjacent
-- claims within one course's own graph).
SELECT
    x.id, x.confidence, x.note,
    ca.lecture_id AS claim_a_lecture_id, ca.timestamp_ms AS claim_a_timestamp_ms, ca.text AS claim_a_text,
    cb.lecture_id AS claim_b_lecture_id, cb.timestamp_ms AS claim_b_timestamp_ms, cb.text AS claim_b_text
FROM contradictions x
JOIN claims ca ON ca.id = x.claim_a
JOIN claims cb ON cb.id = x.claim_b
JOIN concepts co ON co.id = ca.concept_id
WHERE x.dismissed = false AND co.course_id = $1
ORDER BY x.confidence DESC;
