import test from "node:test";
import assert from "node:assert";
import { initGraph, addEntity, addRelation, queryEntities, queryRelations, getNeighbors, exportGraph } from "../src/graph.ts";

test("Gen 16 correctness: queryEntities limits behavior for null or omitted values", () => {
  initGraph(':memory:');
  
  // Insert 3 entities
  const id1 = addEntity({ type: "User", namespace: "org:local" });
  const id2 = addEntity({ type: "User", namespace: "org:local" });
  const id3 = addEntity({ type: "User", namespace: "org:local" });
  
  // Omitted limit (should default to 10000, returning all 3)
  const resultOmitted = queryEntities({});
  assert.strictEqual(resultOmitted.length, 3, "Omitted limit should return all entities");
  
  // Explicitly undefined limit
  const resultUndefined = queryEntities({ limit: undefined });
  assert.strictEqual(resultUndefined.length, 3, "Undefined limit should return all entities");

  // null limit (simulating what might happen if passed from some upstream that uses null)
  const resultNull = queryEntities({ limit: null as any });
  assert.strictEqual(resultNull.length, 3, "Null limit should return all entities");

  // limit = 0 (Math.max(1, 0) -> 1)
  const resultZero = queryEntities({ limit: 0 });
  assert.strictEqual(resultZero.length, 1, "Limit 0 should be clamped to 1");

  // limit = 2
  const resultTwo = queryEntities({ limit: 2 });
  assert.strictEqual(resultTwo.length, 2, "Limit 2 should return 2 entities");
});

test("Gen 16 correctness: exportGraph works without truncation", () => {
  initGraph(':memory:');
  
  // Insert 15000 entities (exceeding the default 10000 limit)
  for (let i = 0; i < 15000; i++) {
    addEntity({ type: "User", namespace: "org:local", name: `user-${i}` });
  }

  const exported = exportGraph();
  assert.strictEqual(exported.entities.length, 15000, "exportGraph should not truncate entities to 10000");
  
  // Also check exportGraph with namespace filter
  const exportedNamespace = exportGraph("org:local");
  assert.strictEqual(exportedNamespace.entities.length, 15000, "exportGraph with namespace should not truncate");
});

test("Gen 16 correctness: getNeighbors limits behavior", () => {
  initGraph(':memory:');
  const center = addEntity({ type: "User", namespace: "org:local" });
  
  // Add 5 neighbors
  for (let i = 0; i < 5; i++) {
    const target = addEntity({ type: "User", namespace: "org:local", name: `neighbor-${i}` });
    addRelation({ type: "RELATED_TO", sourceId: center, targetId: target, namespace: "org:local" });
  }

  // Omitted limit
  const omitted = getNeighbors(center);
  assert.strictEqual(omitted.relations.length, 5, "Omitted limit should return all neighbors");

  // null limit
  const nullLimit = getNeighbors(center, null as any);
  assert.strictEqual(nullLimit.relations.length, 5, "Null limit should return all neighbors");

  // explicit limit
  const limit2 = getNeighbors(center, 2);
  assert.strictEqual(limit2.relations.length, 2, "Limit 2 should return 2 neighbors");
});
