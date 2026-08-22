# RocketRide pipelines

> **Read this first.** Node names and config below are now verified against `.rocketride/schema/*.json` (this project's synced catalog — 124 components, source of truth per `ROCKETRIDE_COMPONENT_REFERENCE.md`) and https://docs.rocketride.org, as of 2026-08-20. Two corrections from the original draft: `audio_transcribe` cannot reach Groq (runs local Whisper weights only — see below), and `preprocessor_code` is a *source-code* parser (functions/classes/comments for embedding), not a shell/media-processing node — there is no shell-exec node in the catalog at all. See `CLAUDE.md`'s "Verified" section for the full list of findings. Anything still marked open below is genuinely unconfirmed — check before building on it.
>
> Wiring convention: `control` lives on the **helper**, pointing back at the invoker. Sub-agents take no input lanes; the parent drives them. One helper can serve several invokers by listing each in its `control` array.

---

## P1 · Ingest

Runs once per upload. Entirely async — nothing waits on it in real time.

Audio/frame extraction and perceptual dedup happen **host-side** in `scripts/ingest.py` (ffmpeg + dHash) — confirmed there's no RocketRide node for arbitrary shell commands (`tool_python` is a sandboxed in-process `exec()`, no `subprocess`; `tool_daytona` is a remote cloud sandbox, unnecessary complexity here) or perceptual image hashing. Only the LLM-shaped and storage steps run inside RocketRide:

```
scripts/ingest.py (host):
  ffmpeg → mono 16kHz mp3 ──→ Groq /audio/transcriptions (httpx, direct) ──→ segments
  ffmpeg frames (fps 1/5) → dHash dedup (~120 survivors, hard cap 150) → surviving frames

RocketRide pipeline, triggered per surviving frame batch:
source: webhook
  └── [frames] ──→ image_cleanup ─→ ocr
                ├─→ llm_openai_api (Groq scout, low-confidence only)
                ├─→ accessibility_describe
                └─→ twelvelabs
```

**Nodes:** `webhook`, `image_cleanup`, `ocr`, `llm_openai_api`, `accessibility_describe`, `twelvelabs`, `db_postgres`

**Not used, despite earlier draft:** `audio_transcribe` (local-Whisper-only, see below), `preprocessor_code` (source-code parser, wrong tool), `frame_grabber` (real node, does support `interval` config for fps-style extraction — but redundant once extraction+dedup are host-side; keep this pipeline host-driven instead of splitting the work).

**Critical config — Groq through the OpenAI-compatible node:**
```json
{
  "type": "llm_openai_api",
  "id": "groq_vision",
  "config": {
    "profile": "custom",
    "custom": {
      "model": "qwen/qwen3.6-27b",
      "base_url": "https://api.groq.com/openai/v1",
      "apikey": "${ROCKETRIDE_GROQ_API_KEY}",
      "modelTotalTokens": 128000
    }
  }
}
```
Verified against `.rocketride/schema/llm_openai_api.json`. The real config lives under `config.custom` (the node's only profile), and the field is `apikey`, not `api_key_env` — there is no env-var-name-indirection field. To keep the literal key out of pipeline JSON, use RocketRide's `${ROCKETRIDE_<NAME>}` substitution (only `ROCKETRIDE_`-prefixed vars are substituted) and add `ROCKETRIDE_GROQ_API_KEY` to `.env` alongside the plain `GROQ_API_KEY` that host-side scripts read. This is the trick the whole cost model rests on for vision/LLM calls. Groq exposes an OpenAI-compatible endpoint, so a first-class RocketRide node gets you the free tier with no custom code.

**Resolved — `audio_transcribe` does NOT accept `base_url` and cannot reach Groq.** Its schema has one profile (`model`: local Whisper sizes `tiny`–`large-v3`, plus VAD/silence config) and no provider/URL/key fields at all. The public docs confirm it runs `faster-whisper` locally (or against a `--modelserver`) when the engine starts — i.e. it downloads and executes Whisper weights on the machine running the engine, which violates this project's "no ML weights load locally" rule. **Do not use this node for transcription.** Reach Groq's `/openai/v1/audio/transcriptions` directly instead — either a plain `httpx` call from `scripts/ingest.py` (simplest, recommended), or an agent driving `tool_http_request` (confirmed real node, generic whitelisted-URL HTTP client) if the call must happen inside a pipeline.

**Cost controls baked into this pipeline:**
- Dedup before vision: 2,160 frames → ~120 → ~30 calls. This is the number to quote to judges
- Hard cap of 150 frames to vision regardless of dedup output
- Delete raw frames right after hashing

---

## P2 · Analyze

CrewAI manager with four specialists. Triggered on ingest completion.

```
agent_crewai_manager (manager, Groq 70B)
  ├── Map-maker   [agent_crewai_subagent] → ner, llm_openai (nano)    → concepts/edges (JSON, staged via db_postgres)
  ├── Examiner    [agent_crewai_subagent] → llm_openai (nano)         → questions (approved=false)
  ├── Adversary   [agent_crewai_subagent] → llm_openai_api (Groq 70B) → contradictions
  └── Publisher   [agent_crewai_subagent] → embedding_openai          → postgres (pgvector store)
```

**Nodes:** `agent_crewai_manager`, `agent_crewai_subagent`, `llm_openai`, `llm_openai_api`, `ner`, `embedding_openai`, `postgres`, `db_postgres`, `guardrails`

**Corrected from earlier draft:** the manager node is `agent_crewai_manager`, not `agent_crewai` (that name is the *standalone single-agent* node). Each `agent_crewai_subagent` requires its own `control` wiring for `llm` (min 1) and, if it uses tools, `tool` — subagents do **not** inherit the manager's LLM or tools automatically (confirmed via `invoke` fields in the catalog). `rocketride_vector` and `rocketride_graph` were fabricated names — the real pgvector-backed store node is `postgres`. A graph-writing node ("RocketRide Graph", Postgres+AGE) is described on the public docs site but does not appear in this project's synced catalog — re-check after a fresh extension sync before relying on it. Either way, `CLAUDE.md` rule 3 already routes AGE Cypher through `gateway/app/graph_queries.py` directly, so the Map-maker should emit structured JSON that the gateway loads into AGE, not target a graph node from inside the pipeline.

Three rules:

**Map-reduce the transcript.** ~4K token chunks, then reduce. A 3-hour transcript is ~30K tokens — one prompt would consume a third of Groq's daily free-tier budget, which is why long-context work goes to OpenAI nano instead.

**Skip the Batch API during the build.** The discount is real but the turnaround window is a risk you don't need in 24 hours. Standard calls, and the whole analysis run still costs under two cents.

**The Adversary runs on a different provider from the Map-maker** so their errors aren't correlated. Provider is a config field, so this costs nothing to arrange.

**Guardrails** sit between the Examiner and the database. Nothing reaches `questions` without passing, and `approved` still defaults to false on top of that.

---

## P3 · Answer

The only pipeline in the request path. Streams over WebSocket.

```
chat/websocket → postgres (pgvector, top-k) → rerank_cohere (top-5)
               → llm_openai (nano) → guardrails → response
```

**Hard-truncate context to ~2,000 tokens** after rerank. This is a cost control and an answer-quality control at once — more retrieved context reliably makes answers worse here.

**Search itself does not run through this pipeline.** Retrieval hits Postgres directly through the gateway. Only generation invokes RocketRide.

**Fallback:** on a Groq 429, retry once with backoff, then fall through to OpenAI nano. Degrading to a $0.0005 call beats erroring in front of a judge. Wire this on day one, not at hour 20.

---

## P4 · Localise

```
transcript → tool_deepl (captions) → tool_http_request (edge-tts) → tracks
```

DeepL Free is 500K characters/month. A 3-hour transcript is ~150K characters, so three languages exhausts roughly one lecture's monthly quota. **Use DeepL for one showcase language and Groq 8B for the others**, and document the tradeoff rather than implying it scales.

edge-tts runs as a sidecar container: free, and it needs no model download or torch install. Preferred over the Kokoro node purely on setup time — Kokoro is the swap-later path if local voice quality ever matters.

---

## P5 · MCP surface

Expose the course brain as MCP tools so it answers inside Claude Desktop, Cursor, or any MCP client.

| Tool | Backed by |
|---|---|
| `search_course` | Postgres, direct |
| `explain_concept` | P3 |
| `find_prerequisite` | AGE traversal, direct |
| `get_moment` | Postgres, direct |

Three of four bypass RocketRide entirely — they're reads. Only `explain_concept` generates.

Each returns text plus `http://localhost:5173/lecture/{id}?t={ms}&lane={lane}`.

---

## Open questions

Resolved 2026-08-20 (F2) against `.rocketride/schema/*.json` and https://docs.rocketride.org. See `CLAUDE.md`'s "Verified" section for full detail on each.

- [x] Does `audio_transcribe` accept a custom `base_url`? **No.** Local-Whisper-only (`faster-whisper`, or `--modelserver`) — no provider/URL/key fields exist. Reach Groq directly via `httpx` in `scripts/ingest.py`, or `tool_http_request` if it must run inside a pipeline.
- [x] Does `frame_grabber` expose fps/interval config, or do we shell out to ffmpeg? **Both are true but moot** — the node does have an `interval` (seconds) profile, but since dHash dedup has no RocketRide node at all, frame extraction is simplest done host-side in the same ffmpeg pass as dedup rather than split across a node and a script.
- [x] Does RocketRide's Postgres image ship pgvector and Apache AGE? **N/A — we don't use "RocketRide's" Postgres image.** `docker-compose.yml` runs our own `apache/age`-based instance. Confirmed that image does not ship pgvector; `db/Dockerfile` layers it on (F1). Note: the originally-assumed tag `PG16_latest` doesn't exist on Docker Hub — the real stable PG16 tag is `release_PG16_1.6.0`. RocketRide's self-hosted engine bundles a *separate* internal Postgres — not for our use.
- [x] Does the WebSocket surface per-node execution events? **Yes.** DAP-over-WebSocket at `ws://<host>:5565/task/service`; subscribe `FLOW` via `rrext_monitor`, start pipelines with `pipelineTraceLevel: "summary"`, consume `apaevt_flow`. Full protocol: `.rocketride/docs/ROCKETRIDE_OBSERVABILITY.md`. Gateway doesn't need to invent its own trace events.
- [x] Groq max audio upload size — does a 12-minute mono MP3 need chunking? **~25MB limit; no chunking needed** for 8–12 min fixture clips at mono 16kHz (a few MB). Add a size-check for full-length lectures later, don't build chunking now.
- [x] `twelvelabs` free-tier indexing minutes — enough for four clips? **Yes** — 600 min cumulative free tier vs. 32–48 min for all four fixtures, comfortable headroom for repeated re-indexing.
- [x] Does `agent_crewai_subagent` inherit the manager's tools, or does each need its own `control` wiring? **Each needs its own.** `invoke.llm` (min 1) and `invoke.tool` (min 0) are per-subagent fields in the catalog — no inheritance from `agent_crewai_manager`.
- [ ] Loop and depth caps on agent-as-tool recursion — still undocumented. Not investigated this pass (not on the critical path for F1–F4); relevant if any agent gains a code-execution tool (`tool_python`/`tool_daytona`).

### New, found while resolving the above

- [x] **No pre-built RocketRide Docker image exists — turned out to be moot.** We started self-hosting from source, then discovered (F1) the RocketRide VS Code extension already runs its own native engine locally, independent of this repo. Killed the from-source build and removed the vendored clone. See `CLAUDE.md`'s "Verified" section for the full story.
- [x] `docker-compose.yml` / `.env.example` reference port `8080` for RocketRide; fixed during F1.
- [x] **`ROCKETRIDE_APIKEY` — resolved.** Not exposed anywhere in the Settings webview (checked all tabs, including Local mode) or on disk. Running a `.pipe` file through the sidebar was tried and was *not* actually the source of the key (wrong guess in an earlier draft). **What worked: an API key issued from the RocketRide Cloud dashboard** (`cloud.rocketride.ai`), which authenticates fine against the **local** engine too — the key is account-scoped, not deployment-scoped. `ROCKETRIDE_URI` still points at `localhost`; pipeline execution stays local, only the key came from Cloud. Confirmed working via the SDK. **New caveat:** the local engine runs with `--port=0` (OS-assigned), so its port changes on every restart — `.env` needs re-checking after any engine/VS Code restart until the gateway does this discovery itself. See `CLAUDE.md`'s "Verified" section.
- [ ] A "RocketRide Graph" node (Postgres + Apache AGE) is described on the public docs site but is absent from this project's synced `.rocketride/services-catalog.json`. Re-sync the VS Code extension and re-check before assuming it's unavailable — though per `CLAUDE.md` rule 3, graph writes should go through `gateway/app/graph_queries.py` directly regardless of whether this node exists.
