import { getCollection, IncludeEnum } from "./chroma.ts";

// ──────────────────────────────────────────────
// save_memory
// ──────────────────────────────────────────────
export async function saveMemory(args: {
  content: string;
  type?: string;
  project?: string;
  tags?: string[];
}): Promise<string> {
  const collection = await getCollection();
  const type = args.type ?? "discovery";
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const metadata: Record<string, string> = {
    type,
    project: args.project ?? "",
    tags: JSON.stringify(args.tags ?? []),
    created_at: new Date().toISOString(),
  };

  await collection.upsert({
    ids: [id],
    documents: [args.content],
    metadatas: [metadata],
  });

  const count = await collection.count();

  return JSON.stringify({
    id,
    message: "Memory saved successfully.",
    total_memories: count,
  });
}

// ──────────────────────────────────────────────
// search_memory
// ──────────────────────────────────────────────
export async function searchMemory(args: {
  query: string;
  limit?: number;
  project?: string;
  type?: string;
}): Promise<string> {
  const collection = await getCollection();
  const nResults = args.limit ?? 10;

  // Build where filter — ChromaDB requires at least one condition per $and entry
  const conditions: Record<string, unknown>[] = [];
  if (args.project) conditions.push({ project: { $eq: args.project } });
  if (args.type) conditions.push({ type: { $eq: args.type } });

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
      ? (conditions[0] as Record<string, unknown>)
      : { $and: conditions };

  const results = await collection.query({
    queryTexts: [args.query],
    nResults,
    where: where as any,
    include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances],
  });

  const ids = results.ids[0] ?? [];
  const documents = results.documents[0] ?? [];
  const metadatas = results.metadatas[0] ?? [];
  const distances = results.distances[0] ?? [];

  if (ids.length === 0) {
    return JSON.stringify({ results: [], message: "No memories found." });
  }

  const formatted = ids.map((id, i) => {
    const meta = (metadatas[i] as Record<string, string> | null) ?? {};
    const distance = distances[i] ?? 1;
    // ChromaDB returns L2 distances — convert to a 0-1 similarity score
    const similarity = Math.round((1 / (1 + distance)) * 1000) / 1000;
    return {
      id,
      content: documents[i] ?? "",
      type: meta.type ?? "",
      project: meta.project || null,
      tags: meta.tags ? JSON.parse(meta.tags) : [],
      similarity,
      created_at: meta.created_at ?? "",
    };
  });

  return JSON.stringify({ results: formatted, total_searched: ids.length });
}

// ──────────────────────────────────────────────
// get_memory
// ──────────────────────────────────────────────
export async function getMemory(args: {
  ids: string[];
}): Promise<string> {
  const collection = await getCollection();

  const result = await collection.get({
    ids: args.ids,
    include: [IncludeEnum.documents, IncludeEnum.metadatas],
  });

  const formatted = result.ids.map((id, i) => {
    const meta = (result.metadatas[i] as Record<string, string> | null) ?? {};
    return {
      id,
      content: result.documents[i] ?? "",
      type: meta.type ?? "",
      project: meta.project || null,
      tags: meta.tags ? JSON.parse(meta.tags) : [],
      created_at: meta.created_at ?? "",
    };
  });

  return JSON.stringify({ results: formatted });
}

// ──────────────────────────────────────────────
// delete_memory
// ──────────────────────────────────────────────
export async function deleteMemory(args: {
  ids: string[];
}): Promise<string> {
  const collection = await getCollection();
  await collection.delete({ ids: args.ids });
  const count = await collection.count();
  return JSON.stringify({
    message: `Deleted ${args.ids.length} memory(s).`,
    total_memories: count,
  });
}

// ──────────────────────────────────────────────
// update_memory
// ──────────────────────────────────────────────
export async function updateMemory(args: {
  id: string;
  content?: string;
  type?: string;
  project?: string;
  tags?: string[];
}): Promise<string> {
  const collection = await getCollection();

  // Fetch current record to merge metadata
  const existing = await collection.get({
    ids: [args.id],
    include: [IncludeEnum.documents, IncludeEnum.metadatas],
  });

  if (existing.ids.length === 0) {
    return JSON.stringify({ error: `Memory with id "${args.id}" not found.` });
  }

  const currentMeta = (existing.metadatas[0] as Record<string, string> | null) ?? {};
  const currentContent = existing.documents[0] ?? "";

  const newMeta: Record<string, string> = {
    type: args.type ?? currentMeta.type ?? "discovery",
    project: args.project !== undefined ? args.project : (currentMeta.project ?? ""),
    tags: args.tags !== undefined ? JSON.stringify(args.tags) : (currentMeta.tags ?? "[]"),
    created_at: currentMeta.created_at ?? new Date().toISOString(),
  };

  const newContent = args.content ?? currentContent;

  await collection.update({
    ids: [args.id],
    documents: [newContent],
    metadatas: [newMeta],
  });

  return JSON.stringify({ id: args.id, message: "Memory updated successfully." });
}

// ──────────────────────────────────────────────
// list_memories
// ──────────────────────────────────────────────
export async function listMemories(args: {
  limit?: number;
  offset?: number;
  project?: string;
  type?: string;
}): Promise<string> {
  const collection = await getCollection();
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;

  const conditions: Record<string, unknown>[] = [];
  if (args.project) conditions.push({ project: { $eq: args.project } });
  if (args.type) conditions.push({ type: { $eq: args.type } });

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
      ? (conditions[0] as Record<string, unknown>)
      : { $and: conditions };

  const result = await collection.get({
    limit,
    offset,
    where: where as any,
    include: [IncludeEnum.documents, IncludeEnum.metadatas],
  });

  const formatted = result.ids.map((id, i) => {
    const meta = (result.metadatas[i] as Record<string, string> | null) ?? {};
    return {
      id,
      content: result.documents[i] ?? "",
      type: meta.type ?? "",
      project: meta.project || null,
      tags: meta.tags ? JSON.parse(meta.tags) : [],
      created_at: meta.created_at ?? "",
    };
  });

  const total = await collection.count();

  return JSON.stringify({
    results: formatted,
    total_memories: total,
    limit,
    offset,
  });
}
