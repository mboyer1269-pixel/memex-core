import test from 'node:test';
import assert from 'node:assert';
import {
  initGraph, closeGraph, addEntity, addRelation, getEntity,
  findSupersededEntities, getTimeline
} from '../src/graph.ts';

const NS = 'org:supersede_test';

function seedChain() {
  initGraph(':memory:');
  // v3 SUPERSEDES v2 SUPERSEDES v1 ; unrelated entity untouched
  addEntity({ id: 'v1', type: 'Decision', namespace: NS, name: 'Old decision' });
  addEntity({ id: 'v2', type: 'Decision', namespace: NS, name: 'Mid decision' });
  addEntity({ id: 'v3', type: 'Decision', namespace: NS, name: 'New decision' });
  addEntity({ id: 'other', type: 'Decision', namespace: NS, name: 'Unrelated' });
  addRelation({ type: 'SUPERSEDES', sourceId: 'v3', targetId: 'v2', namespace: NS });
  addRelation({ type: 'SUPERSEDES', sourceId: 'v2', targetId: 'v1', namespace: NS });
}

test('Graph SUPERSEDES BFS — R4 (deterministic forgetting)', async (t) => {
  await t.test('transitively finds and marks the whole superseded chain', () => {
    seedChain();
    const superseded = findSupersededEntities('v3', NS);

    assert.deepStrictEqual(superseded.sort(), ['v1', 'v2']);

    const v2 = getEntity('v2')!;
    const v1 = getEntity('v1')!;
    assert.strictEqual(v2.properties?.status, 'superseded');
    assert.strictEqual(v2.properties?.supersededBy, 'v3');
    assert.ok(v2.validTo, 'validTo closed');
    assert.strictEqual(v1.properties?.status, 'superseded');

    const other = getEntity('other')!;
    assert.strictEqual(other.validTo ?? null, null, 'unrelated entity untouched');
    closeGraph();
  });

  await t.test('apply=false is a dry run', () => {
    seedChain();
    const superseded = findSupersededEntities('v3', NS, { apply: false });
    assert.deepStrictEqual(superseded.sort(), ['v1', 'v2']);
    assert.strictEqual(getEntity('v2')!.validTo ?? null, null, 'dry run must not mutate');
    closeGraph();
  });

  await t.test('survives SUPERSEDES cycles without infinite loop', () => {
    initGraph(':memory:');
    addEntity({ id: 'a', type: 'Decision', namespace: NS });
    addEntity({ id: 'b', type: 'Decision', namespace: NS });
    addRelation({ type: 'SUPERSEDES', sourceId: 'a', targetId: 'b', namespace: NS });
    addRelation({ type: 'SUPERSEDES', sourceId: 'b', targetId: 'a', namespace: NS });

    const superseded = findSupersededEntities('a', NS);
    assert.deepStrictEqual(superseded, ['b'], 'cycle back to the start entity is ignored');
    closeGraph();
  });

  await t.test('respects namespace isolation', () => {
    initGraph(':memory:');
    addEntity({ id: 'x1', type: 'Decision', namespace: NS });
    addEntity({ id: 'x2', type: 'Decision', namespace: NS });
    addRelation({ type: 'SUPERSEDES', sourceId: 'x1', targetId: 'x2', namespace: NS });

    const wrongNs = findSupersededEntities('x1', 'org:other_tenant');
    assert.deepStrictEqual(wrongNs, [], 'relations in other namespaces are invisible');
    closeGraph();
  });
});

test('getTimeline pagination — BUG #5', async (t) => {
  await t.test('honors limit, offset, since and type', () => {
    initGraph(':memory:');
    for (let i = 0; i < 10; i++) {
      addEntity({
        id: `e${i}`,
        type: i % 2 === 0 ? 'Task' : 'Decision',
        namespace: NS,
        name: `Entity ${i}`,
        createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`
      });
    }

    // limit
    assert.strictEqual(getTimeline(NS, { limit: 3 }).length, 3);

    // default is still 50 max, newest first
    const all = getTimeline(NS);
    assert.strictEqual(all.length, 10);
    assert.strictEqual(all[0].id, 'e9');

    // offset paginates
    const page2 = getTimeline(NS, { limit: 4, offset: 4 });
    assert.strictEqual(page2.length, 4);
    assert.strictEqual(page2[0].id, 'e5');

    // since filters by createdAt
    const recent = getTimeline(NS, { since: '2026-01-08T00:00:00Z' });
    assert.deepStrictEqual(recent.map(e => e.id), ['e9', 'e8', 'e7']);

    // type filter
    const tasks = getTimeline(NS, { type: 'Task' });
    assert.ok(tasks.every(e => e.type === 'Task'));
    assert.strictEqual(tasks.length, 5);

    closeGraph();
  });
});
