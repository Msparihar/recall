# Recall — Project Instructions

## Overview
Recall is an MCP server that provides persistent memory for AI agents via semantic search. Built with Bun, ChromaDB, and OpenAI embeddings.

## Stack
- **Runtime**: Bun (run TypeScript directly, no build step)
- **Vector DB**: ChromaDB v3 (auto-started as sidecar on port 8321)
- **Embeddings**: OpenAI `text-embedding-3-small` via `@chroma-core/openai`
- **Protocol**: MCP (Model Context Protocol) over stdio
- **Data**: Persisted at `~/.recall/chroma_data/`

## Key Files
- `src/index.ts` — MCP server entry point, tool registration, stdio transport
- `src/chroma.ts` — ChromaDB lifecycle (sidecar start, collection init)
- `src/tools.ts` — All 6 tool handlers (save, search, get, delete, update, list)

## Development
```bash
bun install          # install deps
bun run src/index.ts # start MCP server
bun test             # run tests
```

## Testing the MCP Server
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | bun run src/index.ts
```

## Architecture Notes
- ChromaDB JS client is HTTP-only (no embedded mode) — server spawns it as a sidecar
- Sidecar checks if already running before spawning (idempotent)
- OpenAI API key loaded from `.env` in project root (Bun auto-loads)
- Memory IDs are strings: `mem_{timestamp}_{random}`
- Tags stored as JSON-stringified arrays in ChromaDB metadata (no native array support)

## Conventions
- Use `bun` not `npm`
- No build step — Bun runs TypeScript directly
- Keep tools.ts handlers pure — all DB access through chroma.ts
- Memory types: discovery, decision, bugfix, feature, change
