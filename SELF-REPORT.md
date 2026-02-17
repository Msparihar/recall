# Self-Report: Recall

## What It Is

An MCP server that gives AI agents persistent memory with semantic search, session tracking, token-aware retrieval, and automatic context injection. Built in TypeScript with Bun, ChromaDB, and OpenAI embeddings.

## Why This Problem

I use [claude-mem](https://github.com/thedotmack/claude-mem) daily in my development workflow. It saves ~90% of context tokens by letting sessions reference past work instead of re-reading code. But I've also felt its friction:

- Agents re-investigate problems already solved in previous sessions
- Context gets lost across sessions despite the memory system existing
- No control over how much context gets injected (token waste)

This is the core problem of AI-assisted development: **agents are stateless by default**. Every session starts from zero. Memory is what turns a tool into a companion.

I chose to build a clean-room implementation because I wanted to deeply understand the problem space — not just use someone else's solution, but reason about what makes agent memory effective.

## What Works

- **All 9 tools functional**: save, search, get_context, get, delete, update, list, list_sessions, get_session_memories
- **Semantic search is accurate**: Searching "database initialization problems" correctly surfaces a Supabase singleton bug over unrelated memories (0.644 vs 0.572 similarity)
- **ChromaDB sidecar auto-starts**: The MCP server manages ChromaDB's lifecycle — checks if already running, spawns if not, polls until ready
- **Zero-config persistence**: Data lives at `~/.recall/chroma_data/`, survives restarts
- **Session tracking**: Each server run is a session with start/end timestamps, memory count, and project/type stats
- **Token-aware retrieval**: `get_context` returns a budget-constrained XML block. `search_memory` supports `max_tokens` for trimmed results
- **SessionStart hook**: Automatically injects relevant memories as context when a new Claude Code session starts
- **PostToolUse hook**: Auto-captures git commits, package installs, docker commands, and file changes without explicit agent action
- **Metadata filtering**: Can scope searches by project name and memory type
- **Partial updates**: Update only the fields that changed, preserving the rest

## What Breaks / Limitations

- **Cold start latency**: ChromaDB sidecar takes 5-15 seconds to start on first launch. Subsequent sessions connect instantly (server stays running).
- **ChromaDB JS has no embedded mode**: The JS client is HTTP-only, requiring a separate server process. This adds operational complexity vs. a pure SQLite approach.
- **OpenAI dependency**: Requires an API key and internet connection for embeddings. A local embedding model would remove this dependency but has Bun compatibility concerns.
- **No deduplication**: Saving the same content twice creates two separate memories with different IDs.
- **Token estimation is approximate**: Uses chars/4 heuristic, not a real tokenizer. Good enough for budgeting, not exact.

## Token / Cost Estimate

| Operation | Cost |
|-----------|------|
| Embedding per save (text-embedding-3-small) | ~$0.00002 per memory |
| Embedding per search | ~$0.00002 per query |
| 1000 memories saved + 500 searches | ~$0.03 total |

The embedding model (`text-embedding-3-small`) is extremely cheap. The real cost is in the AI agent's own tokens for deciding what to save and when to search.

## Architecture Decisions

### Why ChromaDB over SQLite + manual cosine similarity?

v1 used SQLite with embeddings stored as BLOBs and manual cosine similarity in TypeScript. It worked for <10K records, but:

- ChromaDB uses HNSW indexing — O(log n) search vs O(n) linear scan
- ChromaDB handles embedding generation internally
- ChromaDB provides built-in metadata filtering combined with vector search

The tradeoff: ChromaDB JS has no embedded mode, requiring a sidecar server.

### Why MCP over REST API?

MCP is the standard protocol for AI tool integration. It means Recall works with Claude Code, Cursor, Windsurf, and any MCP-compatible client without custom integration code.

### Why hooks use raw HTTP instead of MCP?

The SessionStart and PostToolUse hooks need to communicate with ChromaDB directly because they run as standalone scripts, not through the MCP server. They use the ChromaDB v2 REST API and OpenAI API directly, avoiding any dependency on the MCP server being running.

### Why Bun?

- Zero build step — runs TypeScript directly
- Fast startup
- Auto-loads `.env` files
- Built-in process spawning for the ChromaDB sidecar

## What I'd Build Next

Given more time:

1. **Memory decay** — older, less-accessed memories should be summarized or pruned. A 50K-memory database where 95% is stale noise degrades search quality.
2. **Deduplication** — before saving, check if a semantically similar memory already exists. Update it instead of creating a duplicate.
3. **Local embeddings** — remove the OpenAI dependency entirely with a local model, making Recall work fully offline.
4. **Web UI** — a simple dashboard for browsing, searching, and managing memories manually.
5. **Multi-agent coordination** — shared memory between multiple AI agents working on the same project.

## Process

1. Brainstormed 9 project ideas using background agents searching my development history for real pain points
2. Chose agent memory because I use it daily and understand the problem deeply
3. Built v1 (SQLite + manual embeddings) in ~1 hour — 3 tools, working end-to-end
4. Migrated to ChromaDB in ~1 hour — 6 tools, proper vector search
5. Added 4 new features in parallel (session tracking, token-aware retrieval, context injection hook, auto-capture hook) — expanding from 6 to 9 tools
6. Polished docs and pushed for submission

AI was used throughout — Claude Code wrote the implementation code, managed the ChromaDB research, and ran tests. My role was architectural decisions, problem selection, and quality control.
