import { ChromaClient, IncludeEnum, type Collection } from "chromadb";
import { OpenAIEmbeddingFunction } from "@chroma-core/openai";
import { $ } from "bun";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

export const CHROMA_PORT = 8321;
export const CHROMA_HOST = "localhost";
const CONTAINER_NAME = "recall-chroma";
const DATA_DIR = join(homedir(), ".recall", "chroma_data");
const COLLECTION_NAME = "memories";
const COSINE_MARKER = join(homedir(), ".recall", ".cosine_migrated");

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

let _collection: Collection | null = null;

async function startChromaServer(): Promise<void> {
  // Check if already running
  try {
    const res = await fetch(`http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat`);
    if (res.ok) return;
  } catch {}

  if (platform() === "win32") {
    // Windows x64: ChromaDB native bindings don't support this platform, use Docker
    const existing = await $`docker ps -a --filter name=${CONTAINER_NAME} --format {{.Status}}`.text();
    if (existing.trim()) {
      await $`docker start ${CONTAINER_NAME}`.quiet();
    } else {
      const dataPath = DATA_DIR.replace(/\\/g, "/");
      await $`docker run -d --name ${CONTAINER_NAME} --restart unless-stopped -p ${CHROMA_PORT}:8000 -v ${dataPath}:/data -e ANONYMIZED_TELEMETRY=false chromadb/chroma:latest`.quiet();
    }
  } else {
    // Linux/macOS: use the native sidecar
    const { spawn } = await import("bun");
    const chromaCli = new URL("../node_modules/chromadb/dist/cli.mjs", import.meta.url).pathname;
    spawn(["bun", chromaCli, "run", "--path", DATA_DIR, "--host", CHROMA_HOST, "--port", String(CHROMA_PORT)], {
      stdout: "ignore",
      stderr: "ignore",
    });
  }

  // Poll until ready (max 60s)
  for (let i = 0; i < 60; i++) {
    await new Promise<void>((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2/heartbeat`);
      if (res.ok) return;
    } catch {}
  }
  throw new Error("ChromaDB server failed to start within 60 seconds");
}

async function migrateToCosinIfNeeded(client: ChromaClient, embeddingFn: any): Promise<void> {
  if (existsSync(COSINE_MARKER)) return;

  try {
    const collections = await client.listCollections();
    const hasCollection = collections.some(
      (c: any) => c === COLLECTION_NAME || c?.name === COLLECTION_NAME
    );

    if (!hasCollection) {
      writeFileSync(COSINE_MARKER, new Date().toISOString());
      return;
    }

    const col = await client.getCollection({ name: COLLECTION_NAME, embeddingFunction: embeddingFn });
    const count = await col.count();

    if (count === 0) {
      await client.deleteCollection({ name: COLLECTION_NAME });
      writeFileSync(COSINE_MARKER, new Date().toISOString());
      return;
    }

    console.error(`[recall] Migrating ${count} memories to cosine distance...`);

    // Fetch all data with embeddings in batches
    const BATCH = 500;
    const allIds: string[] = [];
    const allDocs: (string | null)[] = [];
    const allMetas: any[] = [];
    const allEmbeddings: (number[] | null)[] = [];

    for (let offset = 0; offset < count; offset += BATCH) {
      const batch = await col.get({
        limit: BATCH,
        offset,
        include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.embeddings],
      });
      allIds.push(...batch.ids);
      allDocs.push(...(batch.documents ?? []));
      allMetas.push(...(batch.metadatas ?? []));
      allEmbeddings.push(...((batch.embeddings as any[]) ?? []));
    }

    // Delete old L2 collection
    await client.deleteCollection({ name: COLLECTION_NAME });

    // Create new with cosine
    const newCol = await client.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: embeddingFn,
      metadata: { "hnsw:space": "cosine" },
    });

    // Re-insert with existing embeddings (no re-embedding cost)
    for (let i = 0; i < allIds.length; i += BATCH) {
      const end = Math.min(i + BATCH, allIds.length);
      await newCol.upsert({
        ids: allIds.slice(i, end),
        documents: allDocs.slice(i, end) as string[],
        metadatas: allMetas.slice(i, end),
        embeddings: allEmbeddings.slice(i, end) as number[][],
      });
    }

    console.error(`[recall] Migration complete: ${allIds.length} memories now use cosine distance.`);
    writeFileSync(COSINE_MARKER, new Date().toISOString());
  } catch (err) {
    console.error("[recall] Migration failed (will retry next start):", err);
  }
}

export async function initChroma(): Promise<Collection> {
  if (_collection) return _collection;

  await startChromaServer();

  const embeddingFn = new OpenAIEmbeddingFunction({
    modelName: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });

  // Migrate existing L2 collection to cosine if needed
  await migrateToCosinIfNeeded(client, embeddingFn);

  _collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: embeddingFn,
    metadata: { "hnsw:space": "cosine" },
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
