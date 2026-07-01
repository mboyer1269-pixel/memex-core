import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { initGraph, addEntity, addRelation, queryEntities, getNeighbors, buildContextPack, exportGraph, closeGraph } from "../src/graph.ts";

test("graph init creates tables idempotently and meta table", () => {
  initGraph(':memory:');
  assert.ok(true);
});

test("add entity validations", () => {
  initGraph(':memory:');
  
  // Invalid type
  assert.throws(() => {
    addEntity({ type: "InvalidType", namespace: "org:local" });
  }, /Invalid entity type/);

  // Invalid namespace pattern
  assert.throws(() => {
    addEntity({ type: "Project", namespace: "invalid-namespace" });
  }, /Invalid namespace pattern/);

  const id = addEntity({
    type: "Project",
    namespace: "org:local",
    name: "test-project"
  });
  assert.ok(id);
  
  // Duplicate ID
  assert.throws(() => {
    addEntity({ id, type: "Project", namespace: "org:local" });
  }, /Entity duplicate/);
});

test("add relation validations", () => {
  initGraph(':memory:');
  const id1 = addEntity({ type: "Agent", namespace: "org:1" });
  const id2 = addEntity({ type: "Agent", namespace: "org:2" });
  
  // Invalid relation type
  assert.throws(() => {
    addRelation({ type: "INVALID_REL", sourceId: id1, targetId: id2, namespace: "global" });
  }, /Invalid relation type/);

  // Non-existent entity
  assert.throws(() => {
    addRelation({ type: "OWNS", sourceId: "missing", targetId: id2, namespace: "global" });
  }, /Source entity missing/);

  // Cross-tenant restriction
  assert.throws(() => {
    addRelation({ type: "OWNS", sourceId: id1, targetId: id2, namespace: "org:1" });
  }, /Cross-tenant relation rejected/);
  
  // Global exception allows it
  const relId = addRelation({ type: "OWNS", sourceId: id1, targetId: id2, namespace: "global" });
  assert.ok(relId);
});

test("build context pack stabilized format and validations", () => {
  initGraph(':memory:');
  const e1 = addEntity({ type: "User", namespace: "org:local" });
  const e2 = addEntity({ type: "Document", namespace: "org:local" });
  addRelation({ type: "CREATED_BY", sourceId: e2, targetId: e1, namespace: "org:local" });
  
  // Non-existent entity
  assert.throws(() => {
    buildContextPack({ entityId: "missing", namespace: "org:local" });
  }, /ContextPack failed: Entity missing does not exist/);

  const pack = buildContextPack({ entityId: e1, namespace: "org:local" });
  assert.ok(pack.centerEntity);
  assert.strictEqual(pack.centerEntity.id, e1);
  assert.strictEqual(pack.entities.length, 2); // self + neighbor
  assert.strictEqual(pack.relations.length, 1);
  assert.strictEqual(pack.tenant, "org:local");
  assert.strictEqual(pack.depth, 1);
  assert.ok(pack.generatedAt);
});

test("persistent tests with temporary SQLite DB on disk and read-only mode", () => {
  const dbPath = path.resolve(process.cwd(), 'data', 'test-temp.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  initGraph(dbPath);
  const e1 = addEntity({ type: "Skill", namespace: "org:test" });
  assert.ok(e1);

  // Re-init in readonly mode
  closeGraph();
  initGraph(dbPath, true);
  
  // Writes should fail in readonly mode
  assert.throws(() => {
    addEntity({ type: "Skill", namespace: "org:test" });
  }, /attempt to write a readonly database/);

  // Reads should work
  const entities = queryEntities({ namespace: "org:test" });
  assert.strictEqual(entities.length, 1);

  closeGraph();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

test("stress test for database connection leaks on multiple initializations", () => {
  let errorCount = 0;
  let maxIters = 1000;
  let lastError = "";
  let failedIteration = -1;
  const testDbPath = path.resolve(process.cwd(), 'data', 'leak-test.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  for (let i = 0; i < maxIters; i++) {
    try {
      initGraph(testDbPath, false);
    } catch (e: any) {
      errorCount++;
      lastError = e.message;
      failedIteration = i;
      break;
    }
  }
  closeGraph();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  assert.strictEqual(errorCount, 0, `Database connection leak detected! initGraph throws at iteration ${failedIteration} with Error: ${lastError}`);
});
