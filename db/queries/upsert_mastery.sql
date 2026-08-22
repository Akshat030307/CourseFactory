-- $3 is the raw outcome (1.0 correct / 0.0 incorrect), not a blended score —
-- a first-ever attempt sets the initial score directly; a repeat blends
-- 70% old / 30% new (simple EMA, not a formal model — good enough to move
-- meaningfully after a handful of attempts without one wrong answer
-- wiping out a real track record).
INSERT INTO mastery (student_id, concept_id, score, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (student_id, concept_id) DO UPDATE
SET score = mastery.score * 0.7 + EXCLUDED.score * 0.3, updated_at = now()
RETURNING score;
