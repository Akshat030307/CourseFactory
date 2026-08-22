-- interval_days/ease ($3/$4) are computed in Python (routes/quiz.py) — SM-2
-- branching is business logic, not SQL. This query only ever writes the
-- already-decided values. A lite version now; D3 (Stage 8) is what wires
-- this into the Telegram bot and in-app drill properly.
INSERT INTO schedule (student_id, question_id, due_at, interval_days, ease)
VALUES ($1, $2, now() + make_interval(days => $3), $3, $4)
ON CONFLICT (student_id, question_id) DO UPDATE
SET interval_days = $3, ease = $4, due_at = now() + make_interval(days => $3);
