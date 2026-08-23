-- GET /students (instructor-only) — populates the instructor's student
-- switcher. Only accounts with real credentials are listed; a bare
-- telegram-linked-but-never-provisioned row (shouldn't exist under the
-- current flow, but defensively) wouldn't have anything to display anyway.
SELECT id, username, name, telegram_id IS NOT NULL AS has_telegram, created_at
FROM students
WHERE username IS NOT NULL
ORDER BY name NULLS LAST, username;
