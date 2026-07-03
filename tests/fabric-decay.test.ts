import test from 'node:test';
import assert from 'node:assert';
import { retention, effectiveConfidence, STABILITY_DAYS, DECAY_EXCLUSION_FLOOR } from '../src/fabric/decay.ts';
import { isContextEligible, ACTIVE_ELIGIBILITY_THRESHOLD } from '../src/fabric/policy.ts';
import { assembleContextPack } from '../src/fabric/context-pack.ts';
import type { MemoryCandidate, ContextPackRequest } from '../src/fabric/types.ts';

test('Temporal Decay (Ebbinghaus) — R2', async (t) => {
  await t.test('retention is 1 at age zero and decays monotonically', () => {
    assert.strictEqual(retention('semantic', 0), 1);
    const day1 = retention('semantic', 1);
    const day30 = retention('semantic', 30);
    const day90 = retention('semantic', 90);
    assert.ok(day1 < 1 && day30 < day1 && day90 < day30);
    // At age == stability, retention is exactly 1/e
    assert.ok(Math.abs(day30 - Math.exp(-1)) < 1e-9);
  });

  await t.test('episodic decays faster than procedural; failure is the most stable', () => {
    const ageDays = 30;
    assert.ok(retention('episodic', ageDays) < retention('semantic', ageDays));
    assert.ok(retention('semantic', ageDays) < retention('procedural', ageDays));
    assert.ok(retention('procedural', ageDays) < retention('failure', ageDays));
    assert.strictEqual(STABILITY_DAYS.failure, 180);
  });

  await t.test('effectiveConfidence multiplies declared confidence by retention', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const fresh = effectiveConfidence(
      { kind: 'semantic', confidence: 0.9, validFrom: '2026-07-01T00:00:00Z' }, now
    );
    assert.ok(Math.abs(fresh - 0.9) < 1e-9);

    const monthOld = effectiveConfidence(
      { kind: 'semantic', confidence: 0.9, validFrom: '2026-06-01T00:00:00Z' }, now
    );
    assert.ok(monthOld < 0.9 && monthOld > 0.2);
  });

  await t.test('invalid validFrom degrades gracefully to declared confidence', () => {
    const value = effectiveConfidence(
      { kind: 'semantic', confidence: 0.7, validFrom: 'not-a-date' }
    );
    assert.strictEqual(value, 0.7);
  });
});

test('Active-memory escalation — INCOHÉRENCE #8', async (t) => {
  await t.test('verified is always eligible', () => {
    assert.strictEqual(isContextEligible('verified'), true);
    assert.strictEqual(isContextEligible('verified', 0.01), true);
  });

  await t.test('active is eligible only above the effective-confidence threshold', () => {
    assert.strictEqual(isContextEligible('active', ACTIVE_ELIGIBILITY_THRESHOLD), true);
    assert.strictEqual(isContextEligible('active', 0.95), true);
    assert.strictEqual(isContextEligible('active', 0.5), false);
    assert.strictEqual(isContextEligible('active'), false, 'no confidence means no escalation');
  });

  await t.test('quarantined/superseded/proposed never escalate', () => {
    for (const status of ['quarantined', 'superseded', 'proposed', 'deprecated']) {
      assert.strictEqual(isContextEligible(status, 1.0), false);
    }
  });
});

test('Context pack integrates decay and escalation', async (t) => {
  const now = new Date('2026-07-01T00:00:00Z');
  const request: ContextPackRequest = {
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

  const makeMemory = (overrides: Partial<MemoryCandidate>): MemoryCandidate => ({
    id: 'm1',
    namespace: 'personal',
    kind: 'semantic',
    status: 'active',
    content: 'test',
    confidence: 0.9,
    provenance: { source: 'a', sourceClient: 'hermes_agent', capturedAt: '2026-06-30' },
    riskFlags: [],
    validFrom: '2026-06-30T00:00:00Z',
    validTo: null,
    ...overrides
  });

  await t.test('fresh high-confidence ACTIVE memory is auto-included (no human bottleneck)', () => {
    const memory = makeMemory({ id: 'fresh_active' });
    const response = assembleContextPack(request, [memory], now);

    assert.strictEqual(response.items.length, 1);
    assert.strictEqual(response.items[0].memoryId, 'fresh_active');
    assert.match(response.items[0].whyIncluded, /Auto-escalated/);
    assert.ok(response.items[0].effectiveConfidence! >= ACTIVE_ELIGIBILITY_THRESHOLD);
  });

  await t.test('stale ACTIVE memory falls below threshold and is excluded', () => {
    const memory = makeMemory({ id: 'stale_active', validFrom: '2025-07-01T00:00:00Z' });
    const response = assembleContextPack(request, [memory], now);

    assert.strictEqual(response.items.length, 0);
    assert.match(response.excluded[0].reason, /not eligible/);
  });

  await t.test('failure scar tissue survives even when fully decayed (if verified)', () => {
    const memory = makeMemory({
      id: 'old_failure',
      kind: 'failure',
      status: 'verified',
      validFrom: '2020-01-01T00:00:00Z',
      confidence: 0.3
    });
    const response = assembleContextPack(request, [memory], now);
    assert.strictEqual(response.items.length, 1, 'failure memories are never silently dropped');
  });

  await t.test('items sort by EFFECTIVE confidence within the same kind rank', () => {
    // Older but higher declared confidence vs fresher lower confidence
    const older = makeMemory({ id: 'older', confidence: 0.95, validFrom: '2026-05-01T00:00:00Z', status: 'verified' });
    const fresher = makeMemory({ id: 'fresher', confidence: 0.85, validFrom: '2026-06-30T00:00:00Z', status: 'verified' });
    const response = assembleContextPack(request, [older, fresher], now);

    assert.strictEqual(response.items.length, 2);
    // older: 0.95 * e^(-61/30) ≈ 0.124 ; fresher: 0.85 * e^(-1/30) ≈ 0.822
    assert.strictEqual(response.items[0].memoryId, 'fresher');
    assert.strictEqual(response.items[1].memoryId, 'older');
  });

  await t.test('decayed-to-noise non-verified memories are cut at the floor', () => {
    // active + episodic, 60 days old: 0.9 * e^(-60/7) ≈ 0.00017 < floor
    const memory = makeMemory({ id: 'noise', kind: 'episodic', validFrom: '2026-05-02T00:00:00Z' });
    const response = assembleContextPack(request, [memory], now);
    assert.strictEqual(response.items.length, 0);
    assert.ok(DECAY_EXCLUSION_FLOOR > 0);
  });
});
