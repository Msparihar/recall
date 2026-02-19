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
    source: "manual",
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
    // Cosine distance: distance = 1 - cosine_similarity, so similarity = 1 - distance
    // Boost manual saves slightly over auto-captures for better ranking
    const isAutoCapture = meta.source === "hook-auto";
    const sourceBoost = isAutoCapture ? 0 : 0.05;
    const similarity = Math.round(Math.max(0, Math.min(1, (1 - distance) + sourceBoost)) * 1000) / 1000;
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

// ──────────────────────────────────────────────
// compact_memories — clean up auto-captured noise
// ──────────────────────────────────────────────
export async function compactMemories(args: {
  max_age_days?: number;
  dry_run?: boolean;
}): Promise<string> {
  const collection = await getCollection();
  const maxAgeDays = args.max_age_days ?? 30;
  const dryRun = args.dry_run ?? false;
  const cutoffDate = new Date(Date.now() - maxAgeDays * 86400000).toISOString();

  // Fetch all auto-captured memories
  const totalCount = await collection.count();
  const autoMems = await collection.get({
    where: { source: { $eq: "hook-auto" } },
    limit: totalCount,
    include: [IncludeEnum.documents, IncludeEnum.metadatas],
  });

  const toDelete: string[] = [];
  const seen = new Map<string, string>();
  let oldCount = 0;
  let dupCount = 0;

  for (let i = 0; i < autoMems.ids.length; i++) {
    const id = autoMems.ids[i];
    const meta = (autoMems.metadatas[i] as Record<string, string> | null) ?? {};
    const content = (autoMems.documents[i] as string) ?? "";
    const createdAt = meta.created_at ?? "";

    // Remove old auto-captures past TTL
    if (createdAt && createdAt < cutoffDate) {
      toDelete.push(id);
      oldCount++;
      continue;
    }

    // Remove exact content duplicates (keep first seen)
    if (seen.has(content)) {
      toDelete.push(id);
      dupCount++;
    } else {
      seen.set(content, id);
    }
  }

  if (!dryRun && toDelete.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      await collection.delete({ ids: toDelete.slice(i, i + BATCH) });
    }
  }

  const remaining = dryRun ? totalCount : await collection.count();

  return JSON.stringify({
    deleted: toDelete.length,
    old_removed: oldCount,
    duplicates_removed: dupCount,
    dry_run: dryRun,
    cutoff_date: cutoffDate,
    auto_captured_scanned: autoMems.ids.length,
    total_memories_remaining: remaining,
  });
}

// ──────────────────────────────────────────────
// export_memories — dump all memories as JSON
// ──────────────────────────────────────────────
export async function exportMemories(args: {
  project?: string;
  type?: string;
}): Promise<string> {
  const collection = await getCollection();
  const count = await collection.count();

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
    limit: count,
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
      source: meta.source ?? "manual",
    };
  });

  return JSON.stringify({ memories: formatted, total: formatted.length });
}
