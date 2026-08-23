-- POST /telegram/link-code. expires_at is computed in Python (now + 10min).
INSERT INTO telegram_link_codes (code, student_id, expires_at) VALUES ($1, $2, $3);
