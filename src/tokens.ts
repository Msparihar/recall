export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ScoredMemory {
  id: string;
  content: string;
  type: string;
  project: string | null;
  tags: string[];
  similarity: number;
  created_at: string;
  tokens: number;
}

export function applyTokenBudget(
  memories: ScoredMemory[],
  maxTokens: number
): { selected: ScoredMemory[]; tokensUsed: number } {
  const selected: ScoredMemory[] = [];
  let remaining = maxTokens;

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    if (mem.tokens <= remaining) {
      selected.push(mem);
      remaining -= mem.tokens;
    } else if (i === 0 && remaining > 0) {
      const charLimit = remaining * CHARS_PER_TOKEN;
      selected.push({ ...mem, content: mem.content.slice(0, charLimit) + "…", tokens: remaining });
      remaining = 0;
      break;
    }
  }
  return { selected, tokensUsed: maxTokens - remaining };
}

export function formatContextBlock(memories: ScoredMemory[]): string {
  if (memories.length === 0) return "<recall-context>\n(no relevant memories found)\n</recall-context>";
  const lines: string[] = ["<recall-context>"];
  for (const mem of memories) {
    const projectPart = mem.project ? `project: ${mem.project} | ` : "";
    lines.push(`[${projectPart}type: ${mem.type} | ${mem.created_at.slice(0, 10)}]`);
    lines.push(mem.content);
    lines.push("");
  }
  lines.push("</recall-context>");
  return lines.join("\n");
}
