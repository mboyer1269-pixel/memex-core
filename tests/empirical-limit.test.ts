import { test } from 'node:test';
import assert from 'node:assert';
import { initGraph, closeGraph, addEntity, addRelation, queryEntities, queryRelations, exportGraph } from '../src/graph.ts';
import crypto from 'crypto';
import fs from 'fs';

test('Empirical testing for limit bypass fix', async (t) => {
  // Use in-memory db
  initGraph(':memory:', false);

  const numToInsert = 10050;
  
  await t.test('Insert 10,050 entities', () => {
    for (let i = 0; i < numToInsert; i++) {
      addEntity({
        type: 'Memory',
        namespace: 'global',
        name: `test-entity-${i}`,
      });
    }
    assert.strictEqual(true, true);
  });

  await t.test('queryEntities defaults to 10000', () => {
    const results = queryEntities({});
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryEntities with limit: NaN caps at 10000', () => {
    // We have to bypass TS to pass NaN if it's strictly typed, but let's cast
    const results = queryEntities({ limit: NaN as any });
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryEntities with limit: null caps at 10000', () => {
    const results = queryEntities({ limit: null as any });
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryEntities with limit: "15000" (string) caps at 10000', () => {
    const results = queryEntities({ limit: "15000" as any });
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryEntities with limit: 20000 caps at 10000', () => {
    const results = queryEntities({ limit: 20000 });
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryEntities with limit: 50 returns 50', () => {
    const results = queryEntities({ limit: 50 });
    assert.strictEqual(results.length, 50);
  });

  await t.test('exportGraph returns all >10000 rows', () => {
    const graph = exportGraph();
    assert.strictEqual(graph.entities.length, numToInsert);
  });

  await t.test('Insert 10,050 relations', () => {
    // We already have entities. We will just relate the first entity to the others.
    const entities = queryEntities({}); // Returns 10,000 entities
    const sourceId = entities[0].id!;
    
    // We need 10050 targets. Let's just create some targets on the fly or relate to global self
    for (let i = 0; i < numToInsert; i++) {
      addRelation({
        type: 'RELATED_TO',
        sourceId: sourceId,
        targetId: sourceId, // self relation is fine for this test
        namespace: 'global'
      });
    }
  });

  await t.test('queryRelations defaults to 10000', () => {
    const results = queryRelations({});
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryRelations with limit: NaN caps at 10000', () => {
    const results = queryRelations({ limit: NaN as any });
    assert.strictEqual(results.length, 10000);
  });

  await t.test('queryRelations with limit: 50 returns 50', () => {
    const results = queryRelations({ limit: 50 });
    assert.strictEqual(results.length, 50);
  });

  closeGraph();
});
