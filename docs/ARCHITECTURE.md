# Architecture

Local-only. No deployment, no ops. Everything runs on the dev machine.

## System shape

```
React SPA (:5173) ──HTTP──→ Gateway (:8000) ──→ Postgres (:5433)    reads
     │                           │              ├ relational
     │                           │              ├ pgvector
     │                           │              └ Apache AGE
     │                           │
     └──WebSocket──→ Gateway ──→ RocketRide (:5565)                 generation
                                     │
                          Groq · OpenAI · DeepL · TwelveLabs · edge-tts
```

Ports as verified in F1/F2: Postgres runs on 5433, not the Postgres default 5432 — another
project already running on this machine holds 5432. RocketRide's engine runs on 5565, its
real default (not 8080, an earlier wrong assumption). See `CLAUDE.md`'s "Verified" section.

The gateway exists because the browser must not hold API keys, and because RocketRide speaks WebSocket while the SPA wants REST for most operations.

## The read/write split

The most important decision in the system.

| Operation | Path | Budget |
|---|---|---|
| Search (both lanes) | SPA → Gateway → Postgres | < 300 ms |
| Transcript, frames, graph | SPA → Gateway → Postgres | < 200 ms |
| Quiz fetch, attempt write | SPA → Gateway → Postgres | < 200 ms |
| Remediation lookup | SPA → Gateway → AGE query | < 400 ms |
| Answer generation | SPA → Gateway → RocketRide | streaming |
| Ingestion, quiz gen, translation | Job queue → RocketRide | async |

Remediation is a *graph query*, not an agent call. The agent built the edges at ingest time; traversal at request time is pure SQL. This is why it feels instant on stage.

## Ingestion

```
upload
  ├─→ ffmpeg -vn -ac 1 -ar 16000 ──→ Groq whisper ──→ segments(start_ms, end_ms, text)
  │
  └─→ ffmpeg -vf fps=1/5 ──→ ~2160 frames
                              │
                              └─→ dHash ──→ dedup ──→ ~120 board states
                                                       │
                                                       ├─→ image_cleanup → Tesseract (+confidence)
                                                       ├─→ Groq vision  (low-confidence only, ~30)
                                                       ├─→ accessibility_describe
                                                       └─→ TwelveLabs index
```

**The dedup step is the cost model.** 2,160 → ~120 → ~30 vision calls. Pure CPU, ~98% of the total saving, and it's the number worth quoting to judges. Hamming distance threshold on the dHash; tune against real footage, and hard-cap frames sent to vision at 150 per lecture regardless of what dedup returns.

After dedup, compute `spoken_elsewhere` per frame: does the OCR text appear in any transcript segment? This boolean powers the "never said out loud" marker, the product's most legible differentiator.

## Analysis agents

A CrewAI manager coordinates specialists. Each owns exactly one artifact.

| Agent | Model | Output | Why this tier |
|---|---|---|---|
| Manager | Groq 70B | Plan, assignment | Runs once per lecture |
| Map-maker | OpenAI nano | Concepts + `DEPENDS_ON` | Needs full transcript in context |
| Examiner | OpenAI nano | Anchored questions | Structured output, must be reliable |
| Adversary | Groq 70B | Contradiction candidates | Different provider on purpose |
| Translator | DeepL + edge-tts | Captions, audio tracks | Both free, both instant to set up |
| Publisher | deterministic | Embeddings, assembly | No model needed |

The Adversary runs on a different provider from the Map-maker so their errors aren't correlated. Provider is a config field in RocketRide, so this costs nothing to arrange — and it's a nice thing to point at during judging.

## Graph model

```
(:Concept)-[:DEPENDS_ON]->(:Concept)
(:Concept)-[:INTRODUCED_IN {timestamp_ms}]->(:Lecture)
(:Concept)-[:REVISITED_IN {timestamp_ms}]->(:Lecture)
(:Question)-[:TESTS]->(:Concept)
(:Claim)-[:CONTRADICTS {confidence}]->(:Claim)
```

### The remediation query

The single most important query in the product:

> Given a failed question, find its concept. Walk `DEPENDS_ON` backward breadth-first. Return the first prerequisite that (a) was introduced in a lecture *earlier* than the current one, and (b) the student has not demonstrated mastery of. Return that lecture and its `INTRODUCED_IN` timestamp.

**Depth cap: 3.** Beyond that the answer stops being actionable — sending a student back six dependencies is the same as telling them to retake the course. If nothing surfaces within 3 hops, fall back to `REVISITED_IN` on the concept itself.

Implementation lives in `gateway/app/graph_queries.py`.

## Provider ladder

| Job | Provider | Node | Cost |
|---|---|---|---|
| Transcription | Groq `whisper-large-v3-turbo` | `audio_transcribe` | Free |
| Routing, classification | Groq `openai/gpt-oss-20b` | `llm_openai_api` | Free |
| Diagram reading | Groq `qwen/qwen3.6-27b` | `llm_openai_api` | Free |
| Long-context analysis | OpenAI nano | `llm_openai` | ~$0.013/lecture |
| Embeddings | `text-embedding-3-small` | `embedding_openai` | ~$0.001/lecture |
| Translation | DeepL Free | `tool_deepl` | Free (500K chars/mo) |
| TTS | edge-tts sidecar | `tool_http_request` | Free |
| Visual index | TwelveLabs free tier | `twelvelabs` | Trial |

**Groq is OpenAI-compatible.** Point `llm_openai_api` at `https://api.groq.com/openai/v1` — first-class node, free tier, no custom code.

**Why not local Whisper, CLIP, or embeddings?** Setup time. A torch install, a multi-gigabyte model download, and a possible CUDA mismatch is two hours of a 24-hour budget, and it's two hours spent on something that has no bearing on whether the demo lands. Groq's Whisper runs ~200× realtime with an API key and nothing else.

## Frontend

```
<AppShell>
  <CourseRail/>        lecture list, mastery dots, upload
  <Stage>
    <VideoPlayer/>     imperative seekTo(lectureId, ms)
    <BoardStrip/>      ← signature element
    <TranscriptLane/>  auto-scroll, click-to-seek
  </Stage>
  <Inspector>
    <SearchPanel/> <GraphPanel/> <QuizPanel/>
    <ReviewQueue/> <TracePanel/>
  </Inspector>
</AppShell>
```

### The five hard problems

**Player time out of React state.** 60fps re-renders will kill the tree. Ref + `usePlayerTime(cb)` subscription; only the strip cursor and transcript highlight subscribe.

**Cross-lecture seek.** Remediation targets another lecture — swap source, preload, seek, remember the origin. Modelled as a nav stack; `returnToOrigin()` is what keeps the student from being stranded. **This is the interaction the whole demo turns on.**

**Segment snapping.** Raw-millisecond seeks land mid-word. Snap backward to the containing segment, minus 1500ms pre-roll.

**Frame windowing.** 120 states per lecture is fine; a course is thousands. Virtualise the strip, load metadata by time window.

**Graph collapsing.** 200+ force-directed nodes is a slideshow. Cluster by lecture, expand on click, cap visible at ~60.

### BoardStrip

The signature element — a horizontal strip of deduped board states under the player. It's the one thing in the UI that couldn't exist in another product, because no one else has the asset. It does four jobs: navigation, proof (hover shows OCR text, marked when never spoken), derivation replay (arrow keys step board-to-board), and search rendering (board-lane hits highlight here rather than in a list).

Everything around it stays quiet so it can carry the personality.

## Local setup

`docker compose up -d` brings up Postgres and the edge-tts sidecar. RocketRide is not part of this compose file — its VS Code extension already runs a native local engine independent of this repo (confirmed in F1; see `CLAUDE.md`'s "Verified" section). Gateway and SPA run directly on the host with hot reload — faster iteration than rebuilding containers.

Media (thumbnails, audio tracks) is written to `./media`, mounted into the containers and served by the gateway at `/media`.

Ingestion runs as a background job with a `jobs` table for progress. Parallel workers are fine — run several if it speeds up indexing the fixture set.

Disk is the only resource worth watching: a lecture's raw frame extraction is a few thousand JPEGs. Delete raw frames immediately after hashing and keep only the ~120 survivors.
