"""Gates every request except an explicit allowlist. Written as a raw ASGI
middleware rather than Starlette's BaseHTTPMiddleware because the latter
only intercepts `http`-scope requests — it silently no-ops on `websocket`
scope, which would leave /ws completely unauthenticated. This handles both
scope types the same way, checking the Cookie/Authorization headers before
the request ever reaches routing (so it also covers the /lectures and
/media StaticFiles mounts, which have no per-route dependency injection of
their own to hang an auth check on).

/media/public/ is the one deliberate exception to "everything under /media
is gated": real course content (frames, thumbnails, generated audio) stays
private, but the landing page is public by design (LandingPage.tsx, no
RequireAuth wrapper) and embeds the Telegram QR code directly in its HTML —
found live, on the actual deployment, that gating ALL of /media caught that
asset too, breaking the QR image for exactly the anonymous visitors it
exists to reach. scripts/generate_bot_qr.py writes there specifically.

Stage 14: PUBLIC_METHOD_PATHS handles the one route where the SAME path
needs different auth by HTTP method — POST /waitlist (anyone can join) vs
GET /waitlist (only a logged-in admin can see who's on it). Everything
else in this file is path-only; this is deliberately the one exception
rather than a reason to redesign the whole allowlist around methods."""

from app.auth import is_authorized

PUBLIC_PATHS = {
    "/api/v1/health",
    "/api/v1/auth/login",
    "/api/v1/auth/logout",
    "/api/v1/auth/me",
}
PUBLIC_PREFIXES = ("/media/public/",)
PUBLIC_METHOD_PATHS = {
    ("POST", "/api/v1/waitlist"),
}


def _header(headers: list[tuple[bytes, bytes]], name: bytes) -> str:
    for k, v in headers:
        if k.lower() == name:
            return v.decode("latin-1")
    return ""


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        method = scope.get("method", "")
        if path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES) or (method, path) in PUBLIC_METHOD_PATHS:
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers", [])
        cookie_header = _header(headers, b"cookie")
        auth_header = _header(headers, b"authorization")

        if is_authorized(cookie_header, auth_header):
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            # Reject before accept() rather than accepting then closing —
            # an unauthenticated client should never see a live socket,
            # even briefly.
            await send({"type": "websocket.close", "code": 4401})
            return

        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/problem+json")],
            }
        )
        body = (
            b'{"type":"about:blank","title":"Unauthorized","status":401,'
            b'"instance":"' + scope["path"].encode() + b'"}'
        )
        await send({"type": "http.response.body", "body": body})
