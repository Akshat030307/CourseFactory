# Course Factory

Upload a lecture. Get a course that knows what you don't understand yet — and
points at the exact ninety seconds, often in a *different* lecture, that fixes it.

Built on RocketRide. Started as a 24-hour hackathon build; runs locally for
development, costs roughly **1.5 cents per lecture**. Real login-gated VPS
deployment now exists too — see `docs/DEPLOYMENT.md`.

## What makes it different

1. **Reads the board.** Finds content that was written but never spoken aloud.
2. **Reasons across lectures.** A prerequisite graph spanning a whole course.
3. **Diagnoses, not repeats.** Fail a Lecture 4 question, get sent to the gap
   in Lecture 2.

## Quickstart

```bash
cp .env.example .env          # fill in GROQ_API_KEY and OPENAI_API_KEY
docker compose up -d          # postgres (pgvector + AGE) + edge-tts
# RocketRide runs natively via its VS Code extension — not dockerized, see CLAUDE.md
psql $DATABASE_URL -f db/schema.sql

cd gateway && uvicorn app.main:app --reload --port 8000
cd web && npm install && npm run dev     # :5173
```

Fixtures: MIT OCW 18.06 (Strang), lectures 1–4, clipped to 8–12 minutes.
Pure blackboard, which the board-only retrieval test case depends on.

```bash
python scripts/ingest.py --file lectures/l01.mp4 --lecture-id l01
```

## Docs

| File | What's in it |
|---|---|
| `CLAUDE.md` | Context for Claude Code. Architecture rules, conventions, don'ts |
| `docs/TASKS.md` | Sequenced build order with acceptance criteria — **start here** |
| `docs/ARCHITECTURE.md` | System shape, ingestion, graph model |
| `docs/API.md` | Gateway REST + WebSocket contract |
| `docs/PIPELINES.md` | RocketRide wiring and unresolved questions |
| `docs/DEPLOYMENT.md` | Running this for real on a VPS |
| `db/schema.sql` | Postgres + pgvector + Apache AGE |

Ticket **F2** resolves the RocketRide unknowns, and one of them sits on the
critical path. Do it before writing pipeline code.

## The four demo beats

1. Board-only search finds a term that was never spoken aloud
2. A conceptual query lands mid-derivation, not on a summary
3. A failed quiz question sends the student back a lecture
4. A judge scans a QR and gets quizzed in Telegram, while the MCP tool
   answers the same corpus inside Claude Desktop

Telegram runs on long polling, so the bot works from localhost with no tunnel.

## Cost

Per lecture: transcription free (Groq), frames and OCR free (local CPU), vision
free (Groq), analysis ~$0.013 (OpenAI nano), embeddings ~$0.001.

The principle behind it: **no ML model weights load locally** — not to save
memory, but to save setup time. A torch install and a multi-gigabyte model
download is two hours that buys nothing the demo needs.
