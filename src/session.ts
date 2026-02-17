import { getSessionCollection } from "./chroma.ts";

// ──────────────────────────────────────────────
// Module-level session state
// ──────────────────────────────────────────────
let _sessionId: string | null = null;
let _memoryCount = 0;
const _projectsSeen = new Set<string>();
const _typesSeen = new Set<string>();

export function generateSessionId(): string {
  _sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return _sessionId;
}

export function getSessionId(): string {
  if (!_sessionId) throw new Error("Session not started");
  return _sessionId;
}

export function trackSave(project: string, type: string): void {
  _memoryCount++;
  if (project) _projectsSeen.add(project);
  _typesSeen.add(type);
}

export function getSessionStats() {
  return {
    memoryCount: _memoryCount,
    projects: Array.from(_projectsSeen),
    typesSeen: Array.from(_typesSeen),
  };
}

// ──────────────────────────────────────────────
// startSession — writes initial record to sessions collection
// ──────────────────────────────────────────────
export async function startSession(sessionId: string): Promise<void> {
  const collection = await getSessionCollection();
  await collection.upsert({
    ids: [sessionId],
    documents: [`Session ${sessionId} started`],
    metadatas: [
      {
        session_id: sessionId,
        start_time: new Date().toISOString(),
        end_time: "",
        memory_count: "0",
        projects: "[]",
        types_seen: "[]",
      },
    ],
  });
}

// ──────────────────────────────────────────────
// endSession — fetches existing record to preserve start_time, then updates
// ──────────────────────────────────────────────
export async function endSession(sessionId: string): Promise<void> {
  const stats = getSessionStats();
  const collection = await getSessionCollection();

  // Fetch existing record to preserve start_time
  let startTime = "";
  try {
    const existing = await collection.get({
      ids: [sessionId],
    });
    if (existing.ids.length > 0) {
      const meta = (existing.metadatas[0] as Record<string, string> | null) ?? {};
      startTime = meta.start_time ?? "";
    }
  } catch {
    // Ignore fetch errors — proceed with empty start_time
  }

  const typeCounts = stats.typesSeen.join(", ");
  const summary =
    stats.memoryCount === 0
      ? `Session ${sessionId}: no memories saved.`
      : `Session ${sessionId}: ${stats.memoryCount} memories saved. Types: ${typeCounts}. Projects: ${stats.projects.join(", ") || "none"}.`;

  await collection.update({
    ids: [sessionId],
    documents: [summary],
    metadatas: [
      {
        session_id: sessionId,
        start_time: startTime,
        end_time: new Date().toISOString(),
        memory_count: String(stats.memoryCount),
        projects: JSON.stringify(stats.projects),
        types_seen: JSON.stringify(Array.from(_typesSeen)),
      },
    ],
  });
}
