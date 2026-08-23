-- GET /waitlist (admin-only). Newest first — the admin is triaging who to
-- invite next, not scrolling through history.
SELECT id, name, email, message, invited, created_at
FROM waitlist_signups
ORDER BY created_at DESC;
