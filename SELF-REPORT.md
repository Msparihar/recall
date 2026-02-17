# Self-Report: Recall

## What It Is

An MCP server that gives AI agents persistent memory with semantic search. Built in TypeScript with Bun, ChromaDB, and OpenAI embeddings.

## Why This Problem

I use [claude-mem](https://github.com/thedotmack/claude-mem) daily in my development workflow. It saves ~90% of context tokens by letting sessions reference past work instead of re-reading code. But I've also felt its friction:

- Agents re-investigate problems already solved in previous sessions
- I had to add explicit rules in my CLAUDE.md forcing the AI to check memory before redoing work
- Context gets lost across sessions despite the memory system existing

This is the core problem of AI-assisted development: **agents are stateless by default**. Every session starts from zero. Memory is what turns a tool into a companion.

I chose to build a clean-room implementation because I wanted to deeply understand the problem space — not just use someone else's solution, but reason about what makes agent memory effective.

## What Works

- **All 6 tools functional**: save, search, get, delete, update, list
- **Semantic search is accurate**: Searching "database initialization problems" correctly surfaces a Supabase singleton bug over unrelated memories (0.644 vs 0.572 similarity)
- **ChromaDB sidecar auto-starts**: The MCP server manages ChromaDB's lifecycle — checks if already running, spawns if not, polls until ready
- **Zero-config persistence**: Data lives at `~/.recall/chroma_data/`, survives restarts
- **Metadata filtering**: Can scope searches by project name and memory type
- **Partial updates**: Update only the fields that changed, preserving the rest

## What Breaks / Limitations

- **Cold start latency**: ChromaDB sidecar takes 5-15 seconds to start on first launch. Subsequent sessions connect instantly (server stays running).
- **No automatic memory capture**: Unlike claude-mem, there are no hooks that auto-save observations during a session. The agent must explicitly call `save_memory`. This is by design (simpler, more controllable) but means memories only get saved if the agent decides to save them.
- **No session management**: No concept of "sessions" — all memories are global. Can filter by project, but no session-level grouping.
- **No context injection**: Doesn't automatically surface relevant memories at session start. The agent must actively search. claude-mem solves this with SessionStart hooks.
- **ChromaDB JS has no embedded mode**: The JS client is HTTP-only, requiring a separate server process. This adds operational complexity vs. a pure SQLite approach.
- **OpenAI dependency**: Requires an API key and internet connection for embeddings. A local embedding model (e.g., via `@chroma-core/default-embed`) would remove this dependency but has Bun compatibility concerns.
- **No deduplication**: Saving the same content twice creates two separate memories with different IDs.

## Token / Cost Estimate

| Operation | Cost |
|-----------|------|
| Embedding per save (text-embedding-3-small) | ~$0.00002 per memory |
| Embedding per search | ~$0.00002 per query |
| 1000 memories saved + 500 searches | ~$0.03 total |

The embedding model (`text-embedding-3-small`) is extremely cheap. The real cost is in the AI agent's own tokens for deciding what to save and when to search — that's the agent's regular usage, not Recall's overhead.

**Development cost**: This project was built in a single session using Claude Code (Opus). Estimated token spend: ~200K tokens (~$3-5 in API costs for the development session itself).

## Architecture Decisions

### Why ChromaDB over SQLite + manual cosine similarity?

v1 used SQLite with embeddings stored as BLOBs and manual cosine similarity in TypeScript. It worked for <10K records, but:

- ChromaDB uses HNSW (hierarchical navigable small world) indexing — O(log n) search vs O(n) linear scan
- ChromaDB handles embedding generation internally — no manual embedding management
- ChromaDB provides built-in metadata filtering combined with vector search
- It's the industry-standard vector DB for this use case

The tradeoff: ChromaDB JS has no embedded mode, requiring a sidecar server. For a production tool, this is acceptable. For a quick prototype, SQLite was simpler.

### Why MCP over REST API?

MCP is the standard protocol for AI tool integration. It means Recall works with Claude Code, Cursor, Windsurf, and any MCP-compatible client without custom integration code. The stdio transport is simple and reliable.

### Why Bun?

- Zero build step — runs TypeScript directly
- Fast startup
- Auto-loads `.env` files
- Built-in process spawning for the ChromaDB sidecar

## What I'd Build Next

Given more time, these are the highest-impact additions:

1. **SessionStart hook** — automatically search for relevant memories when a new session starts and inject them as context. This is what turns passive memory into active assistance.

2. **Auto-capture via PostToolUse hook** — watch for patterns like bug fixes, config changes, and architectural decisions, and auto-save them without the agent explicitly calling save.

3. **Memory decay** — older, less-accessed memories should be summarized or pruned. A 50K-memory database where 95% is stale noise degrades search quality.

4. **Deduplication** — before saving, check if a semantically similar memory already exists. Update it instead of creating a duplicate.

5. **Web UI** — a simple dashboard for browsing, searching, and managing memories manually. Sometimes you want to curate what the agent remembers.

## Process

1. Brainstormed 9 project ideas using background agents searching my development history for real pain points
2. Chose agent memory because I use it daily and understand the problem deeply
3. Built v1 (SQLite + manual embeddings) in ~1 hour — 3 tools, working end-to-end
4. Migrated to ChromaDB v2 in ~1 hour — 6 tools, proper vector search
5. Polished for submission

AI was used throughout — Claude Code wrote the implementation code, managed the ChromaDB research, and ran tests. My role was architectural decisions, problem selection, and quality control.
