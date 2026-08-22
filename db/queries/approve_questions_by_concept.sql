UPDATE questions SET approved = true, approved_by = $2, approved_at = now()
WHERE concept_id = $1 AND approved = false
RETURNING id;
