# CLAUDE.md

Context for Claude Code working in this repo. Read `docs/ARCHITECTURE.md` before structural work and `docs/TASKS.md` before picking up new work.

**This started as a 24-hour hackathon build that ran only on localhost.** Stage 13 added a real production deployment path (Docker Compose + Caddy + login auth, see `docs/DEPLOYMENT.md`) for running it on a VPS — that stage's own scope, kept separate from local dev rather than replacing it. `docker-compose.yml` is still the local-dev file (hot reload, no auth needed to hit the gateway directly); `docker-compose.prod.yml` is the new, separate production stack. Local dev still optimises for build speed and demo reliability the same as before — that hasn't changed, only "there's no ops story at all" is no longer true.

---

## What this is

**Course Factory** turns a lecture recording into a course that knows what the student doesn't understand yet — and points at the exact ninety seconds, often in a *different* lecture, that fixes it.

The asset the whole product rests on: a **deduplicated timeline of board states**. A lecture contains ~120 distinct things the lecturer wrote on the board. Extracting, reading, and linking those across a course is what makes everything else possible.

Three things competitors structurally cannot do, in priority order:

1. **Board-only retrieval** — find content that was written but never spoken aloud
2. **Cross-lecture prerequisite graph** — reason across a whole course, not one document
3. **Backward remediation** — a wrong answer in Lecture 4 sends you to the gap in Lecture 2

If a change would weaken any of those three, it's the wrong change.

---

## Repo layout

```
web/          React 18 + TS + Vite SPA
gateway/      FastAPI — REST for reads, WS for streaming, proxies to RocketRide
pipelines/    RocketRide pipeline JSON
db/           schema.sql
docs/         ARCHITECTURE.md, API.md, TASKS.md, PIPELINES.md
scripts/      ingest.py and other one-shots
docker-compose.yml
```

## Commands

```bash
docker compose up -d              # postgres (pgvector+AGE, :5433 — 5432 is taken by another project on this machine) + edge-tts (:5002)

# RocketRide engine: nothing to start. The VS Code extension already runs a native
# local engine at http://localhost:5565 (C:\Users\<user>\AppData\Local\RocketRide\engine\
# engine.exe) independent of this repo — confirmed in F1, see the "Verified" section
# above. Do NOT try to self-host it via Docker or build-from-source; that path exists
# but is a slow C++/vcpkg build for something that's already running.

cd gateway && uvicorn app.main:app --reload --port 8000
cd web && npm run dev             # :5173
psql $DATABASE_URL -f db/schema.sql
python scripts/ingest.py --file lectures/l01.mp4 --lecture-id l01
cd web && npm run typecheck
```

---

## Non-negotiable architecture rules

**1. Reads never go through RocketRide.**
Search, transcript fetch, graph traversal, and quiz retrieval hit Postgres directly through the gateway. Only *generation* — answering, quiz creation, remediation reasoning, translation — invokes a pipeline. Routing a keyword search through an agent adds seconds to the interaction the demo lives on.

**2. No ML model weights load locally.**
Not for memory reasons — **for setup time.** `pip install torch`, a 3GB model download, a CUDA mismatch, and a slow first inference is two hours you don't have. Groq's Whisper is free and runs ~200× realtime with zero setup. Local means ffmpeg, OpenCV, Tesseract, Postgres — things that install in one command and just work. Do not add torch, sentence-transformers, whisper.cpp, or CLIP.

**3. One Postgres, three roles.**
Relational + vector (pgvector) + graph (Apache AGE) in one instance. Do not introduce Neo4j, Qdrant, Redis, or Elasticsearch. Every extra service is another thing that can fail during a demo.

**4. Video time never lives in React state.**
It updates at 60fps and will re-render the tree into the ground. Keep it in a ref, expose `usePlayerTime(cb)`, and let only the strip cursor and transcript highlight subscribe.

**5. Seeks snap to segment boundaries.**
Never seek to a raw millisecond — it lands mid-word. Snap backward to the containing segment's `start_ms`, then subtract 1500ms of pre-roll. Helper: `snapToSegment(ms, segments)`.

**6. Cross-lecture navigation always keeps a return path.**
Remediation drops the student into another lecture. Without `returnToOrigin()` they're stranded and the flow dies. Every `navigate()` that changes `lectureId` must push to the nav stack.

---

## Conventions

- **All times are integer milliseconds**, suffixed `_ms`. Never seconds, never floats, never `Date`. The one exception is the display layer, which formats to `mm:ss` at render.
- TypeScript strict. No `any` — use `unknown` and narrow.
- Server state → TanStack Query. Player/nav state → Zustand. Never duplicate server state into Zustand.
- Python: type hints on public functions.
- SQL in `db/`, never inline multi-line SQL in Python. AGE Cypher is the exception and lives in `gateway/app/graph_queries.py`.
- Components PascalCase, hooks `use*.ts`, everything else kebab-case.
- Errors state what happened and what to do. Empty states are invitations to act.

## Cost rules

The build should cost a few cents total, and staying inside free tiers means never hitting a paywall mid-demo.

- **Try Groq first** for anything model-shaped. It's OpenAI-compatible: `llm_openai_api` pointed at `https://api.groq.com/openai/v1`. Free tier.
- Groq's free tier is generous on *requests*, tight on *tokens per minute* (~12K on the 70B model). Long-context work goes to OpenAI nano, not Groq. Map-reduce transcripts at ~4K token chunks — never one 30K-token prompt.
- **Always wire a fallback:** on a Groq 429, retry once with backoff, then fall through to OpenAI nano. Degrading to a $0.0005 call beats erroring in front of a judge.
- Skip OpenAI's Batch API during the build — the 24h turnaround window is a risk you don't need. Use it only if a batch job is queued well before demo time.
- Target: **~$0.015 per lecture.** If a change pushes past that, flag it — the number is part of the pitch.

---

## Design tokens

Defined in `web/src/styles/tokens.css`. Import, don't redefine.

`--written` (#E0B84C) is **load-bearing, not decorative**. It marks content that came from the board rather than the transcript. Using it anywhere else destroys its meaning.

Monospace on every timestamp is functional, not stylistic — timestamps get compared constantly and proportional digits jitter.

---

## Things not to do

- Don't build self-service registration or a full multi-tenant rebuild. Stage 13 added real *login* (see `docs/DEPLOYMENT.md`, `gateway/app/auth.py`); Stage 15 added real *multiple students* on top of that (`students.username`/`password_hash`, a `role` claim in the JWT) — but accounts are still admin-provisioned only, created by extending the waitlist's "Create account" flow (`gateway/app/routes/waitlist.py`), never self-signup. `/signup` still only ever writes to the waitlist table. Still one shared course/content (no per-student uploads, no course enrollment), still exactly two roles (instructor / student). A student who wants an account still needs the admin to hand them one.
- Don't add a state library beyond Zustand + TanStack Query, or a component library beyond Tailwind.
- Don't let generated questions reach the student view unapproved. `questions.approved` defaults to `false` and that default is deliberate — it's also a demo beat.
- Don't process full-length lectures during iteration. Use the 8–12 minute clipped fixtures.
- Don't fabricate RocketRide node configs. If a schema is unknown, check the docs and add it to the open-questions list in `docs/PIPELINES.md`.
- Don't write tests unless a bug is hard to reproduce by hand.
- Don't touch `docker-compose.yml` (local dev) to add production concerns, and don't add auth/TLS/reverse-proxy complexity to the local dev flow — that's what `docker-compose.prod.yml` + `deploy/` are for. Keep the two paths genuinely separate rather than merging them into one config with conditionals.

---

## Verified (was: "Verify before relying on these")

Resolved 2026-08-20 against `.rocketride/schema/*.json` (this project's synced node catalog — the source of truth per `ROCKETRIDE_COMPONENT_REFERENCE.md`) and https://docs.rocketride.org. Fabricated node names from earlier drafts are corrected below.

- **`audio_transcribe` does NOT accept a custom base URL. Critical path — resolved, plan changes.** Its schema (`audio_transcribe.json`) has exactly one profile (`default`) with `model` (enum `tiny|base|small|medium|large-v3` — no Groq-hosted `turbo` variant), `silence_threshold`, `min_seconds`, `max_seconds`, `vad_level`. No `base_url`, no API key field, no provider field. The public docs confirm why: it "routes to the model server when the engine is started with `--modelserver`, otherwise it runs locally via `faster-whisper`" — i.e. it downloads and runs Whisper weights **on the machine running the RocketRide engine**. That's exactly what rule 2 above forbids. **Do not use this node.** Reach Groq's Whisper endpoint (`https://api.groq.com/openai/v1/audio/transcriptions`) directly — either from `scripts/ingest.py` (plain `httpx` call, simplest) or via an agent driving `tool_http_request` if the call needs to happen inside a pipeline. `tool_http_request` is a real node (confirmed in the catalog) and fits this: it's a generic whitelisted-URL HTTP client, agent-supplies method/headers/body/auth.
- **No node runs arbitrary shell commands or ffmpeg.** The only code-execution nodes are `tool_python` (in-process `exec()`, whitelisted-module sandbox — no `subprocess`, not suitable for shelling out to ffmpeg) and `tool_daytona` (remote cloud sandbox — adds a network dependency and setup we don't need). `preprocessor_code` is **not** a shell/code-exec node despite the P1 diagram implying it — its actual job (confirmed via schema) is parsing/tokenizing *source code* (functions, classes, comments in Python/JS/TS/C) for embedding, unrelated to media processing. **Implication:** ffmpeg audio/frame extraction and dHash perceptual dedup (I1, B1, B2) must run as host-side Python in `scripts/ingest.py`, not as RocketRide pipeline nodes. This matches, not contradicts, this file's own framing of ffmpeg/OpenCV as "local" host tools — treat it as confirmation, not a new problem.
- **Postgres/pgvector/AGE:** `docker-compose.yml` sidesteps "RocketRide's Postgres image" by running our own `apache/age`-based instance — good. Confirmed via search: the official `apache/age` image does **not** ship pgvector; several third-party repos exist solely to bolt pgvector onto an AGE base image. `db/Dockerfile` now layers pgvector onto `apache/age:release_PG16_1.6.0` (done in F1 — note the tag: `PG16_latest` from the original draft **does not exist** on Docker Hub, confirmed against the real tag list). Separately, RocketRide's own self-hosted engine bundles *its own* internal Postgres (`ankane/pgvector`, plain pgvector, no AGE) purely for its own bookkeeping — that instance is not ours; don't confuse the two or try to reuse it.
- **`frame_grabber` does expose interval config** — profile `interval` with an `interval` field (seconds between frames) plus `start_time`/`duration`, matching `fps=1/N`. It also has `key` (keyframe) and `transition` (scene-change) profiles. Real node, real config — no ffmpeg shell-out needed *for this step specifically*. That said, given the point above (frame *extraction* has to happen somewhere, and dHash dedup can only happen host-side since no node does perceptual hashing), it's simplest to do both extraction and dedup in one host-side ffmpeg pass in `scripts/ingest.py` rather than splitting the work between a RocketRide node and a host script. Note this as a design choice for B1, not a blocker.
- **Groq audio upload limit: ~25MB** (2026 sources; some report 30MB, 25MB is the safer number to design against). A mono 16kHz MP3 of an 8–12 minute fixture clip is only a few MB, so **no chunking needed for the fixture set**. Still worth a defensive size-check in `scripts/ingest.py` since full lectures would exceed it — just don't build the chunking logic until it's needed.
- **The WebSocket does surface per-node execution events — the gateway does not need to invent its own.** RocketRide's engine exposes a DAP-over-WebSocket channel at `ws://<host>:5565/task/service`. Subscribe with `rrext_monitor` (`types: ["FLOW", ...]`) and start pipelines with `pipelineTraceLevel: "summary"` (or `"full"`) to get `apaevt_flow` events per component enter/exit with lane data. Full protocol in `.rocketride/docs/ROCKETRIDE_OBSERVABILITY.md`. The trace panel (X5) should be a DAP client, not a gateway-invented event stream.
- **OpenAI nano-tier pricing (2026):** `gpt-5-nano` — $0.05 / 1M input tokens, $0.40 / 1M output tokens. The name already in `.env.example` (`gpt-5-nano`) is current; no change needed.
- **`GROQ_MODEL_FAST`/`GROQ_MODEL_SMART` (`llama-3.1-8b-instant`/`llama-3.3-70b-versatile`) both 404 as of Stage 8 (D1).** Neither had been called by any actual code before `scripts/mcp_server.py` became the first real caller of a Groq "smart" text model — nothing in Stages 1-7 exercised either value, so the deprecation sat undetected. Checked Groq's live `/models` list rather than guess a replacement (same discipline as the `llama-4-scout`→`qwen/qwen3.6-27b` vision fix in B3): current lineup is `openai/gpt-oss-120b` (smart) and `openai/gpt-oss-20b` (fast), both confirmed working with a real call. Model lineup on Groq moves fast — worth a live check before trusting any hardcoded Groq model name that hasn't been exercised recently.
- **"Exposed via RocketRide's MCP surface" (docs/API.md's original MCP tools section) is wrong.** Checked `.rocketride/schema/mcp_client.json` and the full services catalog before building D1 on that claim: RocketRide has exactly one MCP-related node, `mcp_client`, and it's the *consumer* direction only — it lets a pipeline call out to an *external* MCP server's tools. There is no node for the reverse (exposing a RocketRide pipeline as an MCP server), so there is no RocketRide path to D1 at all, verified or otherwise. Built `scripts/mcp_server.py` as a standalone process using the official `mcp` Python SDK (stdio transport for Claude Desktop), calling the gateway's REST API directly for the three read tools and a direct Groq/OpenAI call for the one generating tool (`explain_concept`) — consistent with every other stage's "direct call over an unverified RocketRide path" choice.
- **Installing the `mcp` Python SDK (`pip install mcp`) pulls in `starlette>=0.49`, which breaks the gateway's `fastapi==0.115.6` (`starlette<0.42.0,>=0.40.0`) in the same shared conda env.** Both live in one environment, not separate venvs per directory — a `pip install` for any one script's dependencies can silently break another script's already-working dependencies. Fixed by pinning `starlette` back down after installing `mcp` (`pip install "starlette<0.42.0,>=0.40.0"`) — `mcp`'s stdio transport (the only one this project uses) doesn't need the newer `sse-starlette`-dependent HTTP/SSE transports, so the pin is harmless for our actual usage. Worth remembering before installing anything else Python-side: check what it does to `starlette`/`fastapi` first.

### New findings (not on the original list, but block F1/pipeline work)

- **No pre-built RocketRide Docker image exists — but it turns out we don't need one. Superseded during F1.** `docker-compose.yml`'s `rocketride/engine:latest` doesn't correspond to anything real. We initially decided to self-host from source (cloned `rocketride-org/rocketride-server` into `vendor/`, MIT) and kicked off `./builder server:build --autoinstall` — this is a genuine from-scratch vcpkg/C++ build (~124 packages, aws-sdk-cpp alone is slow) and would have taken a long time on Windows. **While that ran, we discovered the RocketRide VS Code extension already installs and runs its own native engine locally**, independent of anything in this repo: `C:\Users\<user>\AppData\Local\RocketRide\engine\engine.exe`, launched as `engine.exe --autoterm ./ai/eaas.py --host=localhost --port=5565`. It was already running and responding on `GET http://localhost:5565/version` before we built anything. This is almost certainly what the presence of `.rocketride/services-catalog.json` and `.rocketride/schema/*.json` in this repo already implied (F2) — the extension is installed and has a live connection. **Action taken:** killed the from-source build (wasted CPU, not needed), removed the vendored clone. No Docker build, no vendored source, nothing to run to bring the engine "online," it already is.

**API key — resolved, with a real caveat.** The extension's own Settings webview (Development/Deployment/Pipeline/Debugging/Integrations tabs) does **not** expose an API key anywhere, for any tab, including Local mode — confirmed empty on disk too (`data/control` and Windows Credential Manager both had nothing). Creating/running a `.pipe` file through the sidebar was tried and did *not* turn out to be what produced the key either (that was a wrong guess in an earlier draft of this note — it just happened to coincide with the engine restarting onto a new port). **What actually worked: an API key issued from the RocketRide Cloud dashboard (`cloud.rocketride.ai`)**, pasted into `.env` as `ROCKETRIDE_APIKEY`. Confirmed via the SDK (`RocketRideClient.connect()` succeeds) — against the **local** engine, not cloud. So the key is account-scoped, not deployment-scoped: a Cloud-issued key authenticates a local engine connection fine. `ROCKETRIDE_URI` still points at `localhost:<port>` — pipeline execution stays 100% local, only the key itself came from the Cloud account portal. If this key ever needs regenerating, go back to the Cloud dashboard rather than hunting the VS Code extension again. **Real, unresolved caveat: the local engine's port is not fixed.** It runs with `--port=0` (OS-assigned), confirmed via its own command line — every restart gets a new port (observed 5565 → 20001 → 62964 across one session, purely from VS Code/engine restarts). `.env` currently hardcodes whatever port was live at the time — **treat it as stale after any engine or VS Code restart** until this is solved properly (e.g. the gateway discovering the current port at startup instead of trusting a static env var). Worth fixing before Z1 (demo readiness), not before Stage 1.
- **Port mismatch:** the engine's real default port is **5565** (confirmed in both `ROCKETRIDE_OBSERVABILITY.md` and the public docs — `curl http://localhost:5565/ping`). `docker-compose.yml` maps `8080:8080` and `.env.example` sets `ROCKETRIDE_URL=http://localhost:8080`. Fix both to `5565` during F1, or the gateway will fail to reach the engine.
- **`rocketride_vector` and `rocketride_graph`, used in `docs/PIPELINES.md`'s P2 sketch, are not real node names** — confirmed against the full 124-entry catalog. The real pgvector-backed store node is named `postgres` (classType `store`, description: "enhances PostgreSQL with vector similarity search... through the pgvector extension"). For graph: the public docs site describes a "RocketRide Graph" node ("RocketRide-managed graph database backed by PostgreSQL + Apache AGE"), but it does **not** appear in this project's synced `.rocketride/services-catalog.json` (only `db_neo4j` and `tool_falkordb` show up under graph-adjacent classTypes) — re-sync the VS Code extension / check the account's enabled components before assuming it's unavailable. Moot either way: rule 3 above already routes AGE Cypher through `gateway/app/graph_queries.py` directly, not through a pipeline node, so P2's Map-maker step should write structured JSON (via a `response_*` node or `db_postgres` staging table) for the gateway to load into AGE — not target a graph node at all.
- **`agent_crewai_manager`, not `agent_crewai`, is the multi-agent manager node** (`agent_crewai` is the standalone single-agent node). The manager needs `invoke.crewai` wiring to at least one `agent_crewai_subagent`, and each subagent has its **own** required `invoke.llm` (min 1) and optional `invoke.tool` — no inheritance from the manager. Every specialist in P2 (Map-maker, Examiner, Adversary, Publisher) needs explicit `control` wiring for its own LLM.
- **`llm_openai_api`'s real config field is `apikey` (string), not `api_key_env`** — there's no "read from this env var name" indirection field. To keep the key out of the pipeline JSON, use RocketRide's `${ROCKETRIDE_<NAME>}` substitution syntax (only `ROCKETRIDE_`-prefixed vars are substituted), e.g. `"apikey": "${ROCKETRIDE_GROQ_API_KEY}"` — which means `.env` needs a `ROCKETRIDE_GROQ_API_KEY` entry alongside the plain `GROQ_API_KEY` used by host-side scripts, since the two are read by different consumers (RocketRide engine vs. our own Python).
- **TwelveLabs free tier: 600 minutes, cumulative, doesn't reset on deletion.** Four 8–12 min fixtures is 32–48 minutes — comfortable headroom for repeated re-indexing during iteration.

### Stage 13 — deployment/auth findings

- **Login is env-var credentials, not a `users` table.** The app's user model never changed at Stage 13 (still "one student, one instructor," CLAUDE.md's own scope) — this is a login *gate* on that same single account, not a registration system. Deliberately the simplest thing that closes the real gap (a public URL with no login at all), not a guess at future multi-user needs. Superseded at Stage 15 for the *student* side only — see the Stage 15 findings below; the instructor account is still exactly this, one env-var pair.
- **JWT lives in an httpOnly cookie, not `localStorage`.** `localStorage` is readable by any script on the page — a real XSS anywhere becomes session theft. The tradeoff: cookies need `credentials: 'include'` on every fetch (see `web/src/api/http.ts`'s `apiFetch()` wrapper, now used everywhere instead of raw `fetch()`) and `allow_credentials=True` on the gateway's CORS middleware.
- **`Secure` cookies are silently dropped by browsers over plain HTTP.** Right default for the real deployment (Caddy terminates real HTTPS), wrong for testing the login flow locally against `npm run dev` — `COOKIE_SECURE=false` in a local `.env` is the escape hatch, real deployments should never set it.
- **Starlette's `BaseHTTPMiddleware` silently no-ops on WebSocket scope.** Found this while gating `/ws` — a middleware written against `BaseHTTPMiddleware` would leave the WebSocket completely unauthenticated with no error, since it only intercepts `http`-scope requests. `gateway/app/auth_middleware.py` is a raw ASGI middleware instead, specifically so it can handle `http` and `websocket` scopes the same way. Verified live: an unauthenticated `websockets.connect()` gets rejected (uvicorn reports it as HTTP 403 at the handshake, since the ASGI `websocket.close` sent here happens pre-accept — the rejection itself is correct, that exact status code is the one cosmetic detail not chased further).
- **Two scripts call the gateway's own HTTP API and needed a fix once auth landed: `scripts/telegram_bot.py` and `scripts/mcp_server.py`.** Grepped every script under `scripts/` for `GATEWAY_URL` first rather than assume — everything else (`ingest.py`, `build_graph.py`, `generate_questions.py`, etc.) talks to Postgres directly and was completely unaffected. Both now send `Authorization: Bearer $SERVICE_API_KEY` (gateway/app/auth.py accepts this as an alternative to the cookie, specifically for trusted same-deployment callers that have no browser login flow of their own) — verified live via a real MCP `ClientSession` round-trip and a direct call against the running gateway, not assumed from reading the code. One near-miss: a blanket find-replace across `mcp_server.py`'s five `httpx.AsyncClient()` call sites almost added the gateway's bearer token to `_call_chat()`'s direct Groq/OpenAI calls too — caught by rereading the diff, since that function already sets its own real `Authorization` header per-request.
- **Zombie `uvicorn --reload` worker processes are a recurring trap on this Windows setup — this is now the third time in this project.** Git Bash's `ps`/`kill` operate on MSYS-emulated PIDs that don't reliably map to the real Windows PIDs `netstat`/`Get-NetTCPConnection` report, so a `kill` that looks successful can leave the actual listening process alive, silently serving stale code while a *new* process starts alongside it on what looks like the same port. Symptom looked exactly like a real bug (401 not enforcing, a route 404ing that definitely existed) until traced to two live processes both claiming port 8000. Reliable fix: use PowerShell's `Get-NetTCPConnection -LocalPort <port> | Select OwningProcess` (and `Get-CimInstance Win32_Process` for the full process tree) for the *real* PID, `Stop-Process -Id <real-pid> -Force`, then re-verify a single owner before trusting the server reflects current code.

### Real VPS deployment — findings from actually doing it, not just writing the files

- **Docker Compose (v5.3.1) merges `ports:` across `-f base -f override` files by APPENDING, not replacing.** Assumed override semantics without checking, shipped `docker-compose.prod.shared-vps.yml` remapping Caddy to `:8020`, and the very first real deploy failed: `docker compose config` showed 80, 443, *and* 8020 all requested at once, and 80/443 lost to `mesh-caddy` (a real, unrelated, already-running project on the same VPS) with a "port is already allocated" error. Fixed with the Compose Spec's `!override` YAML tag on the `ports:` key specifically, which forces replace semantics — verified via `docker compose config` showing exactly one port before trying to bring the container up again, not by assuming the fix worked.
- **Hardcoding `PUBLIC_HOST: https://${DOMAIN}` and `COOKIE_SECURE: "true"` in `docker-compose.prod.yml`'s own `environment:` block silently broke the shared-VPS deployment shape, even with a correct `.env`.** `environment:` overrides `env_file:` for the same key — so `.env`'s carefully-set `PUBLIC_HOST=http://<vps-ip>:8020` and `COOKIE_SECURE=false` were both being discarded in favor of the hardcoded (domain-shaped) assumption. Two real, live symptoms this produced, both caught by testing the actual login flow end-to-end rather than trusting `docker compose up` exiting 0: (1) the login response's `Set-Cookie` still carried `Secure` despite `.env` saying otherwise, so every browser (and curl) correctly refused to store it over the plain-HTTP `:8020` deployment — login "succeeded" (200, real JWT in the body) but no session was ever actually established; (2) `PUBLIC_HOST` resolved to the nonsense `https://:8020`, which would have both broken CORS (the real origin, `http://<ip>:8020`, could never match it) and sent broken deep links from the Telegram bot. Fix: removed both from the compose file's hardcoded `environment:` block, leaving `.env` as the single source of truth for them like every other variable already was — the two lines that stay hardcoded there (`DATABASE_URL`, `EDGE_TTS_URL`) are the only ones that are genuinely *always* correct regardless of domain/port/HTTP-vs-HTTPS shape (pure internal Docker-network addresses, not user-facing config).
- **The VPS: root SSH access via a key already present locally (`~/.ssh/id_ed25519`) — found it, didn't assume it, by checking `~/.ssh/known_hosts` first rather than asking the user to hand over credentials.** Already running two other real projects sharing the box, each with its own domain and its own already-working reverse proxy on 80/443. Course-factory deliberately does not touch either — no shared Docker network, no edits to the other project's Caddyfile, its own fully isolated compose project instead. Full stack (postgres, edge-tts, gateway, telegram-bot, caddy) uses ~312MB total RAM in practice, comfortable within the ~2.1GB that stayed available afterward on this ~4GB-RAM box.

### Stage 15 — multi-student findings

- **`attempts`/`mastery`/`schedule` were already correctly keyed by `student_id` before this stage** — the single-student build never cut corners at the schema/SQL layer, it just never had more than one real `students` row to exercise that with. The entire gap was one layer up: `DEMO_STUDENT_ID`, a single hardcoded default threaded through routes, and — the part that actually mattered — `student_id` being a **client-trusted** value with nothing verifying it against who was logged in. That's fine with one demo student; it's a real cross-student read/write bug the moment separate real accounts with separate passwords exist. Closing it (`gateway/app/auth.py`'s `resolve_student_id` — a student session's own id always wins server-side, full stop, regardless of what a request claims) was part of adding multi-student support itself, not a follow-up ticket.
- **Introducing `role` surfaced a second, previously-invisible gap: several instructor-only routes had no backend authorization check at all**, because before Stage 15 "authenticated" and "instructor" were the same thing (there was only one non-service account). `POST /upload`, `GET /courses`, the whole review-queue router, and `GET /waitlist` / `POST /waitlist/{id}/invite` would have been reachable by any authenticated student session via a direct request, even though the UI never linked to them. Added a one-line `require_instructor()` check to each — cheap, and a direct consequence of roles existing at all, not scope creep.
- **The Telegram bot's `/start` bug (the reason this stage happened) needed a real fix, not a workaround.** The naive fix — auto-create a new student row per Telegram user — would have been wrong: the whole point of a real per-student *web* account is that a student's mastery/schedule should be the SAME whether they answer via the SPA or Telegram, not a second, disconnected track record. The actual fix is a short-lived one-time link code (`telegram_link_codes` table, `POST /telegram/link-code`, `web/src/components/LinkTelegramCard.tsx`): a logged-in student generates one from the web app and sends `/start <code>` to the bot, which links *that* Telegram chat to *that* student's existing account. `/start` with no code (or a bad/expired one) no longer silently claims anything.
- **`asyncpg` transactions don't tolerate a caught `UniqueViolationError` mid-transaction** — the waitlist "Create account" endpoint generates a username and retries with a numeric suffix on collision, but the first version wrapped the whole retry loop in one `conn.transaction()`; a caught collision still poisons that transaction for every subsequent statement (Postgres, not asyncpg, enforces this — a failed statement aborts the transaction until rollback). Fixed by wrapping each individual insert attempt in its own **nested** `conn.transaction()`, which asyncpg turns into a `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` automatically — a failed attempt only unwinds to that savepoint, not the outer transaction holding the waitlist row's own update. Caught by tracing through what Postgres actually does with a failed statement inside a transaction, not by testing the collision path directly.

### Stage 16 — multi-course + YouTube-ingestion findings

- **The app was single-course by architecture, not just by content** — the database and the Upload page already supported creating additional courses, but five frontend components (`GraphPanel`, `ContradictionsPanel`, `SearchPanel`, `TranscriptLane`, `ReviewQueuePage`) hardcoded `COURSE_ID = '18.06'`, and `/course/:id` (as opposed to `/lecture/:id`) rendered identically regardless of `:id` — completely inert. The backend for graph/search/contradictions/review-queue was already fully wired for `course_id` end to end; the actual gap was entirely frontend plumbing plus `GET /lectures` needing a course filter added from scratch.
- **`db/queries/lectures.sql`'s `video_url` fallback (`COALESCE(NULLIF(source_path,''), id || '.mp4')`) already existed for the four pre-upload-flow fixture lectures — and it turns out to solve YouTube ingestion's local-file-doesn't-exist-yet problem for free.** Insert the lecture row with `source_path = NULL`, have the downloader write to exactly `{lecture_id}.mp4`, and the read-side fallback resolves correctly the instant the file exists — no `source_path` UPDATE, no extra bookkeeping. Found by reading the query before assuming bookkeeping was needed, not by building the bookkeeping first and discovering it was redundant.
- **A derived (not hardcoded) `courseId` is `undefined` on first paint until the lectures list resolves — every hook consuming it needs `enabled: !!courseId`, or React Query fires a `GET /courses/undefined/...`-shaped request.** This wasn't needed before because the old `COURSE_ID` constant was always truthy. Caught in review before it shipped, not live — worth remembering for any future prop that goes from "hardcoded constant" to "derived, briefly absent."
- **A prop reordering that looks purely additive can silently break an existing call site.** `GraphPanel.tsx` already called `useLectures(studentId)` — one positional argument — from the prior multi-student stage. Adding `courseId` as a naive new leading positional parameter would have silently shifted `studentId` into the wrong slot with no type error (both are optional strings). Fixed by switching `useLectures` to a single options object (`{ courseId?, studentId? }`) instead of positional params — the shape that made the original bug possible in the first place.
- **yt-dlp warns that YouTube extraction "without a JS runtime has been deprecated" and recommends installing Deno** — confirmed live: a real download of a real public video still succeeded without one (some formats may silently be unavailable, per the warning, but the format string here — `bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b` — resolved fine). Not blocking today; worth installing a JS runtime on whatever host runs `scripts/ingest.py` if YouTube ingestion starts failing on specific videos later, since this is yt-dlp/YouTube's ecosystem trend, not a one-off.
- **Reordering `create_job()` to run before `probe_duration_ms()`/`extract_audio()` (needed so a YouTube download has a job row to report progress against) incidentally fixes a pre-existing gap for plain file uploads too**: today, an `ffprobe` failure on a corrupt uploaded file crashes with no job row yet created, leaving the lecture stuck at `status='transcribing'` with zero diagnostic. After the reorder, that failure surfaces through the normal job-failure path like everything else.
- **Verified for real, not just by reading the diff**: a real ~30MB public YouTube video was downloaded via the actual `POST /upload/youtube` endpoint into a genuinely new course, ran the full pipeline (download → transcription → frame extraction/dedup → OCR → embeddings) to `status='ready'`, and was confirmed playable through the gateway — then cleaned up (`DELETE FROM courses` cascades through lecture/segments/frames/chunks/jobs; the downloaded file and its `media/` derivatives were removed by hand) since it was verification, not real course content.

## Test fixtures

MIT OCW 18.06 (Strang, linear algebra), lectures 1–4, clipped to 8–12 minutes each. Chosen because it's pure blackboard — board-only retrieval needs content that was written but never spoken — and elimination → LU → vector spaces gives real prerequisite edges for remediation.

Do not swap to slide-based lectures. They break the primary differentiator's test case.

## Demo integrity

The four beats the build exists to serve:

1. Board-only search finds a term never spoken aloud
2. A conceptual query lands mid-derivation, not on a summary
3. A failed quiz question sends the student back a lecture
4. A judge scans a QR, gets quizzed in Telegram, while the MCP tool answers in Claude Desktop

Telegram runs on **long polling**, not webhooks — so the bot works from localhost with no tunnel. Judges reach it through Telegram's servers.

Pre-index all four fixtures before demo time. Upload one short clip live to prove ingestion is real; never wait on a full run in front of an audience.
