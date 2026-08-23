import base64
import os

from dotenv import load_dotenv

load_dotenv()


DATABASE_URL: str = os.environ["DATABASE_URL"]
PUBLIC_HOST: str = os.environ.get("PUBLIC_HOST", "http://localhost:5173")
# One hardcoded student, one instructor — see CLAUDE.md "Things not to do".
DEMO_STUDENT_ID: str = os.environ.get("DEMO_STUDENT_ID", "s1")

OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL_EMBED: str = os.environ.get("OPENAI_MODEL_EMBED", "text-embedding-3-small")

# ---------------------------------------------------------------- auth
# Added for VPS deployment — see app/auth.py. Still a single account, not a
# users table; the app's "one student, one instructor" model didn't change,
# it's just gated behind real credentials now instead of open to anyone who
# finds the URL.
AUTH_USERNAME: str = os.environ.get("AUTH_USERNAME", "")
# Stored base64-encoded in .env, not as the raw "$2b$12$..." bcrypt string —
# found the hard way that a literal $ in a Docker Compose env_file value
# gets silently mangled by Compose's own variable interpolation (e.g.
# "$2b$12$jRhZCE..." loses the "$jRhZCE..." segment entirely, since it
# looks like an unset ${jRhZCE...} reference), corrupting the hash with no
# error — Compose just warns "variable is not set" and moves on. Escaping
# every $ as $$ "fixes" Compose but then breaks local dev, since
# python-dotenv (used by `uvicorn --reload` outside Docker) does NOT treat
# $$ as an escape sequence and preserves it literally instead — verified
# both failure modes directly rather than assuming either tool's behavior.
# Base64 contains no $ at all, so neither tool ever has anything to mangle.
AUTH_PASSWORD_HASH_B64: str = os.environ.get("AUTH_PASSWORD_HASH_B64", "")
AUTH_PASSWORD_HASH: str = base64.b64decode(AUTH_PASSWORD_HASH_B64).decode() if AUTH_PASSWORD_HASH_B64 else ""
JWT_SECRET: str = os.environ.get("JWT_SECRET", "")
# Lets scripts/telegram_bot.py and scripts/mcp_server.py call the gateway's
# HTTP API without a browser login flow — the only two scripts that call it
# at all; everything else talks to Postgres directly.
SERVICE_API_KEY: str = os.environ.get("SERVICE_API_KEY", "")
