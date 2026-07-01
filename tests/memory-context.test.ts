import test from "node:test";
import assert from "node:assert";
import { initGraph, addEntity, addRelation, closeGraph } from "../src/graph.ts";
import { getMemoryContext } from "../src/memory/context-provider.ts";
import { buildMemoryPromptSection } from "../src/memory/prompt-context.ts";
import path from "node:path";
import fs from "node:fs";

test("memory-context provider and prompt builder validations", () => {
  const dbPath = path.resolve(process.cwd(), 'data', 'test-memory.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  // Setup test data
  initGraph(dbPath);
  const e1 = addEntity({ type: "User", namespace: "org:local", name: "Alice", source: "System" });
  const e2 = addEntity({ type: "Document", namespace: "org:local", name: "Design Doc", source: "Wiki" });
  const e3 = addEntity({ type: "Document", namespace: "org:local", name: "Spec", source: "Wiki" });
  addRelation({ type: "CREATED_BY", sourceId: e2, targetId: e1, namespace: "org:local", source: "System" });
  addRelation({ type: "CREATED_BY", sourceId: e3, targetId: e1, namespace: "org:local", source: "System" });
  closeGraph();
  initGraph(dbPath, true);

  try {
    // 1. Test a valid context pack
  const validContext = getMemoryContext({
    tenant: "org:local",
    namespace: "org:local",
    centerEntityId: e1,
    depth: 1
  });
  
  assert.strictEqual(validContext.warnings.length, 0);
  assert.strictEqual(validContext.graphContext.relations.length, 2);
  assert.ok(validContext.tokenEstimate > 0);

  // 2. Test missing entity (throws)
  assert.throws(() => {
    getMemoryContext({
      tenant: "org:local",
      namespace: "org:local",
      centerEntityId: "unknown-123",
      depth: 1
    });
  }, /does not exist/);


  // 4. Test maxRelations/maxEntities limit
  const limitedContext = getMemoryContext({
    tenant: "org:local",
    namespace: "org:local",
    centerEntityId: e1,
    depth: 1,
    maxEntities: 1,
    maxRelations: 1
  });
  assert.strictEqual(limitedContext.graphContext.relations.length, 1);

  // 5. Test provenance collection
  assert.ok(validContext.provenance.length > 0);
  assert.strictEqual(validContext.provenance.some(p => p.source === "Wiki"), true);

  // 6. Test stable prompt section generation
  const promptStr = buildMemoryPromptSection(validContext);
  assert.ok(promptStr.includes("## AgentMemory Graph Context"));
  assert.ok(promptStr.includes("### Core Entity"));
  assert.ok(promptStr.includes("Alice"));
  assert.ok(promptStr.includes("### Related Entities"));
  assert.ok(promptStr.includes("Design Doc"));
  assert.ok(promptStr.includes("### Provenance"));
    assert.ok(promptStr.includes("Source: Wiki"));
  } finally {
    closeGraph();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});
