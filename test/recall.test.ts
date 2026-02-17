import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { initChroma, getCollection } from "../src/chroma.ts";
import {
  saveMemory,
  searchMemory,
  getMemory,
  deleteMemory,
  updateMemory,
  listMemories,
} from "../src/tools.ts";

let savedIds: string[] = [];

beforeAll(async () => {
  await initChroma();
  // Clean up any existing test memories
  const collection = await getCollection();
  const existing = await collection.get({ where: { project: { $eq: "__test__" } } });
  if (existing.ids.length > 0) {
    await collection.delete({ ids: existing.ids });
  }
});

afterAll(async () => {
  // Clean up test memories
  const collection = await getCollection();
  const existing = await collection.get({ where: { project: { $eq: "__test__" } } });
  if (existing.ids.length > 0) {
    await collection.delete({ ids: existing.ids });
  }
});

describe("save_memory", () => {
  test("saves a memory and returns an ID", async () => {
    const result = JSON.parse(
      await saveMemory({
        content: "Bun has built-in SQLite support via bun:sqlite",
        type: "discovery",
        project: "__test__",
        tags: ["bun", "sqlite"],
      })
    );
    expect(result.id).toStartWith("mem_");
    expect(result.message).toBe("Memory saved successfully.");
    expect(result.total_memories).toBeGreaterThan(0);
    savedIds.push(result.id);
  });

  test("saves a second memory with different type", async () => {
    const result = JSON.parse(
      await saveMemory({
        content: "Use React Query for server state, Zustand for client state",
        type: "decision",
        project: "__test__",
        tags: ["react", "state-management"],
      })
    );
    expect(result.id).toStartWith("mem_");
    savedIds.push(result.id);
  });

  test("saves a bugfix memory", async () => {
    const result = JSON.parse(
      await saveMemory({
        content: "Supabase singleton client corruption caused auth failures in production",
        type: "bugfix",
        project: "__test__",
        tags: ["supabase", "auth", "production"],
      })
    );
    expect(result.id).toStartWith("mem_");
    savedIds.push(result.id);
  });
});

describe("search_memory", () => {
  test("finds semantically relevant memories", async () => {
    const result = JSON.parse(
      await searchMemory({ query: "database support", limit: 3, project: "__test__" })
    );
    expect(result.results.length).toBeGreaterThan(0);
    // SQLite memory should rank highest for "database support"
    expect(result.results[0].content).toContain("SQLite");
    expect(result.results[0].similarity).toBeGreaterThan(0);
  });

  test("filters by type", async () => {
    const result = JSON.parse(
      await searchMemory({ query: "state", type: "decision", project: "__test__" })
    );
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r: any) => r.type === "decision")).toBe(true);
  });

  test("returns empty for no matches", async () => {
    const result = JSON.parse(
      await searchMemory({ query: "quantum computing spaceship", project: "__test__", limit: 1 })
    );
    // Will still return results (semantic search always returns something)
    // but similarity should be low
    if (result.results.length > 0) {
      expect(result.results[0].similarity).toBeLessThan(0.8);
    }
  });
});

describe("get_memory", () => {
  test("retrieves memories by ID", async () => {
    const result = JSON.parse(await getMemory({ ids: [savedIds[0]] }));
    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBe(savedIds[0]);
    expect(result.results[0].content).toContain("SQLite");
    expect(result.results[0].type).toBe("discovery");
    expect(result.results[0].tags).toContain("bun");
  });

  test("retrieves multiple memories", async () => {
    const result = JSON.parse(await getMemory({ ids: savedIds.slice(0, 2) }));
    expect(result.results.length).toBe(2);
  });
});

describe("update_memory", () => {
  test("updates content of existing memory", async () => {
    const result = JSON.parse(
      await updateMemory({
        id: savedIds[0],
        content: "Bun has built-in SQLite support via bun:sqlite — use it instead of better-sqlite3",
      })
    );
    expect(result.message).toBe("Memory updated successfully.");

    // Verify the update
    const fetched = JSON.parse(await getMemory({ ids: [savedIds[0]] }));
    expect(fetched.results[0].content).toContain("better-sqlite3");
    expect(fetched.results[0].type).toBe("discovery"); // type preserved
  });

  test("updates metadata without changing content", async () => {
    const result = JSON.parse(
      await updateMemory({
        id: savedIds[1],
        tags: ["react", "zustand", "react-query"],
      })
    );
    expect(result.message).toBe("Memory updated successfully.");

    const fetched = JSON.parse(await getMemory({ ids: [savedIds[1]] }));
    expect(fetched.results[0].tags).toContain("zustand");
    expect(fetched.results[0].content).toContain("React Query"); // content preserved
  });

  test("returns error for non-existent ID", async () => {
    const result = JSON.parse(
      await updateMemory({ id: "mem_nonexistent_000000", content: "test" })
    );
    expect(result.error).toBeDefined();
  });
});

describe("list_memories", () => {
  test("lists all test memories", async () => {
    const result = JSON.parse(await listMemories({ project: "__test__" }));
    expect(result.results.length).toBe(3);
    expect(result.total_memories).toBeGreaterThanOrEqual(3);
  });

  test("respects limit and offset", async () => {
    const result = JSON.parse(await listMemories({ project: "__test__", limit: 1, offset: 0 }));
    expect(result.results.length).toBe(1);
    expect(result.limit).toBe(1);
    expect(result.offset).toBe(0);
  });

  test("filters by type", async () => {
    const result = JSON.parse(await listMemories({ project: "__test__", type: "bugfix" }));
    expect(result.results.length).toBe(1);
    expect(result.results[0].type).toBe("bugfix");
  });
});

describe("delete_memory", () => {
  test("deletes a memory by ID", async () => {
    const idToDelete = savedIds[2]; // the bugfix one
    const result = JSON.parse(await deleteMemory({ ids: [idToDelete] }));
    expect(result.message).toContain("Deleted 1 memory(s)");

    // Verify deletion
    const fetched = JSON.parse(await getMemory({ ids: [idToDelete] }));
    expect(fetched.results.length).toBe(0);
  });

  test("remaining memories still accessible", async () => {
    const result = JSON.parse(await listMemories({ project: "__test__" }));
    expect(result.results.length).toBe(2);
  });
});
