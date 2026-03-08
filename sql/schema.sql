-- Open Brain Schema
-- Local Postgres + pgvector for personal knowledge base

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Table 1: captures (narrative knowledge, semantic search)
-- ============================================================
CREATE TABLE IF NOT EXISTS captures (
    id              BIGSERIAL PRIMARY KEY,
    content         TEXT NOT NULL,
    embedding       vector(1536),

    -- LLM-extracted metadata
    type            TEXT,
    domain          TEXT,
    topics          TEXT[],
    people          TEXT[],
    action_items    TEXT[],
    dates           JSONB,

    -- Source tracking
    source_file     TEXT,
    source_section  TEXT,
    source_type     TEXT DEFAULT 'claude_capture',
    chunk_index     INTEGER,

    -- Timestamps
    captured_at     TIMESTAMPTZ DEFAULT NOW(),
    content_date    DATE,

    -- Deduplication
    content_hash    TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_captures_embedding ON captures
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_captures_domain ON captures (domain);
CREATE INDEX IF NOT EXISTS idx_captures_type ON captures (type);
CREATE INDEX IF NOT EXISTS idx_captures_topics ON captures USING gin (topics);
CREATE INDEX IF NOT EXISTS idx_captures_people ON captures USING gin (people);
CREATE INDEX IF NOT EXISTS idx_captures_captured_at ON captures (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_content_date ON captures (content_date DESC);
CREATE INDEX IF NOT EXISTS idx_captures_source_file ON captures (source_file);

-- ============================================================
-- Table 2: facts (structured key-value with temporal tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS facts (
    id              BIGSERIAL PRIMARY KEY,
    domain          TEXT NOT NULL,
    category        TEXT NOT NULL,
    key             TEXT NOT NULL,
    value           TEXT NOT NULL,
    value_numeric   NUMERIC,
    currency        TEXT,
    unit            TEXT,

    context         TEXT,
    source_file     TEXT,
    people          TEXT[],

    as_of           DATE NOT NULL,
    valid_until     DATE,

    captured_at     TIMESTAMPTZ DEFAULT NOW(),
    source_type     TEXT DEFAULT 'claude_capture',

    UNIQUE (domain, category, key, as_of)
);

CREATE INDEX IF NOT EXISTS idx_facts_lookup ON facts (domain, category, key, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_facts_domain ON facts (domain);
CREATE INDEX IF NOT EXISTS idx_facts_key ON facts (key);
CREATE INDEX IF NOT EXISTS idx_facts_as_of ON facts (as_of DESC);
CREATE INDEX IF NOT EXISTS idx_facts_people ON facts USING gin (people);
CREATE INDEX IF NOT EXISTS idx_facts_current ON facts (domain, category, key)
    WHERE valid_until IS NULL;

-- ============================================================
-- Table 3: sources (migration tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS sources (
    id              BIGSERIAL PRIMARY KEY,
    file_path       TEXT UNIQUE NOT NULL,
    file_hash       TEXT,
    last_imported   TIMESTAMPTZ DEFAULT NOW(),
    capture_count   INTEGER DEFAULT 0,
    fact_count      INTEGER DEFAULT 0,
    notes           TEXT
);
