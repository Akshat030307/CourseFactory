# CLAUDE.md

Context for Claude Code working in this repo. Read `docs/ARCHITECTURE.md` before structural work and `docs/TASKS.md` before picking up new work.

**This is a 24-hour hackathon build. It runs locally. There is no deployment, no production environment, and no ops story.** Optimise for build speed and demo reliability.

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

- Don't build auth, user accounts, or multi-tenancy. One hardcoded student, one instructor.
- Don't add a state library beyond Zustand + TanStack Query, or a component library beyond Tailwind.
- Don't let generated questions reach the student view unapproved. `questions.approved` defaults to `false` and that default is deliberate — it's also a demo beat.
- Don't process full-length lectures during iteration. Use the 8–12 minute clipped fixtures.
- Don't fabricate RocketRide node configs. If a schema is unknown, check the docs and add it to the open-questions list in `docs/PIPELINES.md`.
- Don't write tests unless a bug is hard to reproduce by hand.
- Don't build deployment, CI, Dockerfiles for production, or a reverse proxy. It runs on localhost.

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
