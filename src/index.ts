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
} from "./tools.ts";
import { initChroma } from "./chroma.ts";

const server = new Server(
  { name: "recall", version: "2.0.0" },
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
