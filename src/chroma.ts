import { ChromaClient, IncludeEnum, type Collection } from "chromadb";
import { OpenAIEmbeddingFunction } from "@chroma-core/openai";
import { spawn } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const CHROMA_PORT = 8321;
export const CHROMA_HOST = "localhost";
const DATA_DIR = join(homedir(), ".recall", "chroma_data");
const COLLECTION_NAME = "memories";

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

let _collection: Collection | null = null;

async function startChromaServer(): Promise<void> {
  // Check if already running
  try {
    const res = await fetch(`http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat`);
    if (res.ok) return;
  } catch {}

  // Find the chroma CLI — it ships with the chromadb npm package
  const chromaCli = new URL("../node_modules/chromadb/dist/cli.mjs", import.meta.url).pathname;

  spawn(["bun", chromaCli, "run", "--path", DATA_DIR, "--host", CHROMA_HOST, "--port", String(CHROMA_PORT)], {
    stdout: "ignore",
    stderr: "ignore",
  });

  // Poll until ready (max 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat`);
      if (res.ok) return;
    } catch {}
  }
  throw new Error("ChromaDB server failed to start within 30 seconds");
}

export async function initChroma(): Promise<Collection> {
  if (_collection) return _collection;

  await startChromaServer();

  const embeddingFn = new OpenAIEmbeddingFunction({
    modelName: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
  _collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embeddingFn,
  });

  return _collection;
}

export async function getCollection(): Promise<Collection> {
  if (!_collection) {
    throw new Error("ChromaDB not initialized. Call initChroma() first.");
  }
  return _collection;
}

// ──────────────────────────────────────────────
// Sessions collection — looked up by metadata filter, no semantic search needed
// ──────────────────────────────────────────────
const noopEmbeddingFn = {
  generate: async (texts: string[]) => texts.map(() => [0.0]),
};
let _sessionCollection: Collection | null = null;

export async function getSessionCollection(): Promise<Collection> {
  if (!_sessionCollection) {
    const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
    _sessionCollection = await client.getOrCreateCollection({
      name: "sessions",
      embeddingFunction: noopEmbeddingFn as any,
    });
  }
  return _sessionCollection;
}

export type { Collection };
export { IncludeEnum };
