-- context-collector Schema
-- Local Postgres + pgvector for personal knowledge base

CREATE EXTENSION IF NOT EXISTS vector;

-- Domain-filtered search sets hnsw.iterative_scan, which pgvector added in 0.8.0.
DO $$
BEGIN
    IF string_to_array((SELECT extversion FROM pg_extension WHERE extname = 'vector'), '.')::int[]
       < ARRAY[0, 8] THEN
        RAISE EXCEPTION 'pgvector 0.8.0 or later is required; ALTER EXTENSION vector UPDATE after upgrading the package';
    END IF;
END
$$;

-- ============================================================
-- Table 1: captures (narrative knowledge, semantic search)
-- ============================================================
CREATE TABLE IF NOT EXISTS captures (
    id              BIGSERIAL PRIMARY KEY,
    content         TEXT NOT NULL,

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

CREATE INDEX IF NOT EXISTS idx_captures_domain ON captures (domain);
CREATE INDEX IF NOT EXISTS idx_captures_type ON captures (type);
CREATE INDEX IF NOT EXISTS idx_captures_topics ON captures USING gin (topics);
CREATE INDEX IF NOT EXISTS idx_captures_people ON captures USING gin (people);
CREATE INDEX IF NOT EXISTS idx_captures_captured_at ON captures (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_captures_content_date ON captures (content_date DESC);
CREATE INDEX IF NOT EXISTS idx_captures_source_file ON captures (source_file);
-- Backs every full-text match on captures, document-frequency counts included. Without
-- it each one seq-scans: ~674ms against 0.4ms.
CREATE INDEX IF NOT EXISTS idx_captures_content_fts
    ON captures USING gin (to_tsvector('english', content));

-- ============================================================
-- Table 1b: capture_embeddings (vector embeddings, multi-model)
-- ============================================================
CREATE TABLE IF NOT EXISTS capture_embeddings (
    capture_id   BIGINT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    provider_url TEXT NOT NULL,
    model        TEXT NOT NULL,
    dimensions   INTEGER NOT NULL,
    embedding    vector NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (capture_id, provider_url, model)
);

-- HNSW indexes are created per-model by the migration CLI.
-- Example for OpenAI text-embedding-3-small:
-- CREATE INDEX idx_embeddings_openai_1536
--   ON capture_embeddings
--   USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
--   WHERE provider_url = 'https://api.openai.com/v1/embeddings'
--     AND model = 'text-embedding-3-small';

-- ============================================================
-- Table 1d: capture_sources (every file that holds a capture's text)
-- ============================================================
-- A capture is stored once per content_hash under one owning source_file; other
-- files with the same text link to it here, so deleting the owner does not lose it.
CREATE TABLE IF NOT EXISTS capture_sources (
    capture_id   BIGINT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    source_file  TEXT NOT NULL,
    PRIMARY KEY (capture_id, source_file)
);

CREATE INDEX IF NOT EXISTS idx_capture_sources_source_file ON capture_sources (source_file);

-- Backfill for databases that predate the table: every owner is also a link.
INSERT INTO capture_sources (capture_id, source_file)
SELECT id, source_file FROM captures WHERE source_file IS NOT NULL
ON CONFLICT DO NOTHING;

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
-- Table 1c: fact_embeddings (vector embeddings for facts, multi-model)
-- Defined here, after facts, because the FK below resolves at CREATE time.
-- ============================================================
CREATE TABLE IF NOT EXISTS fact_embeddings (
    fact_id      BIGINT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    provider_url TEXT NOT NULL,
    model        TEXT NOT NULL,
    dimensions   INTEGER NOT NULL,
    embedding    vector NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (fact_id, provider_url, model)
);

-- HNSW index is created per-model by migrate-embeddings.ts, mirroring capture_embeddings.

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
