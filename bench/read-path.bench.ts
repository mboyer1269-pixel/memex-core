/**
 * Read-path benchmark — the "zero token" proof.
 * ----------------------------------------------
 * Memex Core's core claim is that agents READ memory without any LLM call:
 * FTS5 (BM25 x confidence x temporal decay) over the Markdown vault. This
 * benchmark makes that claim measurable and reproducible:
 *
 *   npm run bench            # default: 1000 notes, 50 queries
 *   BENCH_NOTES=5000 npm run bench
 *
 * Reported:
 *   - initial index build time (cold start)
 *   - warm search latency p50 / p95 / max
 *   - incremental re-sync cost after touching 1 file
 *   - LLM calls on the read path: 0 by construction (no network module is
 *     even imported by vault/fts-index)
 *
 * Honesty note: this is a SELF-benchmark of Memex Core's read path on your
 * machine. It is not a head-to-head against Mem0/Zep/Letta — those are
 * hosted services with different trade-offs; comparing fairly would require
 * their infrastructure. What this proves: local reads are fast and free.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The vault module resolves AGENTMEMORY_VAULT_PATH at import time — set it
// BEFORE any dynamic import below.
const BENCH_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-bench-'));
process.env.AGENTMEMORY_VAULT_PATH = BENCH_VAULT;

const NOTE_COUNT = Number(process.env.BENCH_NOTES) || 1000;
const QUERY_COUNT = Number(process.env.BENCH_QUERIES) || 50;

const TOPICS = [
  'deployment pipeline vercel edge cache',
  'postgres migration schema drift neon',
  'stripe webhook retry idempotency billing',
  'oauth token refresh session expiry',
  'obsidian vault sync markdown frontmatter',
  'sqlite wal checkpoint busy timeout',
  'mcp transport stateless json rpc handle',
  'ebbinghaus decay confidence retention memory',
  'trust ledger bayesian agent reputation',
  'sleep cycle consolidation survival pruning'
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function fmt(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

async function main(): Promise<void> {
  const { writeVaultFile, searchVault } = await import('../src/vault/index.ts');

  // ── Seed ────────────────────────────────────────────────────────────
  console.log(`\nSeeding ${NOTE_COUNT} notes into a temp vault...`);
  const seedStart = performance.now();
  for (let i = 0; i < NOTE_COUNT; i++) {
    const topic = TOPICS[i % TOPICS.length];
    writeVaultFile(
      `Agent/facts/bench-${i}.md`,
      `# Fact ${i}\n\nOperational note about ${topic}. ` +
      `Detail ${i}: the ${topic.split(' ')[0]} configuration requires attention to item ${i % 97}.`,
      { confidence: 0.5 + (i % 50) / 100, tags: [`topic:${i % TOPICS.length}`] }
    );
  }
  console.log(`Seeded in ${fmt(performance.now() - seedStart)}`);

  // ── Cold start: first search builds the FTS index ───────────────────
  const coldStart = performance.now();
  const coldResults = searchVault('deployment pipeline');
  const coldMs = performance.now() - coldStart;
  console.log(`\nCold start (index build + first search): ${fmt(coldMs)} — ${coldResults.length} hits`);

  // ── Warm searches ────────────────────────────────────────────────────
  const latencies: number[] = [];
  for (let q = 0; q < QUERY_COUNT; q++) {
    const query = TOPICS[q % TOPICS.length].split(' ').slice(0, 2).join(' ');
    const t0 = performance.now();
    searchVault(query);
    latencies.push(performance.now() - t0);
  }
  latencies.sort((a, b) => a - b);

  console.log(`\nWarm search over ${NOTE_COUNT} notes (${QUERY_COUNT} queries):`);
  console.log(`  p50: ${fmt(percentile(latencies, 50))}`);
  console.log(`  p95: ${fmt(percentile(latencies, 95))}`);
  console.log(`  max: ${fmt(latencies[latencies.length - 1])}`);

  // ── Incremental sync: touch one file, search again ──────────────────
  writeVaultFile(
    'Agent/facts/bench-0.md',
    '# Fact 0 (updated)\n\nRefreshed operational note about deployment pipeline vercel edge cache.',
    { confidence: 0.99 }
  );
  const incStart = performance.now();
  searchVault('deployment pipeline');
  console.log(`\nIncremental re-sync after 1 file change: ${fmt(performance.now() - incStart)}`);

  console.log(`\nLLM calls on the read path: 0 (by construction — no model client is imported)`);
  console.log(`Tokens consumed: 0\n`);

  // ── Cleanup ──────────────────────────────────────────────────────────
  try {
    fs.rmSync(BENCH_VAULT, { recursive: true, force: true });
  } catch {
    console.error(`(cleanup) temp vault left at ${BENCH_VAULT}`);
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
