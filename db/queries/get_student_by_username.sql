-- Login lookup, student path (gateway/app/auth.py's resolve_login()).
SELECT id, username, password_hash, name FROM students WHERE username = $1;
