-- Waitlist "Create account" flow (gateway/app/routes/waitlist.py). id is
-- the generated username itself — no second id scheme needed.
INSERT INTO students (id, username, password_hash, name) VALUES ($1, $1, $2, $3);
