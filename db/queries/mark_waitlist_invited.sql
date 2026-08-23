-- POST /waitlist/{id}/invite — the admin's own bookkeeping once they've
-- actually emailed real credentials to this person. Doesn't do anything
-- else (no account gets created here — see CLAUDE.md: still one manually
-- issued account, not a registration system).
UPDATE waitlist_signups SET invited = true WHERE id = $1;
