/**
 * Memory Trust Ledger — reputation-weighted memory economy.
 * ----------------------------------------------------------
 * Every memory already has a full lifecycle in this system:
 *   proposed → promoted → (survives | gets contradicted & deprecated)
 *
 * This module closes the loop: each source agent accumulates a TRUST SCORE
 * from the observed fate of its past memories. Future memories from that
 * agent have their confidence weighted by that trust before entering the
 * Vault — which then feeds straight into temporal decay and the
 * context-pack escalation threshold.
 *
 * Net effect: agents that produce durable, uncontradicted knowledge earn
 * faster context eligibility; agents that pollute memory get automatically
 * throttled. No LLM, no human — pure Bayesian bookkeeping.
 *
 * Math: Beta-Bernoulli posterior mean with a weakly-informative prior.
 *   trust = (successes + PRIOR_ALPHA) / (successes + failures + PRIOR_ALPHA + PRIOR_BETA)
 * New agents start at PRIOR_ALPHA/(PRIOR_ALPHA+PRIOR_BETA) = 0.5 (neutral)
 * and need sustained evidence to move far from it.
 */

import type Database from 'better-sqlite3';

export const PRIOR_ALPHA = 2;
export const PRIOR_BETA = 2;

/** Events the ledger recognizes, in lifecycle order. */
export const TRUST_EVENTS = [
  'memory_promoted',    // proposal reached the vault           → success
  'memory_survived',    // periodic audit found it still active → success
  'memory_rejected',    // intake rejected the proposal          → failure
  'memory_quarantined', // worker quarantined it                 → failure
  'memory_deprecated',  // a later memory contradicted it        → failure
] as const;

export type TrustEvent = (typeof TRUST_EVENTS)[number];

const SUCCESS_EVENTS: ReadonlySet<string> = new Set(['memory_promoted', 'memory_survived']);
const FAILURE_EVENTS: ReadonlySet<string> = new Set(['memory_rejected', 'memory_quarantined', 'memory_deprecated']);

export interface TrustStats {
  successes: number;
  failures: number;
}

/** Beta posterior mean in [0, 1]. Neutral (0.5) with zero evidence. */
export function computeTrustScore(stats: TrustStats): number {
  const successes = Math.max(0, stats.successes);
  const failures = Math.max(0, stats.failures);
  return (successes + PRIOR_ALPHA) / (successes + failures + PRIOR_ALPHA + PRIOR_BETA);
}

/**
 * Weight a declared confidence by the proposer's trust.
 * Neutral trust (0.5) leaves confidence untouched; full trust boosts up to
 * +30%; zero trust cuts by 30%. Result clamped to [0, 1].
 */
export function trustWeightedConfidence(declaredConfidence: number, trust: number): number {
  const clampedTrust = Math.max(0, Math.min(1, trust));
  const weight = 0.7 + 0.6 * clampedTrust; // 0.7 .. 1.3, exactly 1.0 at trust 0.5
  const weighted = declaredConfidence * weight;
  return Math.max(0, Math.min(1, weighted));
}

/** Create the ledger table if missing. Safe to call on every worker tick. */
export function ensureTrustLedger(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trust_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_client TEXT NOT NULL,
      event TEXT NOT NULL,
      subject TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trust_events_client ON trust_events(source_client);
  `);
}

export function recordTrustEvent(
  db: InstanceType<typeof Database>,
  sourceClient: string,
  event: TrustEvent,
  subject?: string
): void {
  if (!sourceClient) return;
  db.prepare(
    `INSERT INTO trust_events (source_client, event, subject, created_at) VALUES (?, ?, ?, ?)`
  ).run(sourceClient, event, subject ?? null, new Date().toISOString());
}

export function readTrustStats(db: InstanceType<typeof Database>, sourceClient: string): TrustStats {
  const rows = db.prepare(
    `SELECT event, COUNT(*) AS n FROM trust_events WHERE source_client = ? GROUP BY event`
  ).all(sourceClient) as Array<{ event: string; n: number }>;

  let successes = 0;
  let failures = 0;
  for (const row of rows) {
    if (SUCCESS_EVENTS.has(row.event)) successes += row.n;
    else if (FAILURE_EVENTS.has(row.event)) failures += row.n;
  }
  return { successes, failures };
}

/** Convenience: current trust score for an agent, straight from the ledger. */
export function getAgentTrust(db: InstanceType<typeof Database>, sourceClient: string): number {
  return computeTrustScore(readTrustStats(db, sourceClient));
}

/** Ledger overview for dashboards / librarian briefs. */
export function listAgentTrust(db: InstanceType<typeof Database>): Array<{ sourceClient: string; trust: number; successes: number; failures: number }> {
  const clients = db.prepare(
    `SELECT DISTINCT source_client FROM trust_events ORDER BY source_client`
  ).all() as Array<{ source_client: string }>;

  return clients.map(({ source_client }) => {
    const stats = readTrustStats(db, source_client);
    return {
      sourceClient: source_client,
      trust: computeTrustScore(stats),
      successes: stats.successes,
      failures: stats.failures
    };
  });
}
