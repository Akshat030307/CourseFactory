# Gateway API

Base: `/api/v1`. All times are **integer milliseconds**. Errors use RFC 7807 (`application/problem+json`).

No auth. Local-only build with one hardcoded student and one instructor. Don't build around its absence.

---

## Lectures

### `GET /lectures`
```json
[{ "id": "l01", "title": "The Geometry of Linear Equations",
   "course_id": "18.06", "sequence": 1, "duration_ms": 720000,
   "status": "ready", "mastery": 0.62 }]
```
`status`: `uploaded | transcribing | extracting | analyzing | ready | failed`

### `GET /lectures/{id}`
Adds `languages: string[]`, `has_audio_description: bool`, `frame_count`, `segment_count`.

### `POST /lectures`
Multipart upload. Returns `{ "id", "job_id" }` and enqueues ingestion. Subscribe to the job over WS for progress.

### `GET /lectures/{id}/segments`
```json
[{ "id": "s0041", "start_ms": 884000, "end_ms": 891500,
   "text": "...", "speaker": null }]
```
Optional `?from_ms=&to_ms=`. Cache aggressively — segments are immutable once ready.

### `GET /lectures/{id}/frames`
```json
[{ "id": "f0087", "timestamp_ms": 884000,
   "thumb_url": "/media/l01/f0087.jpg",
   "ocr_text": "A = LU",
   "ocr_confidence": 0.91,
   "vision_description": null,
   "spoken_elsewhere": false }]
```
`spoken_elsewhere: false` powers the "never said out loud" marker. Supports `?from_ms=&to_ms=&limit=` for strip windowing.

---

## Search

### `POST /search`
```json
{ "query": "why elimination fails",
  "lane": "both",
  "course_id": "18.06",
  "lecture_id": null,
  "limit": 10 }
```
`lane`: `spoken` | `written` | `both`. `written` queries only OCR-derived chunks — this is the board-only differentiator, not a filter on top of transcript results.

```json
{ "results": [
    { "lecture_id": "l02", "lecture_title": "Elimination with Matrices",
      "timestamp_ms": 884000, "snippet": "...", "score": 0.83,
      "source": "board", "spoken_elsewhere": false,
      "frame_id": "f0087" }],
  "took_ms": 180 }
```
`source`: `transcript | board`. Postgres only — no LLM, no pipeline. Budget 300 ms.

---

## Graph

### `GET /courses/{id}/graph`
```json
{ "nodes": [{ "id": "c_lu", "label": "LU factorization",
              "lecture_id": "l04", "timestamp_ms": 240000,
              "mastery": 0.4 }],
  "edges": [{ "from": "c_lu", "to": "c_elimination", "type": "DEPENDS_ON" }] }
```
`?lecture_id=` returns that lecture's cluster plus one hop, for collapsed rendering.

### `GET /concepts/{id}`
Definition, `introduced_in`, `revisited_in[]`, related questions.

---

## Assessment

### `GET /lectures/{id}/quiz`
Only returns `approved = true` questions unless `?include_unapproved=true` (instructor mode).
```json
[{ "id": "q0012", "prompt": "...",
   "options": [{"id":"a","text":"..."}],
   "correct_option_id": "c",
   "concept_id": "c_lu",
   "source_timestamp_ms": 240000,
   "explanation": "..." }]
```

### `POST /attempts`
```json
{ "question_id": "q0012", "chosen_option_id": "a", "student_id": "s1" }
```
Returns `{ "correct": false, "remediation": { ... } }` — see below. Also updates mastery and the spaced-repetition schedule.

### `GET /remediation?question_id=&student_id=`
The differentiator. Pure graph traversal, no LLM.
```json
{ "found": true,
  "concept": { "id": "c_elimination", "label": "Elimination" },
  "target": { "lecture_id": "l02", "lecture_title": "Elimination with Matrices",
              "timestamp_ms": 512000, "duration_hint_ms": 90000 },
  "hops": 2,
  "reason": "LU factorization builds on elimination, which you haven't shown mastery of yet." }
```
`found: false` when nothing surfaces within 3 hops — fall back to `REVISITED_IN` on the concept itself. Budget 400 ms.

`reason` is student-facing copy. Write it from their side: "you haven't shown mastery of," never "no mastery record found."

### `GET /schedule?student_id=`
Due reviews, SM-2-lite. Powers both the in-app drill and the Telegram bot.

---

## Instructor

### `GET /review-queue?course_id=`
Unapproved questions, each with its source segment and frame so verification takes seconds.

### `POST /questions/{id}/approve` · `POST /questions/{id}/reject`
Bulk variant: `POST /review-queue/approve` with `{ "concept_id": "c_lu" }`.

---

## Contradictions

### `GET /courses/{id}/contradictions`
```json
[{ "id": "x001", "confidence": 0.78,
   "claim_a": { "lecture_id": "l02", "timestamp_ms": 300000, "text": "..." },
   "claim_b": { "lecture_id": "l04", "timestamp_ms": 120000, "text": "..." },
   "note": "..." }]
```

---

## Localisation

### `GET /lectures/{id}/tracks`
```json
[{ "kind": "captions", "lang": "en", "url": "/media/l01/en.vtt" },
 { "kind": "audio", "lang": "hi", "url": "/media/l01/hi.mp3" },
 { "kind": "audio_description", "lang": "en", "url": "/media/l01/ad-en.mp3" }]
```

---

## WebSocket

`/ws?token=`. Single connection, message-type router. All frames:
```json
{ "type": "...", "job_id": "...", "seq": 12, "payload": { } }
```

### Server → client

| `type` | Payload | Use |
|---|---|---|
| `job.progress` | `{ stage, pct, message }` | Ingestion progress |
| `job.complete` | `{ lecture_id }` | Invalidate TanStack queries |
| `job.failed` | `{ stage, error }` | Surface what to fix |
| `node.start` | `{ node_id, node_type, label }` | Trace panel lights up |
| `node.finish` | `{ node_id, duration_ms, tokens_in, tokens_out }` | Trace panel |
| `cost.update` | `{ cents, breakdown }` | Cost meter |
| `answer.delta` | `{ text }` | Streaming generated answers |
| `answer.done` | `{ citations: [{lecture_id, timestamp_ms}] }` | Render jump links |

### Client → server

| `type` | Payload |
|---|---|
| `subscribe` | `{ job_id }` |
| `ask` | `{ query, course_id, lecture_id? }` |
| `cancel` | `{ job_id }` |

`node.*` events depend on whether RocketRide's WebSocket surfaces per-node execution. **Unverified** — if it doesn't, the gateway emits equivalent events at pipeline-invocation boundaries instead. The client contract stays the same either way.

---

## MCP tools

Exposed via RocketRide's MCP surface. Each returns text plus a deep link back into the SPA.

| Tool | Args | Returns |
|---|---|---|
| `search_course` | `query, course_id, lane?` | Ranked moments with timestamps |
| `explain_concept` | `concept, course_id` | Explanation + where it's introduced |
| `find_prerequisite` | `concept, course_id` | Prerequisite chain |
| `get_moment` | `lecture_id, timestamp_ms` | Transcript + board text around that point |

Deep link format: `http://localhost:5173/lecture/{id}?t={ms}&lane={lane}`
