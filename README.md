# adl-context-collector

Your context is your most valuable asset when working with LLMs. But it's locked inside conversation histories that disappear, scattered across tools, and tied to whichever provider you're using today.

**context-collector** is a personal MCP server that gives any LLM persistent memory — semantic search over your captures, structured facts with temporal tracking, and document ingestion. It works with Claude, ChatGPT, Gemini, or any MCP-compatible client. Your knowledge stays yours.

By default it uses OpenAI for embeddings and metadata extraction. Optionally, run everything locally with [Ollama](#local-setup-ollama) — no data leaves your machine.

**Want to get started fast?** Fork the [adl-context-vault](https://github.com/ammonsdatalabs/adl-context-vault) starter template.

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** with the [pgvector](https://github.com/pgvector/pgvector) extension
- **OpenAI API key** (or [Ollama](https://ollama.com) for fully local operation)
- **An MCP client** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Claude Desktop](https://claude.ai/download), or any app that supports the [Model Context Protocol](https://modelcontextprotocol.io)

### Installing PostgreSQL with pgvector

**macOS (Homebrew):**

```bash
brew install postgresql@17
brew install pgvector
brew services start postgresql@17
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt install postgresql postgresql-contrib
sudo apt install postgresql-17-pgvector
```

**Docker:**

```bash
docker run -d --name context-db \
  -e POSTGRES_PASSWORD=yourpassword \
  -p 5432:5432 \
  pgvector/pgvector:pg17
```

## Quick Start

### 1. Clone context-collector

```bash
git clone https://github.com/ammonsdatalabs/adl-context-collector.git
cd adl-context-collector
npm install
```

### 2. Create a database

```bash
createdb my_context
psql my_context -c "CREATE EXTENSION IF NOT EXISTS vector"
psql my_context < sql/schema.sql
```

### 3. Set up a vault

A vault is a directory that holds your configuration and data. The simplest way to start is to fork the [adl-context-vault](https://github.com/ammonsdatalabs/adl-context-vault) template. Or create one manually:

```bash
mkdir my-vault && cd my-vault
```

Create a `.env` file:

```env
DATABASE_URL=postgresql://localhost:5432/my_context
OPENAI_API_KEY=sk-your-key-here
```

Optionally create a config file for custom domains, categories, and tool descriptions. See [Configuration](#configuration) below.

### 4. Register the MCP server

**Claude Code:**

```bash
claude mcp add my-vault \
  -e DOTENV_CONFIG_PATH=/absolute/path/to/my-vault/.env \
  -- npx tsx /absolute/path/to/adl-context-collector/src/index.ts
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-vault": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/adl-context-collector/src/index.ts"],
      "env": {
        "DOTENV_CONFIG_PATH": "/absolute/path/to/my-vault/.env"
      }
    }
  }
}
```

### 5. Start using it

Restart your MCP client. You now have 8 tools available:

```
> search_context("what did we decide about the API redesign?")
> save_fact(domain: "project", key: "api_redesign_status", value: "approved, starting sprint 12")
> capture_thought("We should use pagination instead of cursor-based — simpler for our use case")
```

## Configuration

context-collector uses a JSON config file with sensible defaults. You only need to override what you want to change.

### Minimal config

No config file needed — defaults work out of the box if you have `OPENAI_API_KEY` set.

### Custom config

Create a JSON file and point to it via your `.env`:

```env
COLLECTOR_CONFIG=/path/to/vault-config.json
```

Example config (see `config.example.json` for the full version):

```json
{
  "serverName": "my-vault",
  "categories": ["status", "cost", "date", "contact", "preference"],
  "tools": {
    "search_context": {
      "description": "Search my project knowledge base using semantic similarity."
    },
    "save_fact": {
      "keyExamples": ["deploy_status", "team_velocity", "sprint_end_date"],
      "currencies": ["USD", "EUR"],
      "units": ["weekly", "monthly", "annual"]
    }
  }
}
```

You only need to include fields you want to override — everything else inherits from defaults via deep merge.

### Embedder configuration

By default, context-collector uses OpenAI's `text-embedding-3-small` for embeddings. To use a different provider or model:

```json
{
  "embedder": {
    "url": "https://api.openai.com/v1/embeddings",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "apiKey": "env:OPENAI_API_KEY"
  }
}
```

- **`url`** — any OpenAI-compatible embeddings endpoint
- **`model`** — the model name to request
- **`dimensions`** — vector dimensions (must match the model's output)
- **`apiKey`** — `"env:VAR_NAME"` reads from an environment variable, `null` skips authentication (for local servers)

### Metadata extraction

By default, context-collector uses GPT-4o-mini to extract metadata (type, domain, topics, people, action items, dates) from ingested content. To disable or configure:

```json
{
  "metadataExtractor": {
    "enabled": true,
    "url": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-mini",
    "apiKey": "env:OPENAI_API_KEY"
  }
}
```

Set `"enabled": false` to skip metadata extraction entirely — content is still searchable via embeddings, but won't have auto-extracted topics, domains, or action items.

### Custom domains and capture types

Via config `.env`:

```env
COLLECTOR_DOMAINS=platform,taxonomy,ingestion,operations
COLLECTOR_CAPTURE_TYPES=thought,decision,analysis,note,meeting,insight,plan,reference
```

Or use the defaults: `general`, `project`, `reference` for domains and 8 capture types.

## Tools Reference

| Tool | Description |
|------|-------------|
| `search_context` | Semantic similarity search across all captures |
| `lookup_fact` | Look up a specific fact by key |
| `search_facts` | Search or filter structured facts |
| `capture_thought` | Save a thought, decision, or note (auto-embedded and metadata-extracted) |
| `save_fact` | Save or update a structured fact with temporal tracking |
| `list_recent` | List recently captured thoughts |
| `context_stats` | Knowledge base statistics (counts, domains, last activity) |
| `ingest_document` | Ingest a file or directory (Markdown, PDF, plain text) |

## Ingestion

### Via MCP tool

From any conversation with your LLM:

```
> ingest_document(path: "/path/to/my-vault/rawdocs/meeting-notes.md")
> ingest_document(path: "/path/to/my-vault/rawdocs/", recursive: true)
```

### Via CLI

```bash
# Single file
env $(grep -v '^#' /path/to/vault/.env | xargs) npm run ingest -- /path/to/document.md

# Directory
env $(grep -v '^#' /path/to/vault/.env | xargs) npm run ingest -- /path/to/rawdocs/
```

### GitHub issues

```bash
env $(grep -v '^#' /path/to/vault/.env | xargs) npm run ingest-github -- --repo owner/repo --limit 50
```

### Supported formats

- **Markdown** (`.md`) — split by headings
- **PDF** (`.pdf`) — split by pages with cross-page sentence handling
- **Plain text** (`.txt`) — split by paragraphs

Documents are chunked, embedded, deduplicated by content hash, and metadata-extracted automatically.

## Multiple Vaults

You can run separate vaults for different contexts (personal, work, side projects) — each with its own database, config, and domains — all sharing the same context-collector installation.

### Example setup

```
~/vaults/personal/
  .env           → DATABASE_URL=...personal_db, COLLECTOR_CONFIG=...
  vault-config.json  → serverName: "personal", domains: finance,family,travel

~/vaults/work/
  .env           → DATABASE_URL=...work_db, COLLECTOR_CONFIG=...
  vault-config.json  → serverName: "work", domains: platform,ops,team
```

Register each separately:

```bash
# Personal vault (project-scoped — only available when working in that directory)
cd ~/vaults/personal
claude mcp add personal-vault \
  -e DOTENV_CONFIG_PATH=$PWD/.env \
  -- npx tsx /path/to/adl-context-collector/src/index.ts

# Work vault (user-scoped — available everywhere)
claude mcp add -s user work-vault \
  -e DOTENV_CONFIG_PATH=~/vaults/work/.env \
  -- npx tsx /path/to/adl-context-collector/src/index.ts
```

Each vault appears as a separate MCP server with its own tool prefix (`personal-vault - search_context`, `work-vault - save_fact`, etc.).

## Local Setup (Ollama)

To keep all data on your machine — no API calls to OpenAI — use [Ollama](https://ollama.com) as your embedder and (optionally) metadata extractor.

### 1. Install Ollama and pull models

```bash
# Install from https://ollama.com
ollama pull nomic-embed-text           # embeddings (required)
ollama pull qwen2.5:7b                 # metadata extraction (optional, needs 16GB+ RAM)
```

### 2. Configure your vault

Add to your vault's config JSON:

```json
{
  "embedder": {
    "url": "http://localhost:11434/v1/embeddings",
    "model": "nomic-embed-text",
    "dimensions": 768,
    "apiKey": null
  },
  "metadataExtractor": {
    "enabled": true,
    "url": "http://localhost:11434/v1/chat/completions",
    "model": "qwen2.5:7b",
    "apiKey": null
  }
}
```

**Important:** Use Ollama's OpenAI-compatible endpoints (`/v1/...`), not the native API endpoints (`/api/...`).

Remove `OPENAI_API_KEY` from your `.env` — it's no longer needed.

### 3. Generate embeddings for the new model

```bash
env $(grep -v '^#' /path/to/vault/.env | xargs) npm run migrate-embeddings
```

This generates embeddings for all captures using the configured model. Existing OpenAI embeddings are preserved — you can switch back at any time by changing the config.

### Hardware requirements

- **8GB RAM** — embeddings only (metadata extraction disabled)
- **16GB+ RAM** — embeddings + metadata extraction with a 7B model

### Switching back to OpenAI

Change your config's `embedder` back to OpenAI settings. If you previously had OpenAI embeddings, they're still in the database — search works immediately. No re-embedding needed.

## Security

context-collector runs as a local stdio process — it has no network listener and no authentication layer. The trust boundary is your local operating system user account. If an attacker can run code as your user, they already have access to everything the MCP server can see.

This is a meaningful improvement over storing context in cloud conversation histories — a provider account compromise no longer exposes your entire knowledge base. But local-only is not a sandbox. The strongest practical controls are OS-level.

### Recommendations

1. **Enable full-disk encryption** — FileVault (macOS) or LUKS (Linux). Protects against physical theft.

2. **Restrict vault file permissions** — your `.env` files contain database credentials and API keys:
   ```bash
   chmod 600 /path/to/vault/.env
   chmod 600 /path/to/vault/vault-config.json
   ```

3. **Bind PostgreSQL to localhost only** — verify `listen_addresses = 'localhost'` in `postgresql.conf`. Use a real password, not a default.

4. **Keep sensitive vaults project-scoped** — register with `claude mcp add` (default, project-scoped) rather than `claude mcp add -s user` (global). Project-scoped servers are only available when Claude is running in that directory.

5. **Go local for embeddings** — by default, ingested content is sent to OpenAI for embedding. If nothing leaving the machine matters, switch to [Ollama](#local-setup-ollama).

6. **Treat MCP queries as trusted execution** — when an LLM queries your vault, it sees what you'd see. This is the point, but be aware that any MCP client you connect has full read/write access to your vault's database.

## Migration

If you have an existing installation that used the old schema (embeddings stored directly in the `captures` table), run the schema migration:

```bash
# Back up first
pg_dump your_database > backup.sql

# Run migration (defaults to your current embedder config for legacy model info)
env $(grep -v '^#' /path/to/vault/.env | xargs) npm run migrate-schema

# Or specify the legacy model explicitly
env $(grep -v '^#' /path/to/vault/.env | xargs) npm run migrate-schema -- \
  --legacy-url "https://api.openai.com/v1/embeddings" \
  --legacy-model "text-embedding-3-small" \
  --legacy-dims 1536
```

This creates the `capture_embeddings` table, copies existing embeddings with their model metadata, verifies the copy, and drops the old column.

## License

ISC
