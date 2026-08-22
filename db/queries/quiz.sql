-- GET /lectures/{id}/quiz — approved-only by default. $2 = true switches to
-- instructor mode (?include_unapproved=true), matching docs/API.md.
SELECT id, prompt, options, correct_option_id, concept_id, source_timestamp_ms, explanation
FROM questions
WHERE lecture_id = $1
  AND (approved = true OR $2 = true)
ORDER BY source_timestamp_ms;
