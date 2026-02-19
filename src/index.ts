import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  saveMemory,
  searchMemory,
  getMemory,
  deleteMemory,
  updateMemory,
  listMemories,
  getContext,
  listSessions,
  getSessionMemories,
  compactMemories,
  exportMemories,
} from "./tools.ts";
import { initChroma } from "./chroma.ts";
import { generateSessionId, startSession, endSession } from "./session.ts";

const server = new Server(
  { name: "recall", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "save_memory",
      description:
        "Save a memory/observation for future reference. Use this to persist discoveries, decisions, bug fixes, or any context worth remembering across sessions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          content: {
            type: "string",
            description: "The memory content to save",
          },
          type: {
            type: "string",
            enum: ["discovery", "decision", "bugfix", "feature", "change"],
            description: "Type of memory. Default: discovery",
          },
          project: {
            type: "string",
            description: "Project name to scope the memory to (optional)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for categorization (optional)",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "search_memory",
      description:
        "Semantically search through stored memories. Returns results ranked by relevance to the query.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query — will be matched semantically against stored memories",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 10)",
          },
          project: {
            type: "string",
            description: "Filter by project name (optional)",
          },
          type: {
            type: "string",
            enum: ["discovery", "decision", "bugfix", "feature", "change"],
            description: "Filter by memory type (optional)",
          },
          max_tokens: {
            type: "number",
            description: "Token budget for results. If provided, results are trimmed to fit and response includes tokens_used, max_tokens, truncated fields.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_context",
      description:
        "Retrieve a token-budget-aware context block of relevant memories, formatted for injection into a prompt. Returns a <recall-context> XML block.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query — will be matched semantically against stored memories",
          },
          max_tokens: {
            type: "number",
            description: "Token budget for the context block (default: 2000)",
          },
          project: {
            type: "string",
            description: "Filter by project name (optional)",
          },
          type: {
            type: "string",
            enum: ["discovery", "decision", "bugfix", "feature", "change"],
            description: "Filter by memory type (optional)",
          },
          limit: {
            type: "number",
            description: "Candidate pool size before token trimming (default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_memory",
      description: "Fetch full details of specific memories by their string IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of memory IDs to fetch",
          },
        },
        required: ["ids"],
      },
    },
    {
      name: "delete_memory",
      description: "Delete specific memories by their IDs.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of memory IDs to delete",
          },
        },
        required: ["ids"],
      },
    },
    {
      name: "update_memory",
      description:
        "Update the content or metadata of an existing memory. Only the fields you provide will change.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "ID of the memory to update",
          },
          content: {
            type: "string",
            description: "New content for the memory (optional)",
          },
          type: {
            type: "string",
            enum: ["discovery", "decision", "bugfix", "feature", "change"],
            description: "New type for the memory (optional)",
          },
          project: {
            type: "string",
            description: "New project name (optional)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "New tags (optional — replaces existing tags)",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "list_memories",
      description:
        "Browse stored memories with optional pagination and filtering. Useful for reviewing what has been saved.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Max results to return (default: 20)",
          },
          offset: {
            type: "number",
            description: "Number of results to skip for pagination (default: 0)",
          },
          project: {
            type: "string",
            description: "Filter by project name (optional)",
          },
          type: {
            type: "string",
            enum: ["discovery", "decision", "bugfix", "feature", "change"],
            description: "Filter by memory type (optional)",
          },
        },
        required: [],
      },
    },
    {
      name: "list_sessions",
      description:
        "List past sessions with summary statistics — memory count, projects touched, types saved. Useful for reviewing activity history.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Max sessions to return (default: 20)",
          },
          offset: {
            type: "number",
            description: "Number of sessions to skip for pagination (default: 0)",
          },
        },
        required: [],
      },
    },
    {
      name: "get_session_memories",
      description:
        "Retrieve all memories saved during a specific session, identified by session_id.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: {
            type: "string",
            description: "The session ID to retrieve memories for",
          },
          limit: {
            type: "number",
            description: "Max memories to return (default: 50)",
          },
        },
        required: ["session_id"],
      },
    },
    {
      name: "compact_memories",
      description:
        "Clean up auto-captured memory noise. Removes old auto-captures past a TTL and exact content duplicates. Manual saves are never touched.",
      inputSchema: {
        type: "object" as const,
        properties: {
          max_age_days: {
            type: "number",
            description: "Delete auto-captured memories older than this many days (default: 30)",
          },
          dry_run: {
            type: "boolean",
            description: "If true, report what would be deleted without actually deleting (default: false)",
          },
        },
        required: [],
      },
    },
    {
      name: "export_memories",
      description:
        "Export all memories as a JSON array for backup or migration. Supports filtering by project and type.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: {
            type: "string",
            description: "Filter by project name (optional)",
          },
          type: {
            type: "string",
            enum: ["discovery", "decision", "bugfix", "feature", "change"],
            description: "Filter by memory type (optional)",
          },
        },
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "save_memory":
        result = await saveMemory(args as Parameters<typeof saveMemory>[0]);
        break;
      case "search_memory":
        result = await searchMemory(args as Parameters<typeof searchMemory>[0]);
        break;
      case "get_memory":
        result = await getMemory(args as Parameters<typeof getMemory>[0]);
        break;
      case "delete_memory":
        result = await deleteMemory(args as Parameters<typeof deleteMemory>[0]);
        break;
      case "update_memory":
        result = await updateMemory(args as Parameters<typeof updateMemory>[0]);
        break;
      case "list_memories":
        result = await listMemories(args as Parameters<typeof listMemories>[0]);
        break;
      case "get_context":
        result = await getContext(args as Parameters<typeof getContext>[0]);
        break;
      case "list_sessions":
        result = await listSessions(args as Parameters<typeof listSessions>[0]);
        break;
      case "get_session_memories":
        result = await getSessionMemories(args as Parameters<typeof getSessionMemories>[0]);
        break;
      case "compact_memories":
        result = await compactMemories(args as Parameters<typeof compactMemories>[0]);
        break;
      case "export_memories":
        result = await exportMemories(args as Parameters<typeof exportMemories>[0]);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
});

async function main() {
  // Initialize ChromaDB (starts sidecar server if needed, creates collection)
  await initChroma();

  const sessionId = generateSessionId();
  await startSession(sessionId);

  const transport = new StdioServerTransport();

  // Set onclose BEFORE connecting to capture transport teardown
  const originalOnclose = transport.onclose;
  transport.onclose = async () => {
    try {
      await endSession(sessionId);
    } catch (e) {
      console.error("Session end error:", e);
    }
    originalOnclose?.();
  };

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
