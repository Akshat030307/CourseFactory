-- POST /waitlist/{id}/invite — now creates a real student account (see
-- gateway/app/routes/waitlist.py), not just bookkeeping. The
-- "AND invited = false" guard makes this atomic against a double-click:
-- 0 rows back means either no such signup or it was already provisioned,
-- so the caller never creates two accounts for one signup.
UPDATE waitlist_signups SET invited = true WHERE id = $1 AND invited = false RETURNING name, email;
