-- GET /schedule?student_id= — due reviews (SM-2-lite), joined with enough
-- of the question to actually present it. Powers both the Telegram bot
-- (D2) and the in-app drill (D3).
SELECT s.question_id, s.due_at, q.lecture_id, l.title AS lecture_title,
       q.prompt, q.options, q.correct_option_id, q.explanation, q.source_timestamp_ms
FROM schedule s
JOIN questions q ON q.id = s.question_id
JOIN lectures l ON l.id = q.lecture_id
WHERE s.student_id = $1 AND s.due_at <= now()
ORDER BY s.due_at;
