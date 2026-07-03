import test from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import {
  computeTrustScore,
  trustWeightedConfidence,
  ensureTrustLedger,
  recordTrustEvent,
  readTrustStats,
  getAgentTrust,
  listAgentTrust,
} from '../src/fabric/trust.ts';

test('Memory Trust Ledger', async (t) => {
  await t.test('new agents start neutral at 0.5', () => {
    assert.strictEqual(computeTrustScore({ successes: 0, failures: 0 }), 0.5);
  });

  await t.test('trust rises with promotions and falls with deprecations', () => {
    const good = computeTrustScore({ successes: 20, failures: 1 });
    const bad = computeTrustScore({ successes: 1, failures: 20 });
    assert.ok(good > 0.8, `reliable agent should exceed 0.8, got ${good}`);
    assert.ok(bad < 0.2, `polluting agent should fall below 0.2, got ${bad}`);
  });

  await t.test('the prior dampens small samples (one failure is not a death sentence)', () => {
    const oneFailure = computeTrustScore({ successes: 0, failures: 1 });
    assert.ok(oneFailure >= 0.4, `single failure keeps trust near neutral, got ${oneFailure}`);
  });

  await t.test('neutral trust leaves confidence untouched; extremes move it ±30%', () => {
    assert.ok(Math.abs(trustWeightedConfidence(0.9, 0.5) - 0.9) < 1e-9);
    assert.ok(Math.abs(trustWeightedConfidence(0.5, 1.0) - 0.65) < 1e-9);
    assert.ok(Math.abs(trustWeightedConfidence(0.5, 0.0) - 0.35) < 1e-9);
    // Never exceeds 1
    assert.strictEqual(trustWeightedConfidence(0.95, 1.0), 1);
  });

  await t.test('ledger persists and aggregates events per agent', () => {
    const db = new Database(':memory:');
    ensureTrustLedger(db);

    recordTrustEvent(db, 'hermes_agent', 'memory_promoted', 'p1');
    recordTrustEvent(db, 'hermes_agent', 'memory_promoted', 'p2');
    recordTrustEvent(db, 'hermes_agent', 'memory_deprecated', 'facts/old.md');
    recordTrustEvent(db, 'gemini_cli', 'memory_quarantined', 'p9');

    assert.deepStrictEqual(readTrustStats(db, 'hermes_agent'), { successes: 2, failures: 1 });
    assert.deepStrictEqual(readTrustStats(db, 'gemini_cli'), { successes: 0, failures: 1 });

    const hermes = getAgentTrust(db, 'hermes_agent');
    const gemini = getAgentTrust(db, 'gemini_cli');
    assert.ok(hermes > gemini, 'the promoted agent must outrank the quarantined one');

    const board = listAgentTrust(db);
    assert.strictEqual(board.length, 2);
    assert.ok(board.find(b => b.sourceClient === 'hermes_agent')!.trust === hermes);

    db.close();
  });

  await t.test('unknown agents read as neutral without any rows', () => {
    const db = new Database(':memory:');
    ensureTrustLedger(db);
    assert.strictEqual(getAgentTrust(db, 'never_seen'), 0.5);
    db.close();
  });
});
