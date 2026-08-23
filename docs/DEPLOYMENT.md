# Deployment (Stage 13)

The whole thing running on a real VPS instead of localhost — Postgres
(pgvector + AGE), the gateway, the built SPA, and the Telegram bot as one
Docker Compose stack behind Caddy, with real login gating every route.
`docker-compose.yml` (no `.prod`) is still the local-dev setup and is
untouched by any of this — this is a genuinely separate file and workflow.

## Prerequisites

- A VPS with Docker + the Compose plugin installed (any provider — this
  doesn't assume anything provider-specific). 2GB RAM is workable; ffmpeg
  and OCR aren't heavy, the LLM calls are all remote.
- A domain's A record pointed at the VPS's IP, **if** you want a real
  trusted cert. You can deploy first with `DOMAIN=localhost` (verified
  end-to-end — login, cookies, everything, over HTTPS with Caddy's own
  locally-trusted self-signed cert) and switch to the real domain once DNS
  is live — nothing else changes. Expect a browser warning (or `curl -k`)
  until then.
- Groq + OpenAI API keys (same ones local dev uses).

## Sharing a VPS with other projects

If something else on the box already holds ports 80/443 (a real case, not
hypothetical — this repo's own deployment target has `mesh-caddy` already
running for two other domains), don't fight it for those ports. Layer in
`docker-compose.prod.shared-vps.yml`, which remaps Caddy to one free port
of your choosing instead:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.shared-vps.yml up -d --build
```

and in `.env`:

```
CADDY_PORT=8020            # any free port — check first: ss -tlnp | grep LISTEN
DOMAIN=:8020                # note the leading colon — a port-only Caddy address
```

`DOMAIN=:8020` means "plain HTTP on port 8020, no automatic HTTPS" — there's
no domain pointed here yet to get a real cert for, and there's no clean way
to make Caddy's own HTTP→HTTPS redirect aware that the outside world reaches
it on a Docker-remapped port instead of 443, so this sidesteps that rather
than fighting it. The app is reachable at `http://<vps-ip>:8020` in this
state. Once you point a real subdomain at the VPS, switch `DOMAIN` to it,
drop `-f docker-compose.prod.shared-vps.yml`, and it's back to standard
80/443 with a real trusted cert — nothing else changes.

If you *do* own the whole VPS, skip this section — the plain
`docker-compose.prod.yml` from here on already assumes that.

## First-time setup

```bash
git clone https://github.com/Akshat030307/CourseFactory.git
cd CourseFactory
cp .env.example .env
```

Fill in `.env`. Beyond the usual `GROQ_API_KEY`/`OPENAI_API_KEY`, production
needs the auth block filled in for real — the app 401s on every route until
these exist:

```bash
# One admin account gates the whole app (this makes it a real login
# instead of an open door). Real student accounts (Stage 15) are provisioned
# separately, at runtime, via the waitlist's "Create account" flow — they
# don't need anything in .env; only the single instructor account does.
#
# base64, not the raw bcrypt string — a literal $ in a Compose env_file
# value gets silently corrupted by Compose's own interpolation (confirmed
# directly while building this: "$2b$12$jRhZCE..." loses the "$jRhZCE..."
# segment, with only a "variable is not set" warning to notice by). This
# one-liner sidesteps it entirely rather than relying on $$-escaping, which
# has the opposite problem locally (python-dotenv doesn't unescape $$, so
# it'd break `uvicorn --reload` instead).
python3 -c "import bcrypt, base64; print(base64.b64encode(bcrypt.hashpw(b'YOUR-REAL-PASSWORD', bcrypt.gensalt())).decode())"
# -> paste the output into AUTH_PASSWORD_HASH_B64
# AUTH_USERNAME=whatever you want to sign in as

python3 -c "import secrets; print(secrets.token_hex(32))"
# -> paste into JWT_SECRET

python3 -c "import secrets; print(secrets.token_hex(32))"
# -> paste into SERVICE_API_KEY (a *different* random value from JWT_SECRET)
```

(`bcrypt`/`secrets` need to exist wherever you run these two lines — the
project's own conda env already has `bcrypt`, or run
`pip install bcrypt` first, or run it inside the built gateway image once
it exists: `docker compose -f docker-compose.prod.yml run --rm gateway
python -c "..."`.)

Also set in `.env`:

```
POSTGRES_PASSWORD=<real random password, not "coursefactory">
DOMAIN=<your domain, or the VPS's bare IP for a first smoke test>
COOKIE_SECURE=true          # leave this at true for the real deployment
```

For `POSTGRES_PASSWORD`, generate it rather than pick one by hand —
`openssl rand -hex 24` or `python3 -c "import secrets; print(secrets.token_hex(24))"`.
Same reasoning as `AUTH_PASSWORD_HASH_B64` above: this value goes straight
into a Compose `${POSTGRES_PASSWORD}` reference, and a `$` anywhere in it
would hit the exact same interpolation bug. Hex output can't contain one.

## Bring it up

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes a few minutes (pgvector/AGE layer, the gateway's
ffmpeg/tesseract install, the frontend's `npm ci && npm run build`). Watch
it:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

## Verify

```bash
curl -I https://your-domain/                  # add -k if you're still on a self-signed cert (localhost/bare IP, no real DOMAIN yet)
curl -s https://your-domain/api/v1/health      # {"status":"ok"} — public, no login needed
curl -s https://your-domain/api/v1/lectures    # {"type":"about:blank","title":"Unauthorized",...} — correct, you're not logged in
```

Then open the domain in a browser: the landing page loads with no login,
and anything under `/lecture/*`, `/course/*`, `/drill`, `/review`,
`/upload` redirects to `/login` until you sign in with the credentials you
just set.

## Load the fixtures (optional)

The four MIT 18.06 fixtures aren't baked into the image (video files,
gitignored — see `.gitignore`). To seed them on the VPS:

```bash
docker compose -f docker-compose.prod.yml cp lectures/l01.mp4 gateway:/app/lectures/l01.mp4
# repeat for l02-l04, then:
docker compose -f docker-compose.prod.yml exec gateway \
  python scripts/ingest.py --file lectures/l01.mp4 --lecture-id l01 --sequence 1 --title "The Geometry of Linear Equations"
# repeat per lecture, then:
docker compose -f docker-compose.prod.yml exec gateway python scripts/build_graph.py --course-id 18.06
docker compose -f docker-compose.prod.yml exec gateway python scripts/generate_questions.py --course-id 18.06
```

Or just use the real `/upload` page once logged in — that's the actual
point of Stage 12, and it's the same pipeline either way.

## Telegram bot

Runs continuously as its own container now (`telegram-bot` service) — no
laptop needs to stay on. `TELEGRAM_BOT_TOKEN` in `.env` is all it needs;
it authenticates to the gateway with `SERVICE_API_KEY`, not a browser
login.

## MCP in Claude Desktop, against the deployed instance

`scripts/mcp_server.py` still runs locally (it's a stdio subprocess your
own Claude Desktop spawns — that part doesn't move to the VPS), but point
it at the real deployment instead of localhost:

```json
{
  "mcpServers": {
    "course-factory": {
      "command": "python",
      "args": ["/path/to/CourseFactory/scripts/mcp_server.py"],
      "env": {
        "GATEWAY_URL": "https://your-domain",
        "SERVICE_API_KEY": "<the same value that's in the VPS's .env>"
      }
    }
  }
}
```

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Postgres data, uploaded videos, and Caddy's TLS certs all live in named
volumes (`pgdata`, `lectures_data`, `media_data`, `caddy_data`,
`caddy_config`) — a rebuild doesn't touch any of them.

## Backups

Same approach as local dev's `db/backups/README.md`, pointed at the
container instead of a host-installed `psql`:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U coursefactory -d coursefactory --no-owner --no-privileges \
  > backup_$(date +%Y%m%d_%H%M%S).sql
```

Read `db/backups/README.md` before ever restoring one — there's a real,
non-obvious gap where Apache AGE's graph doesn't survive a plain restore,
with the actual recovery step documented there.

## What's still out of scope

- **Still no self-service registration or course enrollment.** Stage 15
  added real, separate per-student accounts (`students.username`/
  `password_hash`, a `role` claim in the JWT — see `gateway/app/auth.py`),
  but they're admin-provisioned only, created by extending the waitlist's
  "Create account" flow (`gateway/app/routes/waitlist.py`) — `/signup`
  still only ever joins the waitlist. Still one shared course for every
  student, still exactly two roles (instructor / student), not a rebuild
  into multi-tenant SaaS with per-student course ownership.
- **No horizontal scaling, no CDN, no managed database.** This is a
  single-VPS deployment for a real but small-scale tool, not
  infrastructure sized for many concurrent users.
- **RocketRide** isn't part of this stack at all — nothing in the working
  pipeline depends on it being reachable (see `CLAUDE.md`'s own Verified
  section); it was never containerized because nothing actually calls it.
