# Recall

Persistent memory for AI agents. An MCP server that gives any AI coding assistant the ability to save, search, and manage observations across sessions using semantic search.

## Why This Exists

AI agents forget everything between sessions. Context gets lost, decisions get remade, bugs get re-investigated. I use an AI memory tool ([claude-mem](https://github.com/thedotmack/claude-mem)) daily and know both its value and its friction firsthand.

Recall is a clean-room implementation of agent memory as an MCP server — built to understand the problem space deeply and explore what a minimal, effective memory layer looks like.

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
git clone <repo-url> recall
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
| `search_memory` | Semantic search across all memories. Filter by project or type. Returns ranked results with similarity scores. |
| `get_memory` | Fetch full details of specific memories by ID. |
| `delete_memory` | Remove memories by ID. |
| `update_memory` | Partially update a memory's content or metadata. Only changed fields are modified. |
| `list_memories` | Browse all memories with pagination and optional filters. |

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

list_memories({ project: "m32", type: "decision" })
```

## How It Works

1. **On startup**, the MCP server checks if a ChromaDB instance is running on port 8321. If not, it spawns one as a child process using the CLI bundled with the `chromadb` npm package.

2. **When saving**, the content is sent to ChromaDB which generates an embedding via OpenAI's `text-embedding-3-small` model and stores the vector alongside the document and metadata.

3. **When searching**, the query text is embedded the same way, and ChromaDB performs approximate nearest neighbor search (HNSW algorithm) to find semantically similar memories.

4. **Data persists** at `~/.recall/chroma_data/` across sessions and restarts.

## Project Structure

```
recall/
├── src/
│   ├── index.ts      # MCP server — tool registration and routing
│   ├── chroma.ts     # ChromaDB client — sidecar lifecycle, collection management
│   └── tools.ts      # Tool handlers — save, search, get, delete, update, list
├── package.json
├── tsconfig.json
├── SELF-REPORT.md    # Honest assessment — what works, what breaks, costs
└── .env              # OPENAI_API_KEY (not committed)
```

## Running Locally

```bash
# Start the MCP server directly (for testing)
bun run src/index.ts

# Or via npm script
bun start
```

The server communicates over stdio using JSON-RPC (MCP protocol). To test manually:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | bun run src/index.ts
```

## License

MIT
