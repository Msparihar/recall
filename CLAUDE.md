# Recall — Project Instructions

## Overview
Recall is an MCP server that provides persistent memory for AI agents via semantic search. Built with Bun, ChromaDB, and OpenAI embeddings. 9 tools, session tracking, token-aware retrieval, and auto-capture hooks.

## Stack
- **Runtime**: Bun (run TypeScript directly, no build step)
- **Vector DB**: ChromaDB v3 (auto-started as sidecar on port 8321)
- **Embeddings**: OpenAI `text-embedding-3-small` via `@chroma-core/openai`
- **Protocol**: MCP (Model Context Protocol) over stdio
- **Data**: Persisted at `~/.recall/chroma_data/`

## Key Files
- `src/index.ts` — MCP server entry point, 9 tool registrations, session lifecycle
- `src/chroma.ts` — ChromaDB sidecar lifecycle, memories + sessions collections
- `src/tools.ts` — All 9 tool handlers (save, search, get_context, get, delete, update, list, list_sessions, get_session_memories)
- `src/tokens.ts` — Token estimation, budget allocation, context block formatting
- `src/session.ts` — Session state, generateSessionId, startSession/endSession
- `hooks/post-tool-use.ts` — PostToolUse auto-capture hook (standalone script, uses raw HTTP)
- `scripts/context-hook.ts` — SessionStart context injection hook (standalone script, uses raw HTTP)
- `scripts/demo.ts` — Interactive demo

## Hooks
Hooks are registered in `~/.claude/settings.json`:
- `SessionStart` → `scripts/context-hook.ts` (injects relevant memories at session start)
- `PostToolUse` → `hooks/post-tool-use.ts` (auto-captures git, installs, docker, file changes)

Both hooks communicate with ChromaDB directly via HTTP API, not through the MCP server.

## Development
```bash
bun install          # install deps
bun run src/index.ts # start MCP server
bun test             # run tests
```

## Architecture Notes
- ChromaDB JS client is HTTP-only (no embedded mode) — server spawns it as a sidecar
- Sidecar checks if already running before spawning (idempotent)
- OpenAI API key loaded from `.env` in project root (Bun auto-loads)
- Memory IDs: `mem_{timestamp}_{random}`, auto-captured: `auto_{timestamp}_{random}`
- Session IDs: `ses_{timestamp}_{random}`
- Tags stored as JSON-stringified arrays in ChromaDB metadata
- Sessions collection uses noop embedding function (no semantic search needed)
- Hooks use ChromaDB v2 API path: `/api/v2/tenants/default_tenant/databases/default_database/...`

## Conventions
- Use `bun` not `npm`
- No build step — Bun runs TypeScript directly
- Keep tools.ts handlers pure — all DB access through chroma.ts
- Memory types: discovery, decision, bugfix, feature, change
