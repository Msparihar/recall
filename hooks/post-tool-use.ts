#!/usr/bin/env bun

const CHROMA_PORT = 8321;
const CHROMA_BASE = `http://localhost:${CHROMA_PORT}/api/v2/tenants/default_tenant/databases/default_database`;
const COLLECTION_NAME = "memories";

// Load API key - check env first, fall back to reading .env
const OPENAI_KEY = process.env.OPENAI_API_KEY || (() => {
  try {
    const { join } = require("path");
    const { homedir } = require("os");
    const envPaths = [
      join(homedir(), ".env.local"),
      join(process.cwd(), ".env"),
      "D:\\Projects\\recall\\.env",
      "/home/manish/recall/.env",
    ];
    let envContent = "";
    for (const p of envPaths) {
      try { envContent = require("fs").readFileSync(p, "utf-8"); break; } catch {}
    }
    const match = envContent.match(/OPENAI_API_KEY=(.+)/);
    return match?.[1]?.trim() ?? "";
  } catch { return ""; }
})();

interface SaveDecision { content: string; type: string; tags: string[]; }

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

async function main() {
  const raw = await readStdin();
  let payload: any;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const { tool_name, tool_input, tool_response, cwd } = payload;

  // Skip Recall's own tools to avoid recursion
  if (tool_name?.startsWith("mcp__recall__")) process.exit(0);

  const decision = shouldSave(tool_name, tool_input, tool_response);
  if (!decision) process.exit(0);

  // Handle both Unix and Windows paths
  const project = cwd?.split(/[/\\]/).filter(Boolean).pop() ?? "";
  await saveToChroma(decision.content, decision.type, project, decision.tags);
  process.exit(0);
}

function shouldSave(toolName: string, input: any, response: any): SaveDecision | null {
  if (toolName === "Bash") {
    const cmd: string = input?.command ?? "";
    const exitCode: number = response?.exitCode ?? 0;
    const stderr: string = stripAnsi(response?.stderr ?? "");
    const stdout: string = stripAnsi(response?.stdout ?? "");

    // Interesting commands that succeeded
    if (exitCode === 0 && isInterestingCommand(cmd)) {
      return {
        content: `Ran: ${cmd.slice(0, 200)}${stdout ? "\nOutput: " + stdout.slice(0, 300) : ""}`,
        type: "change",
        tags: ["bash", "auto-captured"],
      };
    }

    // Errors worth remembering
    if (exitCode !== 0 && stderr.length > 20) {
      return {
        content: `Command failed: ${cmd.slice(0, 150)}\nError: ${stderr.slice(0, 300)}`,
        type: "bugfix",
        tags: ["bash", "error", "auto-captured"],
      };
    }
  }

  if (toolName === "Write") {
    const filePath: string = input?.file_path ?? "";
    if (isSourceFile(filePath) && !isIgnoredPath(filePath)) {
      return {
        content: `Created file: ${filePath}`,
        type: "change",
        tags: ["file-change", "auto-captured"],
      };
    }
  }

  if (toolName === "Edit") {
    const filePath: string = input?.file_path ?? "";
    if (isSourceFile(filePath) && !isIgnoredPath(filePath)) {
      const oldStr: string = (input?.old_string ?? "").trim();
      const newStr: string = (input?.new_string ?? "").trim();
      let detail = `Modified file: ${filePath}`;
      if (oldStr && newStr) {
        detail += `\n- ${oldStr.slice(0, 100)} → ${newStr.slice(0, 100)}`;
      }
      return {
        content: detail,
        type: "change",
        tags: ["file-change", "auto-captured"],
      };
    }
  }

  return null;
}

function isInterestingCommand(cmd: string): boolean {
  return [
    /git (commit|push|merge|rebase|tag)/,
    /bun (install|add|remove)/,
    /npm (install|ci|publish)/,
    /docker (build|push|run|compose)/,
    /prisma (migrate|generate|push)/,
    /deploy/,
    /^ssh\s/,
  ].some(p => p.test(cmd));
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs|sql|sh|yaml|yml)$/.test(path);
}

function isIgnoredPath(path: string): boolean {
  return /node_modules|\.bun|dist|build|\.git|\.next/.test(path);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function getCollectionId(): Promise<string | null> {
  try {
    const res = await fetch(`${CHROMA_BASE}/collections?limit=100`);
    if (!res.ok) return null;
    const cols = await res.json() as Array<{ id: string; name: string }>;
    return cols.find(c => c.name === COLLECTION_NAME)?.id ?? null;
  } catch { return null; }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function isDuplicate(embedding: number[], collectionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${CHROMA_BASE}/collections/${collectionId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_embeddings: [embedding],
        n_results: 1,
        include: ["distances"],
      }),
    });
    const data = await res.json();
    const distance = data.distances?.[0]?.[0];
    // Cosine distance < 0.05 means similarity > 0.95
    return distance !== undefined && distance < 0.05;
  } catch { return false; }
}

async function saveToChroma(content: string, type: string, project: string, tags: string[]) {
  if (!OPENAI_KEY) return;

  const collectionId = await getCollectionId();
  if (!collectionId) return;

  const embedding = await generateEmbedding(content);

  // Skip if near-duplicate already exists
  if (await isDuplicate(embedding, collectionId)) return;

  const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  await fetch(`${CHROMA_BASE}/collections/${collectionId}/upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids: [id],
      embeddings: [embedding],
      documents: [content],
      metadatas: [{
        type,
        project,
        tags: JSON.stringify(tags),
        created_at: new Date().toISOString(),
        source: "hook-auto",
      }],
    }),
  });
}

main().catch(() => process.exit(0));
