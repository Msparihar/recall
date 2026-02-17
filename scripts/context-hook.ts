#!/usr/bin/env bun

const CHROMA_PORT = 8321;
const CHROMA_HOST = "localhost";
const CHROMA_BASE = `http://${CHROMA_HOST}:${CHROMA_PORT}/api/v2`;
const COLLECTION_NAME = "memories";
const MAX_MEMORIES = 10;
const CONTENT_PREVIEW_LEN = 120;
const TIMEOUT_MS = 2000;

const TYPE_ICONS: Record<string, string> = {
  discovery: "D", decision: "A", bugfix: "B", feature: "F", change: "C",
};

interface Memory {
  id: string; content: string; type: string; project: string; tags: string[]; created_at: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function projectFromCwd(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "";
}

async function isChromaAlive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${CHROMA_BASE}/heartbeat`, { signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

async function getCollectionId(): Promise<string | null> {
  const res = await fetch(`${CHROMA_BASE}/collections?limit=100`);
  if (!res.ok) return null;
  const cols = await res.json() as Array<{ id: string; name: string }>;
  return cols.find(c => c.name === COLLECTION_NAME)?.id ?? null;
}

async function getRecentMemories(collectionId: string, project: string): Promise<Memory[]> {
  const fetchLimit = MAX_MEMORIES * 3;

  async function fetchFromChroma(where?: object): Promise<Memory[]> {
    const body: any = { limit: fetchLimit, include: ["documents", "metadatas"] };
    if (where) body.where = where;
    const res = await fetch(`${CHROMA_BASE}/collections/${collectionId}/get`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.ids ?? []).map((id: string, i: number) => {
      const meta = data.metadatas?.[i] ?? {};
      let tags: string[] = [];
      try { tags = JSON.parse(meta.tags ?? "[]"); } catch {}
      return { id, content: data.documents?.[i] ?? "", type: meta.type ?? "discovery", project: meta.project ?? "", tags, created_at: meta.created_at ?? "" };
    });
  }

  let memories: Memory[] = [];
  if (project) memories = await fetchFromChroma({ project: { $eq: project } });

  if (memories.length < MAX_MEMORIES / 2) {
    const global = await fetchFromChroma();
    const existing = new Set(memories.map(m => m.id));
    memories = [...memories, ...global.filter(m => !existing.has(m.id))];
  }

  memories.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return memories.slice(0, MAX_MEMORIES);
}

function formatContext(memories: Memory[], project: string, total: number): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# [recall] ${project || "global"} context — ${date}`);
  lines.push("");
  if (memories.length === 0) {
    lines.push("No memories found. Use `save_memory` to start building persistent context.");
    return lines.join("\n");
  }
  lines.push(`Recent memories (${memories.length} of ${total} total). Use \`get_memory\` with an ID for full content.`);
  lines.push("");
  lines.push("| ID | Date | T | Preview |");
  lines.push("|----|------|---|---------|");
  for (const m of memories) {
    const d = m.created_at?.slice(0, 10) ?? "unknown";
    const icon = TYPE_ICONS[m.type] ?? "?";
    let preview = m.content.length > CONTENT_PREVIEW_LEN ? m.content.slice(0, CONTENT_PREVIEW_LEN).trimEnd() + "..." : m.content;
    preview = preview.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${m.id} | ${d} | ${icon} | ${preview} |`);
  }
  lines.push("");
  lines.push("**Legend:** D=discovery A=decision B=bugfix F=feature C=change");
  if (total > memories.length) lines.push(`${total - memories.length} older memories not shown. Use \`search_memory\` to find specific ones.`);
  return lines.join("\n");
}

function output(additionalContext: string) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }) + "\n");
  process.exit(0);
}

async function main() {
  let cwd = process.cwd();
  try {
    const raw = await readStdin();
    if (raw.trim()) { const input = JSON.parse(raw); cwd = input.cwd ?? cwd; }
  } catch {}

  const project = projectFromCwd(cwd);
  if (!await isChromaAlive()) { output(""); return; }

  const collectionId = await getCollectionId();
  if (!collectionId) { output(""); return; }

  let total = 0;
  try {
    const res = await fetch(`${CHROMA_BASE}/collections/${collectionId}`);
    if (res.ok) total = (await res.json()).count ?? 0;
  } catch {}

  const memories = await getRecentMemories(collectionId, project);
  output(formatContext(memories, project, total));
}

main().catch(() => output(""));
