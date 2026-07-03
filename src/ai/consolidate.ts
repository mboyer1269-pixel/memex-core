/**
 * Sleep Cycle — nightly memory consolidation.
 * --------------------------------------------
 * Biological memory does two things during sleep that this system was
 * missing: it REINFORCES memories that proved useful over time, and it
 * PRUNES the ones that decayed into noise. This module does both, fully
 * deterministically (no LLM, no human):
 *
 *   SURVIVAL CREDIT  — an `active` memory that has lived past the review
 *     age without being contradicted earns its author a `memory_survived`
 *     trust event. Combined with the Trust Ledger, agents whose knowledge
 *     endures gain confidence-weighting on all their FUTURE memories.
 *
 *   ACTIVE FORGETTING — an `active` memory whose effective confidence
 *     (declared confidence x Ebbinghaus retention) fell below the decay
 *     floor is flipped to `deprecated` via the merging writeVaultFile, so
 *     every other metadata field survives for audit. `verified` doctrine
 *     and `failure` scar tissue are never touched.
 *
 * Idempotence: survival credits are logged in `consolidation_log`. A file
 * earns at most ONE credit per survival period (reviewAgeDays since the
 * last credit) — so durable memories keep earning, but never twice within
 * the same period. Forgetting is naturally idempotent — a deprecated file
 * is no longer `active`.
 */

import type Database from 'better-sqlite3';
import { listVaultDir, readVaultFile, writeVaultFile } from '../vault/index.ts';
import { parseFrontmatter } from '../vault/frontmatter.ts';
import { retention, DECAY_EXCLUSION_FLOOR } from '../fabric/decay.ts';
import type { MemoryKind } from '../fabric/types.ts';
import { MEMORY_KINDS } from '../fabric/types.ts';
import { ensureTrustLedger, recordTrustEvent } from '../fabric/trust.ts';

/** Days an active memory must survive before its author earns credit. */
export const SURVIVAL_REVIEW_AGE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

export interface SleepCycleReport {
  scanned: number;
  /** Files whose author was credited with memory_survived. */
  survived: string[];
  /** Files flipped to deprecated because they decayed below the floor. */
  forgotten: string[];
  /** Files skipped (no frontmatter, not active, protected kind, ...). */
  skipped: number;
}

/**
 * Infer the memory kind for decay purposes. Priority:
 *   1. explicit `kind:` frontmatter field (e.g. a long-lived PROJECT.md in
 *      state/ can declare `kind: semantic` to escape episodic decay)
 *   2. explicit kind tags
 *   3. vault zone (skills/ → procedural, state/ → episodic)
 *   4. semantic default
 */
export function inferKind(filepath: string, tags: string[], explicitKind?: unknown): MemoryKind {
  if (typeof explicitKind === 'string' && (MEMORY_KINDS as readonly string[]).includes(explicitKind)) {
    return explicitKind as MemoryKind;
  }
  for (const kind of ['failure', 'procedural', 'decision', 'episodic', 'semantic'] as const) {
    if (tags.includes(kind)) return kind;
  }
  if (filepath.includes('/skills/')) return 'procedural';
  if (filepath.includes('/state/')) return 'episodic';
  return 'semantic';
}

/** Recursively list all markdown files under the Agent/ zone. */
function listAgentFiles(): string[] {
  const files: string[] = [];
  const queue = ['Agent'];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    for (const entry of listVaultDir(dir)) {
      if (entry.isDir) {
        queue.push(entry.filepath);
      } else if (entry.filepath.endsWith('.md') || entry.filepath.endsWith('.txt')) {
        files.push(entry.filepath);
      }
    }
  }
  return files;
}

export function ensureConsolidationLog(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS consolidation_log (
      filepath TEXT PRIMARY KEY,
      credited_at TEXT NOT NULL
    );
  `);
}

/**
 * Run one consolidation pass over the Agent/ zone of the vault.
 * Pure function of (vault contents, db state, now) — safe to call from the
 * worker on a schedule or manually from tests.
 */
export function runSleepCycle(
  db: InstanceType<typeof Database>,
  opts?: { now?: Date; reviewAgeDays?: number }
): SleepCycleReport {
  const now = opts?.now ?? new Date();
  const reviewAgeDays = opts?.reviewAgeDays ?? SURVIVAL_REVIEW_AGE_DAYS;

  ensureTrustLedger(db);
  ensureConsolidationLog(db);

  // Last credit timestamp per file. A file may earn a NEW credit once a
  // full survival period has elapsed since its previous credit — durable
  // memories keep earning; recreated files are eligible again.
  const lastCredited = new Map<string, number>();
  for (const row of db.prepare('SELECT filepath, credited_at FROM consolidation_log').all() as Array<{ filepath: string; credited_at: string }>) {
    lastCredited.set(row.filepath, new Date(row.credited_at).getTime());
  }
  const creditStmt = db.prepare(`
    INSERT INTO consolidation_log (filepath, credited_at) VALUES (?, ?)
    ON CONFLICT(filepath) DO UPDATE SET credited_at = excluded.credited_at
  `);

  const report: SleepCycleReport = { scanned: 0, survived: [], forgotten: [], skipped: 0 };

  for (const filepath of listAgentFiles()) {
    report.scanned++;

    let content: string;
    try {
      content = readVaultFile(filepath);
    } catch {
      report.skipped++;
      continue;
    }

    const { meta } = parseFrontmatter(content);
    const status = typeof meta.status === 'string' ? meta.status : null;

    // Only `active` memories participate: verified doctrine is human-pinned,
    // deprecated/superseded/quarantined are already out of circulation.
    if (status !== 'active') {
      report.skipped++;
      continue;
    }

    const confidence = typeof meta.confidence === 'number' ? meta.confidence : 1.0;
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const kind = inferKind(filepath, tags, meta.kind);
    const author = typeof meta.source_session === 'string' ? meta.source_session : null;

    const createdAt = new Date(String(meta.created_at ?? meta.updated_at ?? ''));
    const updatedAt = new Date(String(meta.updated_at ?? meta.created_at ?? ''));

    // ── ACTIVE FORGETTING ─────────────────────────────────────────────
    // Decay is anchored on updated_at: a memory that keeps being refreshed
    // keeps its relevance. Failure scar tissue is exempt, always.
    if (kind !== 'failure' && !Number.isNaN(updatedAt.getTime())) {
      const ageDays = (now.getTime() - updatedAt.getTime()) / MS_PER_DAY;
      const effConfidence = confidence * retention(kind, ageDays);

      if (effConfidence < DECAY_EXCLUSION_FLOOR) {
        writeVaultFile(filepath, content, {
          status: 'deprecated',
          tags: ['deprecated_by:sleep_cycle'],
        });
        report.forgotten.push(filepath);
        continue; // a forgotten memory earns no survival credit
      }
    }

    // ── SURVIVAL CREDIT ───────────────────────────────────────────────
    // First credit is anchored on created_at (the memory proved durable
    // since birth); subsequent credits require a full survival period
    // since the LAST credit.
    if (author && !Number.isNaN(createdAt.getTime())) {
      const previousCredit = lastCredited.get(filepath);
      const anchor = previousCredit ?? createdAt.getTime();
      const periodElapsed = (now.getTime() - anchor) / MS_PER_DAY >= reviewAgeDays;

      if (periodElapsed) {
        recordTrustEvent(db, author, 'memory_survived', filepath);
        creditStmt.run(filepath, now.toISOString());
        report.survived.push(filepath);
      }
    }
  }

  return report;
}
