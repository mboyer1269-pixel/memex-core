import test from 'node:test';
import assert from 'node:assert';
import { assembleContextPack } from '../src/fabric/context-pack.ts';
import type { MemoryCandidate, ContextPackRequest } from '../src/fabric/types.ts';

test('Fabric Context Pack', async (t) => {
  const baseRequest: ContextPackRequest = {
    requester: {
      clientKind: 'hermes_agent',
      scope: 'read_only',
      namespace: 'personal',
      tokenId: 't1',
      requestedMode: 'read'
    },
    packKind: 'test_pack',
    namespace: 'personal',
    maxItems: 10
  };

  const createMemory = (overrides: Partial<MemoryCandidate>): MemoryCandidate => ({
    id: 'm1',
    namespace: 'personal',
    kind: 'semantic',
    status: 'verified',
    content: 'test',
    confidence: 0.9,
    provenance: { source: 'a', sourceClient: 'hermes_agent', capturedAt: '2020-01-01' },
    riskFlags: [],
    validFrom: '2020-01-01',
    validTo: null,
    ...overrides
  });

  await t.test('active memory is excluded from context', () => {
    const memory = createMemory({ status: 'active' });
    const response = assembleContextPack(baseRequest, [memory]);
    
    assert.strictEqual(response.items.length, 0);
    assert.strictEqual(response.excluded.length, 1);
    assert.strictEqual(response.excluded[0].memoryId, 'm1');
    assert.match(response.excluded[0].reason, /not eligible/);
  });

  await t.test('proposed/deprecated/superseded/quarantined are excluded', () => {
    for (const status of ['proposed', 'deprecated', 'superseded', 'quarantined'] as const) {
      const memory = createMemory({ id: `m_${status}`, status });
      const response = assembleContextPack(baseRequest, [memory]);
      
      assert.strictEqual(response.items.length, 0);
      assert.strictEqual(response.excluded.length, 1);
      assert.strictEqual(response.excluded[0].memoryId, `m_${status}`);
    }
  });

  await t.test('cross-namespace memory is excluded', () => {
    const memory = createMemory({ namespace: 'oria' });
    const response = assembleContextPack(baseRequest, [memory]);
    
    assert.strictEqual(response.items.length, 0);
    assert.strictEqual(response.excluded.length, 1);
    assert.match(response.excluded[0].reason, /Cross-namespace/);
  });

  await t.test('expired memory is excluded', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    const memory = createMemory({ validTo: '2025-01-01T00:00:00Z' });
    const response = assembleContextPack(baseRequest, [memory], now);
    
    assert.strictEqual(response.items.length, 0);
    assert.strictEqual(response.excluded.length, 1);
    assert.match(response.excluded[0].reason, /expired/);
  });

  await t.test('context pack includes required explainability fields', () => {
    const memory = createMemory({ id: 'm1' });
    const response = assembleContextPack(baseRequest, [memory]);
    
    assert.strictEqual(response.items.length, 1);
    const item = response.items[0];
    assert.ok(item.whyIncluded, 'whyIncluded should exist');
    assert.strictEqual(item.source, 'a');
    assert.strictEqual(item.confidence, 0.9);
    assert.strictEqual(item.status, 'verified');
    assert.deepStrictEqual(item.riskFlags, []);
    assert.strictEqual(item.validFrom, '2020-01-01');
    assert.strictEqual(item.validTo, null);
    assert.strictEqual(item.revocationPath, 'fabric://personal/memories/m1/revoke');
  });

  await t.test('context pack records exclusions with reasons', () => {
    const mem1 = createMemory({ id: 'm1', status: 'verified' }); // included
    const mem2 = createMemory({ id: 'm2', status: 'active' }); // excluded
    const response = assembleContextPack(baseRequest, [mem1, mem2]);
    
    assert.strictEqual(response.items.length, 1);
    assert.strictEqual(response.excluded.length, 1);
    assert.strictEqual(response.excluded[0].memoryId, 'm2');
    assert.match(response.excluded[0].reason, /not eligible/);
  });

  await t.test('failure memory ranks before decision and semantic memory', () => {
    const memSemantic = createMemory({ id: 'm_sem', kind: 'semantic', confidence: 0.99 });
    const memDecision = createMemory({ id: 'm_dec', kind: 'decision', confidence: 0.1 });
    const memFailure = createMemory({ id: 'm_fail', kind: 'failure', confidence: 0.1 }); // Should still rank first despite low confidence
    const memEpisodic = createMemory({ id: 'm_epi', kind: 'episodic', confidence: 0.95 }); // Ties semantic kind, so sorts by confidence

    const response = assembleContextPack(baseRequest, [memSemantic, memDecision, memFailure, memEpisodic]);
    
    assert.strictEqual(response.items.length, 4);
    assert.strictEqual(response.items[0].memoryId, 'm_fail');
    assert.strictEqual(response.items[1].memoryId, 'm_dec');
    assert.strictEqual(response.items[2].memoryId, 'm_sem'); // 0.99 confidence comes before 0.95
    assert.strictEqual(response.items[3].memoryId, 'm_epi');
  });
});
