-- POST /waitlist (public — no login needed to join). ON CONFLICT DO NOTHING
-- rather than erroring on a repeat email: the frontend shows the same
-- "you're on the list" response either way, which also avoids leaking
-- whether a given email already signed up.
INSERT INTO waitlist_signups (name, email, message)
VALUES ($1, $2, $3)
ON CONFLICT (email) DO NOTHING;
