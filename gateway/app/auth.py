"""Real login, added for VPS deployment. The original hackathon scope was
deliberately "one hardcoded student, one instructor, no auth" — fine on
localhost, not fine on a public URL where anyone who finds the link can
upload video and see everything. Stage 15 added real per-student accounts
on top of that (see CLAUDE.md) — still no self-service registration, still
admin-provisioned only (via the waitlist "Create account" flow), just more
than one account now.

Two credential paths into the gateway:
  - JWT cookie, for the browser (login form -> httponly cookie -> every
    subsequent request). Carries a role ("instructor" or "student") and,
    for students, which student_id they are.
  - A static bearer token (SERVICE_API_KEY), for the two scripts that call
    the gateway's own HTTP API rather than talking to Postgres directly —
    scripts/telegram_bot.py and scripts/mcp_server.py. Everything else
    (ingest.py, build_graph.py, ...) connects straight to the database and
    never goes through this at all. Resolves to role="service" — a trusted
    caller allowed to specify which student it's acting on behalf of,
    exactly like an instructor session can (see resolve_student_id below).
"""

import time
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Literal

import bcrypt
import jwt
from fastapi import HTTPException

from app.config import AUTH_PASSWORD_HASH, AUTH_USERNAME, DEMO_STUDENT_ID, JWT_SECRET, SERVICE_API_KEY
from app.queries import load

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 60 * 60 * 24 * 7  # 7 days — a personal/instructor tool, not a bank

COOKIE_NAME = "cf_session"

Role = Literal["instructor", "student", "service"]


@dataclass
class Identity:
    role: Role
    student_id: str | None
    username: str | None


async def resolve_login(conn, username: str, password: str) -> Identity | None:
    """Tries the single instructor account first (env-var credentials,
    unchanged), then falls back to a per-student username/password lookup.
    Needs `conn` for the student path — same "plain async helper that takes
    a connection explicitly" shape as remediation.py's compute_remediation,
    called from inside a route body rather than via a FastAPI dependency
    (no route in this codebase uses Depends() for auth)."""
    if AUTH_USERNAME and AUTH_PASSWORD_HASH and username == AUTH_USERNAME:
        if bcrypt.checkpw(password.encode(), AUTH_PASSWORD_HASH.encode()):
            return Identity(role="instructor", student_id=None, username=username)
        return None

    row = await conn.fetchrow(load("get_student_by_username.sql"), username)
    if row is None or row["password_hash"] is None:
        return None
    if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return None
    return Identity(role="student", student_id=row["id"], username=row["username"])


def create_session_token(identity: Identity) -> str:
    now = int(time.time())
    payload = {
        "sub": identity.username,
        "role": identity.role,
        "student_id": identity.student_id,
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
    }
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


def resolve_identity(raw_cookie_header: str, authorization_header: str) -> Identity | None:
    """True if either credential path checks out — but unlike the old
    is_authorized() bool, callers get back WHO/WHAT authenticated, so
    routes can tell a student's own session apart from an instructor's or
    a trusted service caller's. Bearer check is a plain
    constant-time-irrelevant equality — SERVICE_API_KEY is a long random
    secret, not a guessable password, so timing attacks aren't the risk
    model here the way they are for the login endpoint's bcrypt check."""
    if SERVICE_API_KEY and authorization_header == f"Bearer {SERVICE_API_KEY}":
        return Identity(role="service", student_id=None, username=None)
    token = cookie_token_from_headers(raw_cookie_header)
    if token:
        payload = verify_session_token(token)
        if payload:
            return Identity(role=payload["role"], student_id=payload.get("student_id"), username=payload["sub"])
    return None


def resolve_student_id(identity: Identity, requested: str | None) -> str:
    """The actual access-control boundary for student data. A student
    session's own id ALWAYS wins, regardless of what a client sends in a
    request body/query string — closes the gap where, before Stage 15's
    real per-student accounts, `student_id` was just a client-trusted
    value with nothing to actually verify it against. Instructor and
    service (Telegram bot, MCP server) callers are trusted to say which
    student they mean — the bot already resolves the correct id itself via
    its own telegram_id lookup, and the instructor gets an explicit
    student-switcher in the UI — so they keep the old permissive behavior,
    falling back to the demo student if they don't specify one."""
    if identity.role == "student" and identity.student_id is not None:
        return identity.student_id
    return requested if requested else DEMO_STUDENT_ID


def require_instructor(identity: Identity) -> None:
    """Raises if the caller isn't the one instructor account. Course
    content management (upload, review queue, waitlist admin) has no
    student-facing reason to exist — before Stage 15 there was only ever
    one non-service account, so "authenticated" and "instructor" were the
    same check; now that student accounts are real, they aren't."""
    if identity.role != "instructor":
        raise HTTPException(status_code=403, detail="Instructor account required.")
