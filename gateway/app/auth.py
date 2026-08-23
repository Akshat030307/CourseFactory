"""Real login, added for VPS deployment. The original hackathon scope was
deliberately "one hardcoded student, one instructor, no auth" — fine on
localhost, not fine on a public URL where anyone who finds the link can
upload video and see everything. This is intentionally still a single
account (env-var credentials, not a users table with registration) since
the app's user model hasn't otherwise changed — it's a login *gate*, not a
multi-tenant rebuild.

Two credential paths into the gateway:
  - JWT cookie, for the browser (login form -> httponly cookie -> every
    subsequent request).
  - A static bearer token (SERVICE_API_KEY), for the two scripts that call
    the gateway's own HTTP API rather than talking to Postgres directly —
    scripts/telegram_bot.py and scripts/mcp_server.py. Everything else
    (ingest.py, build_graph.py, ...) connects straight to the database and
    never goes through this at all.
"""

import time
from http.cookies import SimpleCookie

import bcrypt
import jwt

from app.config import AUTH_PASSWORD_HASH, AUTH_USERNAME, JWT_SECRET, SERVICE_API_KEY

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 60 * 60 * 24 * 7  # 7 days — a personal/instructor tool, not a bank

COOKIE_NAME = "cf_session"


def verify_credentials(username: str, password: str) -> bool:
    if not AUTH_USERNAME or not AUTH_PASSWORD_HASH:
        return False
    if username != AUTH_USERNAME:
        return False
    return bcrypt.checkpw(password.encode(), AUTH_PASSWORD_HASH.encode())


def create_session_token(username: str) -> str:
    now = int(time.time())
    payload = {"sub": username, "iat": now, "exp": now + JWT_EXPIRY_SECONDS}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_session_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def cookie_token_from_headers(raw_cookie_header: str) -> str | None:
    if not raw_cookie_header:
        return None
    jar = SimpleCookie()
    jar.load(raw_cookie_header)
    morsel = jar.get(COOKIE_NAME)
    return morsel.value if morsel else None


def is_authorized(raw_cookie_header: str, authorization_header: str) -> bool:
    """True if either credential path checks out. Bearer check is a plain
    constant-time-irrelevant equality — SERVICE_API_KEY is a long random
    secret, not a guessable password, so timing attacks aren't the risk
    model here the way they are for the login endpoint's bcrypt check."""
    if SERVICE_API_KEY and authorization_header == f"Bearer {SERVICE_API_KEY}":
        return True
    token = cookie_token_from_headers(raw_cookie_header)
    if token and verify_session_token(token):
        return True
    return False
