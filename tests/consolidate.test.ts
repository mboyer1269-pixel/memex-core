import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VAULT = path.resolve(__dirname, '../data/vault_sleep_test_' + process.pid);

// Must be set BEFORE the vault module is imported (module-level VAULT_ROOT)
process.env.AGENTMEMORY_VAULT_PATH = TEST_VAULT;

const { runSleepCycle, inferKind, SURVIVAL_REVIEW_AGE_DAYS } = await import('../src/ai/consolidate.ts');
const { readVaultFile } = await import('../src/vault/index.ts');
const { readTrustStats, ensureTrustLedger } = await import('../src/fabric/trust.ts');

const NOW = new Date('2026-07-01T00:00:00Z');

function writeRaw(rel: string, meta: Record<string, string | number | string[]>, body: string) {
  const full = path.join(TEST_VAULT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map(x => `"${x}"`).join(', ')}]`);
    else if (typeof v === 'number') lines.push(`${k}: ${v}`);
    else lines.push(`${k}: "${v}"`);
  }
  lines.push('---', '', body);
  fs.writeFileSync(full, lines.join('\n'), 'utf8');
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function cleanup() {
  if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true, force: true });
}

describe('Sleep Cycle — memory consolidation', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    cleanup();
    db = new Database(':memory:');
    ensureTrustLedger(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it('credits memory_survived for durable active memories, exactly once', () => {
    writeRaw('Agent/facts/durable.md', {
      created_at: daysAgo(30),
      updated_at: daysAgo(5),
      confidence: 0.9,
      source_session: 'hermes_agent',
      status: 'active'
    }, '# Durable fact');

    const report1 = runSleepCycle(db, { now: NOW });
    assert.deepEqual(report1.survived, ['Agent/facts/durable.md']);
    assert.deepEqual(readTrustStats(db, 'hermes_agent'), { successes: 1, failures: 0 });

    // Idempotent within the same period: second pass credits nothing
    const report2 = runSleepCycle(db, { now: NOW });
    assert.equal(report2.survived.length, 0);
    assert.deepEqual(readTrustStats(db, 'hermes_agent'), { successes: 1, failures: 0 });
  });

  it('re-credits legitimately after a FULL new survival period (Q2)', () => {
    writeRaw('Agent/facts/veteran.md', {
      created_at: daysAgo(30),
      updated_at: daysAgo(5),
      confidence: 0.9,
      source_session: 'hermes_agent',
      status: 'active'
    }, '# Veteran fact');

    runSleepCycle(db, { now: NOW });
    assert.deepEqual(readTrustStats(db, 'hermes_agent'), { successes: 1, failures: 0 });

    // 7 days later: period not elapsed → no new credit
    const midPeriod = new Date(NOW.getTime() + 7 * 86_400_000);
    const reportMid = runSleepCycle(db, { now: midPeriod });
    assert.equal(reportMid.survived.length, 0);

    // 14 days after the first credit: a full period elapsed → second credit.
    // Refresh updated_at so decay doesn't prune the file first.
    writeRaw('Agent/facts/veteran.md', {
      created_at: daysAgo(30),
      updated_at: new Date(NOW.getTime() + 13 * 86_400_000).toISOString(),
      confidence: 0.9,
      source_session: 'hermes_agent',
      status: 'active'
    }, '# Veteran fact');
    const nextPeriod = new Date(NOW.getTime() + 14 * 86_400_000);
    const reportNext = runSleepCycle(db, { now: nextPeriod });
    assert.deepEqual(reportNext.survived, ['Agent/facts/veteran.md']);
    assert.deepEqual(readTrustStats(db, 'hermes_agent'), { successes: 2, failures: 0 });
  });

  it('no quasi-survival loop: a pruned file stays pruned despite the rewrite bumping updated_at (Q1)', () => {
    writeRaw('Agent/facts/zombie.md', {
      created_at: daysAgo(220),
      updated_at: daysAgo(200),
      confidence: 0.9,
      source_session: 'gemini_cli',
      status: 'active'
    }, '# Should stay dead');

    const first = runSleepCycle(db, { now: NOW });
    assert.deepEqual(first.forgotten, ['Agent/facts/zombie.md']);

    // The deprecation rewrite refreshed updated_at — but the file is now
    // `deprecated`, so every future cycle must skip it entirely.
    const second = runSleepCycle(db, { now: new Date(NOW.getTime() + 30 * 86_400_000) });
    assert.equal(second.forgotten.length, 0);
    assert.equal(second.survived.length, 0);
    assert.ok(readVaultFile('Agent/facts/zombie.md').includes('status: "deprecated"'));
  });

  it('does not credit memories younger than the review age', () => {
    writeRaw('Agent/facts/young.md', {
      created_at: daysAgo(SURVIVAL_REVIEW_AGE_DAYS - 1),
      updated_at: daysAgo(1),
      confidence: 0.9,
      source_session: 'hermes_agent',
      status: 'active'
    }, '# Too young');

    const report = runSleepCycle(db, { now: NOW });
    assert.equal(report.survived.length, 0);
  });

  it('forgets active memories decayed below the floor, preserving metadata', () => {
    // semantic S=30d; 200 days stale: 0.9 * e^(-200/30) ≈ 0.0011 < 0.1
    writeRaw('Agent/facts/stale.md', {
      created_at: daysAgo(220),
      updated_at: daysAgo(200),
      confidence: 0.9,
      source_session: 'gemini_cli',
      status: 'active',
      tags: ['project:oria']
    }, '# Stale fact');

    const report = runSleepCycle(db, { now: NOW });
    assert.deepEqual(report.forgotten, ['Agent/facts/stale.md']);

    const after = readVaultFile('Agent/facts/stale.md');
    assert.ok(after.includes('status: "deprecated"'));
    assert.ok(after.includes('"deprecated_by:sleep_cycle"'));
    assert.ok(after.includes('confidence: 0.9'), 'confidence preserved by merge');
    assert.ok(after.includes('source_session: "gemini_cli"'), 'author preserved');
    assert.ok(after.includes('"project:oria"'), 'original tags preserved');
    assert.ok(after.includes('# Stale fact'), 'body preserved');

    // A forgotten memory earns no survival credit
    assert.equal(report.survived.length, 0);
  });

  it('a recently refreshed memory is not forgotten (decay anchors on updated_at)', () => {
    writeRaw('Agent/facts/refreshed.md', {
      created_at: daysAgo(300),
      updated_at: daysAgo(2),
      confidence: 0.9,
      source_session: 'hermes_agent',
      status: 'active'
    }, '# Kept fresh');

    const report = runSleepCycle(db, { now: NOW });
    assert.equal(report.forgotten.length, 0);
    assert.deepEqual(report.survived, ['Agent/facts/refreshed.md']);
  });

  it('never touches verified doctrine or failure scar tissue', () => {
    writeRaw('Agent/facts/doctrine.md', {
      created_at: daysAgo(400),
      updated_at: daysAgo(400),
      confidence: 0.9,
      source_session: 'oria_hq',
      status: 'verified'
    }, '# Human-approved doctrine');

    writeRaw('Agent/facts/scar.md', {
      created_at: daysAgo(400),
      updated_at: daysAgo(400),
      confidence: 0.9,
      source_session: 'hermes_agent',
      status: 'active',
      tags: ['failure']
    }, '# Never deploy on Fridays');

    const report = runSleepCycle(db, { now: NOW });
    assert.equal(report.forgotten.length, 0, 'neither file may be forgotten');
    assert.ok(readVaultFile('Agent/facts/doctrine.md').includes('status: "verified"'));
    assert.ok(readVaultFile('Agent/facts/scar.md').includes('status: "active"'));
    // The failure memory still earns survival credit for its author
    assert.deepEqual(report.survived, ['Agent/facts/scar.md']);
  });

  it('skips files without frontmatter and non-active statuses', () => {
    fs.mkdirSync(path.join(TEST_VAULT, 'Agent/facts'), { recursive: true });
    fs.writeFileSync(path.join(TEST_VAULT, 'Agent/facts/raw.md'), '# No frontmatter at all', 'utf8');
    writeRaw('Agent/facts/gone.md', {
      created_at: daysAgo(100),
      updated_at: daysAgo(100),
      confidence: 0.9,
      source_session: 'x',
      status: 'deprecated'
    }, '# Already out');

    const report = runSleepCycle(db, { now: NOW });
    assert.equal(report.forgotten.length, 0);
    assert.equal(report.survived.length, 0);
    assert.equal(report.skipped, 2);
  });

  it('infers kind from tags first, then vault zone', () => {
    assert.equal(inferKind('Agent/facts/x.md', ['failure']), 'failure');
    assert.equal(inferKind('Agent/skills/deploy.md', []), 'procedural');
    assert.equal(inferKind('Agent/state/current.md', []), 'episodic');
    assert.equal(inferKind('Agent/facts/x.md', []), 'semantic');
  });

  it('explicit kind: frontmatter overrides zone inference (Q3)', () => {
    assert.equal(inferKind('Agent/state/PROJECT.md', [], 'semantic'), 'semantic');
    assert.equal(inferKind('Agent/facts/x.md', ['episodic'], 'procedural'), 'procedural');
    // Invalid explicit kind falls back to normal inference
    assert.equal(inferKind('Agent/state/current.md', [], 'banana'), 'episodic');

    // End-to-end: a long-lived project file in state/ declaring kind: semantic
    // survives an age that would have pruned it under episodic decay
    // (episodic S=7d: 0.9*e^(-20/7) ≈ 0.05 < 0.1 → pruned;
    //  semantic S=30d: 0.9*e^(-20/30) ≈ 0.46 → kept)
    writeRaw('Agent/state/PROJECT.md', {
      created_at: daysAgo(20), updated_at: daysAgo(20),
      confidence: 0.9, source_session: 'oria_hq', status: 'active',
      kind: 'semantic'
    }, '# Long-term project');
    writeRaw('Agent/state/scratch.md', {
      created_at: daysAgo(20), updated_at: daysAgo(20),
      confidence: 0.9, source_session: 'oria_hq', status: 'active'
    }, '# Untagged state note');

    const report = runSleepCycle(db, { now: NOW });
    assert.deepEqual(report.forgotten, ['Agent/state/scratch.md']);
    assert.ok(readVaultFile('Agent/state/PROJECT.md').includes('status: "active"'));
  });

  it('procedural skills outlive semantic facts at the same staleness', () => {
    // 80 days stale, confidence 0.9:
    //   semantic  S=30 → 0.9*e^(-80/30) ≈ 0.063 < 0.1  → forgotten
    //   procedural S=90 → 0.9*e^(-80/90) ≈ 0.37  ≥ 0.1 → kept
    writeRaw('Agent/facts/fact80.md', {
      created_at: daysAgo(80), updated_at: daysAgo(80),
      confidence: 0.9, source_session: 'a', status: 'active'
    }, '# fact');
    writeRaw('Agent/skills/sop80.md', {
      created_at: daysAgo(80), updated_at: daysAgo(80),
      confidence: 0.9, source_session: 'a', status: 'active'
    }, '# sop');

    const report = runSleepCycle(db, { now: NOW });
    assert.deepEqual(report.forgotten, ['Agent/facts/fact80.md']);
    assert.ok(report.survived.includes('Agent/skills/sop80.md'));
  });
});
