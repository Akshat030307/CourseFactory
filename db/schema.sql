-- Course Factory schema
-- One Postgres, three roles: relational + vector (pgvector) + graph (Apache AGE).
-- All times are integer milliseconds.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS age;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

SELECT create_graph('course_graph');

-- ag_catalog only needs to lead search_path for create_graph() above — AGE
-- puts it first because ag_catalog owns functions like create_graph/cypher.
-- Reset before creating application tables, or they silently land in
-- ag_catalog instead of public (found the hard way: GET /lectures 500'd
-- with "relation lectures does not exist" against a schema that clearly ran
-- clean). Cypher call sites (gateway/app/graph_queries.py) still need
-- ag_catalog in their own search_path or an explicit ag_catalog.cypher(...).
SET search_path = "$user", public;

-- ---------------------------------------------------------------- courses

CREATE TABLE courses (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE lecture_status AS ENUM (
    'uploaded','transcribing','extracting','analyzing','ready','failed'
);

CREATE TABLE lectures (
    id            TEXT PRIMARY KEY,
    course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    sequence      INT  NOT NULL,              -- ordering within course; drives "earlier than"
    duration_ms   BIGINT,
    source_path   TEXT,                       -- nulled after processing unless pinned
    pinned        BOOLEAN NOT NULL DEFAULT false,
    status        lecture_status NOT NULL DEFAULT 'uploaded',
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, sequence)
);

-- ---------------------------------------------------------------- the spine

CREATE TABLE segments (
    id          TEXT PRIMARY KEY,
    lecture_id  TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    start_ms    BIGINT NOT NULL,
    end_ms      BIGINT NOT NULL,
    text        TEXT NOT NULL,
    speaker     TEXT
);
CREATE INDEX segments_lecture_time ON segments (lecture_id, start_ms);
CREATE INDEX segments_text_trgm    ON segments USING gin (text gin_trgm_ops);

-- ------------------------------------------------------------ board states

CREATE TABLE frames (
    id                  TEXT PRIMARY KEY,
    lecture_id          TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    timestamp_ms        BIGINT NOT NULL,
    phash               BIGINT NOT NULL,
    thumb_path          TEXT NOT NULL,
    ocr_text            TEXT,
    ocr_confidence      REAL,
    vision_description  TEXT,          -- only populated for low-confidence frames
    -- false => this content was written but never spoken. Powers the
    -- "never said out loud" marker, the product's clearest differentiator.
    spoken_elsewhere    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX frames_lecture_time ON frames (lecture_id, timestamp_ms);
CREATE INDEX frames_unspoken     ON frames (lecture_id) WHERE spoken_elsewhere = false;

-- ---------------------------------------------------------------- retrieval
-- 1536 dims = OpenAI text-embedding-3-small.
-- Lane is a first-class column: 'written' search must query only board chunks,
-- not filter transcript results after the fact.

CREATE TYPE chunk_source AS ENUM ('transcript','board');

CREATE TABLE chunks (
    id           BIGSERIAL PRIMARY KEY,
    lecture_id   TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    source       chunk_source NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    frame_id     TEXT REFERENCES frames(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    embedding    vector(1536) NOT NULL
);
CREATE INDEX chunks_embedding ON chunks
    USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_lane ON chunks (lecture_id, source);

-- ---------------------------------------------------------------- concepts
-- Relational mirror of the AGE graph. The graph owns the edges; this table
-- owns labels, definitions, and anything we need to JOIN against.

CREATE TABLE concepts (
    id             TEXT PRIMARY KEY,
    course_id      TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    definition     TEXT,
    introduced_in  TEXT REFERENCES lectures(id) ON DELETE SET NULL,
    introduced_ms  BIGINT
);
CREATE INDEX concepts_course ON concepts (course_id);

-- -------------------------------------------------------------- assessment

CREATE TABLE questions (
    id                  TEXT PRIMARY KEY,
    lecture_id          TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    concept_id          TEXT REFERENCES concepts(id) ON DELETE SET NULL,
    prompt              TEXT NOT NULL,
    options             JSONB NOT NULL,      -- [{id,text}]
    correct_option_id   TEXT NOT NULL,
    explanation         TEXT,
    source_timestamp_ms BIGINT NOT NULL,
    -- Deliberate. A professor who sees a wrong question reach her students
    -- never uses the system again.
    approved            BOOLEAN NOT NULL DEFAULT false,
    approved_by         TEXT,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX questions_review ON questions (lecture_id) WHERE approved = false;

-- Stage 15 (multi-student). username/password_hash are nullable — the demo
-- student (s1) and any not-yet-linked row stay NULL; only accounts created
-- via the waitlist "Create account" flow (gateway/app/routes/waitlist.py)
-- get real credentials. Still no self-service registration: this table is
-- never written to by an unauthenticated caller.
CREATE TABLE students (
    id             TEXT PRIMARY KEY,
    telegram_id    TEXT UNIQUE,
    username       TEXT UNIQUE,
    password_hash  TEXT,
    name           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((username IS NULL) = (password_hash IS NULL))
);

CREATE TABLE attempts (
    id           BIGSERIAL PRIMARY KEY,
    student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id  TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    correct      BOOLEAN NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attempts_student ON attempts (student_id, created_at DESC);

-- Rolling mastery per concept. Read by remediation and by the graph overlay.
CREATE TABLE mastery (
    student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    concept_id  TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    score       REAL NOT NULL DEFAULT 0,     -- 0..1
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, concept_id)
);

-- SM-2 lite
CREATE TABLE schedule (
    student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    question_id    TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    due_at         TIMESTAMPTZ NOT NULL,
    interval_days  INT NOT NULL DEFAULT 1,
    ease           REAL NOT NULL DEFAULT 2.5,
    PRIMARY KEY (student_id, question_id)
);
CREATE INDEX schedule_due ON schedule (student_id, due_at);

-- One-time codes a logged-in student generates from the web app and sends
-- to the Telegram bot (/start <code>) to link that chat to their real
-- account — replaces the old "last /start wins onto the one demo student"
-- behavior. Expired-but-unconsumed rows are kept (not deleted) so the bot
-- can tell "expired" apart from "never existed" in its reply.
CREATE TABLE telegram_link_codes (
    code         TEXT PRIMARY KEY,
    student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at  TIMESTAMPTZ
);

-- ----------------------------------------------------------- contradictions

CREATE TABLE claims (
    id           TEXT PRIMARY KEY,
    lecture_id   TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    timestamp_ms BIGINT NOT NULL,
    text         TEXT NOT NULL,
    concept_id   TEXT REFERENCES concepts(id) ON DELETE SET NULL
);

CREATE TABLE contradictions (
    id          TEXT PRIMARY KEY,
    claim_a     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    claim_b     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    confidence  REAL NOT NULL,
    note        TEXT,
    dismissed   BOOLEAN NOT NULL DEFAULT false
);

-- ------------------------------------------------------------ localisation

CREATE TYPE track_kind AS ENUM ('captions','audio','audio_description');

CREATE TABLE tracks (
    id          BIGSERIAL PRIMARY KEY,
    lecture_id  TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    kind        track_kind NOT NULL,
    lang        TEXT NOT NULL,
    path        TEXT NOT NULL,
    UNIQUE (lecture_id, kind, lang)
);

-- -------------------------------------------------------------------- jobs
-- Tracks ingestion progress so the WebSocket can report stage/pct to the SPA.
-- Parallel workers are fine.

CREATE TYPE job_status AS ENUM ('queued','running','done','failed');

CREATE TABLE jobs (
    id           TEXT PRIMARY KEY,
    lecture_id   TEXT REFERENCES lectures(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,         -- ingest | analyze | translate | describe
    status       job_status NOT NULL DEFAULT 'queued',
    stage        TEXT,
    pct          INT NOT NULL DEFAULT 0,
    -- Finer-grained than `stage` — "Describing frame 3/7 via Groq vision"
    -- rather than just "ocr". X5's trace panel reads this; added once a
    -- real consumer (the WS job.progress payload) needed it, not upfront.
    message      TEXT,
    error        TEXT,
    cost_cents   REAL NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ
);
CREATE INDEX jobs_queue ON jobs (status, created_at) WHERE status = 'queued';

-- --------------------------------------------------------------- waitlist
-- Stage 14. Not self-service signup — the app is login-gated (Stage 13),
-- one admin-issued account, no registration flow. This just captures
-- interest so the admin can hand out real credentials manually, same
-- spirit as questions.approved: a human in the loop, not automatic access.

CREATE TABLE waitlist_signups (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    message     TEXT,
    invited     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_signups_created ON waitlist_signups (created_at DESC);

-- ------------------------------------------------------------------- notes
--
-- Graph edges live in AGE, not here:
--   (:Concept)-[:DEPENDS_ON]->(:Concept)
--   (:Concept)-[:INTRODUCED_IN {timestamp_ms}]->(:Lecture)
--   (:Concept)-[:REVISITED_IN {timestamp_ms}]->(:Lecture)
--
-- Example AGE call shape:
--   SELECT * FROM cypher('course_graph', $$
--     MATCH (c:Concept {id: 'c_lu'})-[:DEPENDS_ON*1..3]->(p:Concept)
--     RETURN p.id, p.label
--   $$) AS (id agtype, label agtype);
--
-- Traversal depth is capped at 3. Sending a student back six dependencies
-- is the same as telling them to retake the course.
