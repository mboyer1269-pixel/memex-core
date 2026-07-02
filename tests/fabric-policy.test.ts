import test from 'node:test';
import assert from 'node:assert';
import {
  decideAccess,
  intersectScopes,
  admitMemory,
  isContextEligible,
  effectiveScope
} from '../src/fabric/policy.ts';
import type { MemoryCandidate } from '../src/fabric/types.ts';

test('Fabric Policy', async (t) => {
  await t.test('unknown client denies every mode with every scope', () => {
    const modes = ['read', 'propose', 'write', 'admin'] as const;
    const scopes = ['read_only', 'propose_only', 'read_propose', 'write', 'admin', 'none'] as const;

    for (const mode of modes) {
      for (const scope of scopes) {
        const decision = decideAccess({
          clientKind: 'unknown',
          scope,
          namespace: 'personal',
          tokenId: 't1',
          requestedMode: mode
        });
        assert.strictEqual(decision.allowed, false);
      }
    }
  });

  await t.test('read_only can read but cannot propose/write/admin', () => {
    const ctx = {
      clientKind: 'hermes_agent' as const,
      scope: 'read_only' as const,
      namespace: 'personal' as const,
      tokenId: 't1'
    };
    
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'read' }).allowed, true);
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'propose' }).allowed, false);
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'write' }).allowed, false);
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'admin' }).allowed, false);
  });

  await t.test('propose_only can propose but cannot read/write/admin', () => {
    const ctx = {
      clientKind: 'hermes_agent' as const,
      scope: 'propose_only' as const,
      namespace: 'personal' as const,
      tokenId: 't1'
    };
    
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'read' }).allowed, false);
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'propose' }).allowed, true);
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'write' }).allowed, false);
    assert.strictEqual(decideAccess({ ...ctx, requestedMode: 'admin' }).allowed, false);
  });

  await t.test('chatgpt_android + propose_only cannot propose', () => {
    const decision = decideAccess({
      clientKind: 'chatgpt_android',
      scope: 'propose_only',
      namespace: 'personal',
      tokenId: 't1',
      requestedMode: 'propose'
    });
    assert.strictEqual(decision.allowed, false);
  });

  await t.test('gemini_android + propose_only cannot propose', () => {
    const decision = decideAccess({
      clientKind: 'gemini_android',
      scope: 'propose_only',
      namespace: 'personal',
      tokenId: 't1',
      requestedMode: 'propose'
    });
    assert.strictEqual(decision.allowed, false);
  });

  await t.test('chatgpt_android + read_propose can read but cannot propose', () => {
    const readDecision = decideAccess({
      clientKind: 'chatgpt_android',
      scope: 'read_propose',
      namespace: 'personal',
      tokenId: 't1',
      requestedMode: 'read'
    });
    const proposeDecision = decideAccess({
      clientKind: 'chatgpt_android',
      scope: 'read_propose',
      namespace: 'personal',
      tokenId: 't1',
      requestedMode: 'propose'
    });
    assert.strictEqual(readDecision.allowed, true);
    assert.strictEqual(proposeDecision.allowed, false);
  });

  await t.test('read_only ∩ propose_only = none both directions', () => {
    assert.strictEqual(intersectScopes('read_only', 'propose_only'), 'none');
    assert.strictEqual(intersectScopes('propose_only', 'read_only'), 'none');
  });

  await t.test('admin ∩ read_only = read_only', () => {
    assert.strictEqual(intersectScopes('admin', 'read_only'), 'read_only');
    assert.strictEqual(intersectScopes('read_only', 'admin'), 'read_only');
  });

  await t.test('write ∩ read_propose = read_propose', () => {
    assert.strictEqual(intersectScopes('write', 'read_propose'), 'read_propose');
    assert.strictEqual(intersectScopes('read_propose', 'write'), 'read_propose');
  });

  await t.test('missing provenance requires review and caps confidence to 0.4', () => {
    const candidate: MemoryCandidate = {
      id: 'm1',
      namespace: 'personal',
      kind: 'semantic',
      status: 'proposed',
      content: 'test',
      confidence: 0.9,
      provenance: null,
      riskFlags: [],
      validFrom: '2020-01-01',
      validTo: null
    };
    
    const decision = admitMemory(candidate);
    assert.strictEqual(decision.outcome, 'requires_review');
    assert.strictEqual(decision.adjustedConfidence, 0.4);
  });

  await t.test('secret material rejects memory', () => {
    const candidate: MemoryCandidate = {
      id: 'm1',
      namespace: 'personal',
      kind: 'semantic',
      status: 'proposed',
      content: 'test',
      confidence: 0.9,
      provenance: { source: 'a', sourceClient: 'hermes_agent', capturedAt: '2020-01-01' },
      riskFlags: ['secret_material'],
      validFrom: '2020-01-01',
      validTo: null
    };
    
    const decision = admitMemory(candidate);
    assert.strictEqual(decision.outcome, 'reject');
  });

  await t.test('high-risk memory is not auto-admitted', () => {
    const candidate: MemoryCandidate = {
      id: 'm1',
      namespace: 'personal',
      kind: 'semantic',
      status: 'proposed',
      content: 'test',
      confidence: 0.9,
      provenance: { source: 'a', sourceClient: 'hermes_agent', capturedAt: '2020-01-01' },
      riskFlags: ['cross_namespace_leak'],
      validFrom: '2020-01-01',
      validTo: null
    };
    
    const decision = admitMemory(candidate);
    assert.strictEqual(decision.outcome, 'requires_review');
  });

  await t.test('only verified memory is injectable', () => {
    assert.strictEqual(isContextEligible('verified'), true);
    assert.strictEqual(isContextEligible('active'), false);
    assert.strictEqual(isContextEligible('proposed'), false);
    assert.strictEqual(isContextEligible('deprecated'), false);
  });
});
