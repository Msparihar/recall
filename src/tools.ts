import { getCollection, getSessionCollection, IncludeEnum } from "./chroma.ts";
import { estimateTokens, applyTokenBudget, formatContextBlock, type ScoredMemory } from "./tokens.ts";
import { getSessionId, trackSave } from "./session.ts";

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

  // Try to get session_id — gracefully degrade if session isn't started
  let sessionId = "";
  try {
    sessionId = getSessionId();
  } catch {
    // Session not started — proceed without session tracking
  }

  const metadata: Record<string, string> = {
    type,
    project: args.project ?? "",
    tags: JSON.stringify(args.tags ?? []),
    created_at: new Date().toISOString(),
    session_id: sessionId,
  };

  await collection.upsert({
    ids: [id],
    documents: [args.content],
    metadatas: [metadata],
  });

  if (sessionId) {
    trackSave(args.project ?? "", type);
  }

  const count = await collection.count();

  return JSON.stringify({
    id,
    message: "Memory saved successfully.",
    total_memories: count,
  });
}

// ──────────────────────────────────────────────
// Internal helper: queryMemories
// Returns ScoredMemory[] (with tokens field) sorted by similarity desc.
// ──────────────────────────────────────────────
async function queryMemories(args: {
  query: string;
  limit?: number;
  project?: string;
  type?: string;
}): Promise<ScoredMemory[]> {
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

  return ids.map((id, i) => {
    const meta = (metadatas[i] as Record<string, string> | null) ?? {};
    const distance = distances[i] ?? 1;
    // ChromaDB returns L2 distances — convert to a 0-1 similarity score
    const similarity = Math.round((1 / (1 + distance)) * 1000) / 1000;
    const content = documents[i] ?? "";
    return {
      id,
      content,
      type: meta.type ?? "",
      project: meta.project || null,
      tags: meta.tags ? JSON.parse(meta.tags) : [],
      similarity,
      created_at: meta.created_at ?? "",
      tokens: estimateTokens(content),
    };
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
  max_tokens?: number;
}): Promise<string> {
  const memories = await queryMemories({
    query: args.query,
    limit: args.limit,
    project: args.project,
    type: args.type,
  });

  if (memories.length === 0) {
    return JSON.stringify({ results: [], message: "No memories found." });
  }

  if (args.max_tokens !== undefined) {
    const { selected, tokensUsed } = applyTokenBudget(memories, args.max_tokens);
    // Strip internal tokens field before returning
    const formatted = selected.map(({ tokens: _t, ...rest }) => rest);
    return JSON.stringify({
      results: formatted,
      total_searched: memories.length,
      tokens_used: tokensUsed,
      max_tokens: args.max_tokens,
      truncated: selected.length < memories.length,
    });
  }

  // Backward-compatible path: no max_tokens, strip tokens field
  const formatted = memories.map(({ tokens: _t, ...rest }) => rest);
  return JSON.stringify({ results: formatted, total_searched: memories.length });
}

// ──────────────────────────────────────────────
// get_context
// ──────────────────────────────────────────────
export async function getContext(args: {
  query: string;
  max_tokens?: number;
  project?: string;
  type?: string;
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 20;
  const maxTokens = args.max_tokens ?? 2000;

  const memories = await queryMemories({
    query: args.query,
    limit,
    project: args.project,
    type: args.type,
  });

  const { selected } = applyTokenBudget(memories, maxTokens);
  return formatContextBlock(selected);
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

// ──────────────────────────────────────────────
// list_sessions
// ──────────────────────────────────────────────
export async function listSessions(args: {
  limit?: number;
  offset?: number;
}): Promise<string> {
  const sessionCollection = await getSessionCollection();

  const result = await sessionCollection.get({
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
    include: [IncludeEnum.documents, IncludeEnum.metadatas],
  });

  const formatted = result.ids.map((id, i) => {
    const meta = (result.metadatas[i] as Record<string, string> | null) ?? {};
    return {
      session_id: id,
      summary: result.documents[i] ?? "",
      start_time: meta.start_time ?? "",
      end_time: meta.end_time ?? "",
      memory_count: meta.memory_count ? Number(meta.memory_count) : 0,
      projects: meta.projects ? JSON.parse(meta.projects) : [],
      types_seen: meta.types_seen ? JSON.parse(meta.types_seen) : [],
    };
  });

  return JSON.stringify({
    sessions: formatted,
    total: result.ids.length,
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
  });
}

// ──────────────────────────────────────────────
// get_session_memories
// ──────────────────────────────────────────────
export async function getSessionMemories(args: {
  session_id: string;
  limit?: number;
}): Promise<string> {
  const collection = await getCollection();

  const result = await collection.get({
    where: { session_id: { $eq: args.session_id } },
    limit: args.limit ?? 50,
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
      session_id: meta.session_id ?? "",
    };
  });

  return JSON.stringify({
    results: formatted,
    session_id: args.session_id,
    total: result.ids.length,
  });
}
