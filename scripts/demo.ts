#!/usr/bin/env bun
/**
 * Demo script — shows Recall's core capabilities in action.
 * Run: bun run scripts/demo.ts
 */

import { initChroma, getCollection } from "../src/chroma.ts";
import {
  saveMemory,
  searchMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
} from "../src/tools.ts";

function log(label: string, data: unknown) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${label}`);
  console.log(`${"─".repeat(50)}`);
  console.log(typeof data === "string" ? JSON.stringify(JSON.parse(data), null, 2) : JSON.stringify(data, null, 2));
}

async function main() {
  console.log("\n🧠 Recall Demo — Persistent Memory for AI Agents\n");

  // Initialize ChromaDB
  console.log("Initializing ChromaDB...");
  await initChroma();
  console.log("Connected.\n");

  // 1. Save memories
  console.log("=== Saving 4 memories ===");

  const mem1 = await saveMemory({
    content: "React Query handles server state caching, loading states, and automatic refetching. Always use it instead of useEffect for data fetching.",
    type: "decision",
    project: "demo",
    tags: ["react", "react-query", "best-practice"],
  });
  log("Saved: React Query decision", mem1);

  const mem2 = await saveMemory({
    content: "Supabase singleton client was getting corrupted in production because multiple imports created separate instances with different auth states.",
    type: "bugfix",
    project: "demo",
    tags: ["supabase", "singleton", "auth"],
  });
  log("Saved: Supabase bugfix", mem2);

  const mem3 = await saveMemory({
    content: "ChromaDB JavaScript client has no embedded mode. It requires a separate HTTP server. Use the sidecar pattern to auto-start it from your application.",
    type: "discovery",
    project: "demo",
    tags: ["chromadb", "architecture"],
  });
  log("Saved: ChromaDB discovery", mem3);

  const mem4 = await saveMemory({
    content: "Deployed the new payment integration using Stripe webhooks. Events are verified with signature checking before processing.",
    type: "feature",
    project: "demo",
    tags: ["stripe", "payments", "webhooks"],
  });
  log("Saved: Stripe feature", mem4);

  // 2. Semantic search
  console.log("\n=== Semantic Search ===");

  const search1 = await searchMemory({
    query: "authentication problems in production",
    limit: 3,
    project: "demo",
  });
  log("Search: 'authentication problems in production'", search1);

  const search2 = await searchMemory({
    query: "how to fetch data in React",
    limit: 3,
    project: "demo",
  });
  log("Search: 'how to fetch data in React'", search2);

  // 3. Filtered search
  console.log("\n=== Filtered Search (bugfixes only) ===");

  const filtered = await searchMemory({
    query: "client initialization",
    type: "bugfix",
    project: "demo",
  });
  log("Search bugfixes: 'client initialization'", filtered);

  // 4. List all
  console.log("\n=== List All Memories ===");

  const all = await listMemories({ project: "demo" });
  log("All demo memories", all);

  // 5. Update a memory
  const savedId = JSON.parse(mem1).id;
  console.log("\n=== Update Memory ===");

  const updated = await updateMemory({
    id: savedId,
    content: "React Query (TanStack Query) handles server state. Use it for ALL data fetching. Never use useEffect + useState for API calls.",
    tags: ["react", "tanstack-query", "critical-rule"],
  });
  log(`Updated memory ${savedId}`, updated);

  // Verify update
  const fetched = await getMemory({ ids: [savedId] });
  log("Fetched updated memory", fetched);

  // 6. Delete
  const deleteId = JSON.parse(mem4).id;
  console.log("\n=== Delete Memory ===");

  const deleted = await deleteMemory({ ids: [deleteId] });
  log(`Deleted memory ${deleteId}`, deleted);

  // 7. Final state
  console.log("\n=== Final State ===");
  const final = await listMemories({ project: "demo" });
  log("Remaining demo memories", final);

  // Cleanup demo data
  const remaining = JSON.parse(final);
  if (remaining.results.length > 0) {
    const ids = remaining.results.map((r: any) => r.id);
    await deleteMemory({ ids });
    console.log(`\nCleaned up ${ids.length} demo memories.`);
  }

  console.log("\nDemo complete.\n");
}

main().catch(console.error);
