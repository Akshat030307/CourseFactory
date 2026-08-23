import os

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth import (
    COOKIE_NAME,
    cookie_token_from_headers,
    create_session_token,
    verify_credentials,
    verify_session_token,
)

router = APIRouter()

# Cookie lifetime matches the JWT's own — no point in a cookie that outlives
# the token it carries. 7 days, not "session" (browser-close-expiring),
# since the closest real user of this is one instructor coming back daily.
COOKIE_MAX_AGE = 60 * 60 * 24 * 7

# Secure=True cookies are silently dropped by browsers over plain HTTP —
# right for the real VPS deployment (Caddy terminates real HTTPS), wrong
# for testing this locally over http://localhost. Default true (production
# is the common case now); set COOKIE_SECURE=false in a local .env to test
# the login flow against `npm run dev`.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"


class LoginRequest(BaseModel):
    username: str
    password: str


class MeResponse(BaseModel):
    authenticated: bool
    username: str | None = None


@router.post("/auth/login")
async def login(body: LoginRequest, response: Response) -> MeResponse:
    if not verify_credentials(body.username, body.password):
        raise HTTPException(status_code=401, detail="Wrong username or password.")
    token = create_session_token(body.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    return MeResponse(authenticated=True, username=body.username)


@router.post("/auth/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/auth/me")
async def me(request: Request) -> MeResponse:
    token = cookie_token_from_headers(request.headers.get("cookie", ""))
    payload = verify_session_token(token) if token else None
    if not payload:
        return MeResponse(authenticated=False)
    return MeResponse(authenticated=True, username=payload["sub"])
