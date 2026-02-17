# Recall

Persistent memory for AI agents. An MCP server that gives any AI coding assistant the ability to save, search, and manage observations across sessions using semantic search.

## Why This Exists

AI agents forget everything between sessions. Context gets lost, decisions get remade, bugs get re-investigated. Recall gives agents a persistent memory layer with semantic search, session tracking, token-aware retrieval, and automatic context injection.

## Architecture

```
┌─────────────────┐     stdio (JSON-RPC)     ┌──────────────────┐
│  Claude Code /  │◄────────────────────────►│  Recall MCP      │
│  Any MCP Client │                          │  Server (Bun)    │
└─────────────────┘                          └────────┬─────────┘
                                                      │
                                              ┌───────▼─────────┐
                                              │  ChromaDB        │
                                              │  (sidecar)       │
                                              │  Port 8321       │
                                              └───────┬─────────┘
                                                      │
                                              ┌───────▼─────────┐
                                              │  OpenAI          │
                                              │  Embeddings      │
                                              │  text-embedding  │
                                              │  -3-small        │
                                              └─────────────────┘
```

- **Runtime**: Bun (TypeScript, no build step needed)
- **Vector Store**: ChromaDB v3 (auto-started as sidecar process on port 8321)
- **Embeddings**: OpenAI `text-embedding-3-small` via `@chroma-core/openai`
- **Protocol**: MCP (Model Context Protocol) over stdio
- **Persistence**: `~/.recall/chroma_data/`

## Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- An OpenAI API key (for embeddings)

### Install

```bash
git clone https://github.com/Msparihar/recall.git
cd recall
bun install
```

### Configure

Create a `.env` file in the project root:

```
OPENAI_API_KEY=sk-your-key-here
```

### Register with Claude Code

Add to your `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "recall": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/path/to/recall/src/index.ts"],
      "cwd": "/path/to/recall"
    }
  }
}
```

Restart Claude Code. The `recall` tools will be available immediately.

## Tools

| Tool | Description |
|------|-------------|
| `save_memory` | Store an observation with type, project, and tags. Auto-embedded for semantic search. |
| `search_memory` | Semantic search across all memories. Filter by project or type. Supports `max_tokens` budget for token-aware retrieval. |
| `get_context` | Retrieve a token-budget-aware context block formatted as `<recall-context>` XML, ready for prompt injection. |
| `get_memory` | Fetch full details of specific memories by ID. |
| `delete_memory` | Remove memories by ID. |
| `update_memory` | Partially update a memory's content or metadata. Only changed fields are modified. |
| `list_memories` | Browse all memories with pagination and optional filters. |
| `list_sessions` | List past sessions with summary stats — memory count, projects touched, types saved. |
| `get_session_memories` | Retrieve all memories saved during a specific session by session_id. |

### Memory Types

- `discovery` — something learned about a codebase, tool, or system
- `decision` — an architectural or design choice and its rationale
- `bugfix` — a bug that was found and how it was resolved
- `feature` — a feature that was implemented
- `change` — a notable change made to the codebase

### Example Usage (from an AI agent)

```
save_memory({ content: "Supabase client must be a singleton — multiple instances cause auth state corruption", type: "bugfix", project: "m32", tags: ["supabase", "auth"] })

search_memory({ query: "authentication problems", limit: 5 })

search_memory({ query: "database setup", max_tokens: 1000 })

get_context({ query: "deployment process", max_tokens: 2000, project: "m32" })

list_sessions({ limit: 5 })

get_session_memories({ session_id: "ses_1234567890_abc123" })
```

## Session Tracking

Each MCP server run is automatically assigned a session ID (`ses_{timestamp}_{random}`). Every memory saved during a session is tagged with that session's ID. Sessions are tracked in a separate ChromaDB collection with:

- Start/end timestamps
- Memory count
- Projects and types seen

Use `list_sessions` to browse past sessions and `get_session_memories` to replay what happened in a specific session.

## Token-Aware Retrieval

Two mechanisms for controlling output size:

1. **`search_memory` with `max_tokens`**: Returns search results that fit within a token budget. Response includes `tokens_used`, `max_tokens`, and `truncated` fields.

2. **`get_context`**: Purpose-built for prompt injection. Returns a `<recall-context>` XML block with the most relevant memories that fit within the token budget (default: 2000 tokens). Uses greedy fill — highest similarity memories first.

## Hooks

Recall includes two Claude Code hooks for automatic operation:

### SessionStart — Context Injection

`scripts/context-hook.ts` runs when a new Claude Code session starts. It:
- Queries ChromaDB directly via HTTP (no MCP client needed)
- Fetches project-scoped memories first, supplements with global if too few
- Outputs a compact markdown table (up to 10 memories) as session context
- Gracefully degrades if ChromaDB is not running

### PostToolUse — Auto-Capture

`hooks/post-tool-use.ts` runs after every tool use. It watches for:
- Git commits, pushes, merges, rebases
- Package installs (`bun install`, `npm install`)
- Docker commands
- Source file creates/edits

Matching events are saved directly to ChromaDB with OpenAI embeddings. Skips Recall's own tools to avoid recursion. All errors are silently caught — the hook never blocks the agent.

### Registering Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "bun run /path/to/recall/scripts/context-hook.ts" }],
    "PostToolUse": [{ "type": "command", "command": "bun run /path/to/recall/hooks/post-tool-use.ts" }]
  }
}
```

## How It Works

1. **On startup**, the MCP server checks if a ChromaDB instance is running on port 8321. If not, it spawns one as a child process. A new session is created and registered.

2. **When saving**, the content is sent to ChromaDB which generates an embedding via OpenAI's `text-embedding-3-small` model. The memory is tagged with the current session ID.

3. **When searching**, the query text is embedded the same way, and ChromaDB performs approximate nearest neighbor search (HNSW algorithm) to find semantically similar memories.

4. **On session end**, the session record is updated with summary statistics (memory count, projects, types).

5. **Data persists** at `~/.recall/chroma_data/` across sessions and restarts.

## Project Structure

```
recall/
├── src/
│   ├── index.ts         # MCP server — 9 tools, session lifecycle
│   ├── chroma.ts        # ChromaDB sidecar lifecycle, collection management
│   ├── tools.ts         # All 9 tool handlers
│   ├── tokens.ts        # Token estimation, budget, context formatting
│   └── session.ts       # Session state, start/end lifecycle
├── hooks/
│   └── post-tool-use.ts # PostToolUse auto-capture hook
├── scripts/
│   ├── context-hook.ts  # SessionStart context injection hook
│   └── demo.ts          # Interactive demo
├── test/
│   └── recall.test.ts   # End-to-end tests
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── SELF-REPORT.md
├── LICENSE              # MIT
└── .env                 # OPENAI_API_KEY (not committed)
```

## Demo

```bash
bun run scripts/demo.ts
```

## Tests

```bash
bun test
```

## License

MIT
