import { SmartRouter } from './router.ts';
import { readVaultFile, writeVaultFile, searchVault } from '../vault/index.ts';
import { parseFrontmatter } from '../vault/frontmatter.ts';
import { clusterByKeywords, distillPrompt } from './distill.ts';
import {
  ensureTrustLedger, recordTrustEvent, getAgentTrust, trustWeightedConfidence
} from '../fabric/trust.ts';
import { runSleepCycle } from './consolidate.ts';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const MIN_TRACES_FOR_DISTILLATION = 5;
const MIN_CLUSTER_SIZE = 3;
/** The sleep cycle runs at most once per interval (default: 24h). */
const SLEEP_CYCLE_INTERVAL_MS = Number(process.env.WORKER_SLEEP_INTERVAL_MS) || 24 * 60 * 60 * 1000;

export class BackgroundWorker {
  private router: SmartRouter;
  private dbPath: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false; // prevent overlapping ticks

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.router = new SmartRouter({});
  }

  start(intervalMs: number = 60_000) {
    console.log(`[Worker] Started (interval: ${intervalMs}ms, db: ${this.dbPath})`);
    // Run once immediately, then schedule
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Worker] Stopped.');
  }

  /** Wrapper that prevents overlapping async ticks */
  private tick() {
    if (this.running) {
      console.log('[Worker] Previous tick still running, skipping.');
      return;
    }
    this.running = true;
    this.processPending()
      .catch(e => console.error('[Worker] Unhandled error:', e))
      .finally(() => { this.running = false; });
  }

  /** Open the intake DB in WAL mode so readonly readers are never blocked. */
  private openDb(): InstanceType<typeof Database> {
    const db = new Database(this.dbPath);
    // Without WAL, this write connection defaults to DELETE journal mode and
    // can block the MCP server's readonly connection on the same file.
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    return db;
  }

  private async processPending() {
    let db: InstanceType<typeof Database> | null = null;
    try {
      db = this.openDb();

      // Check if table exists before querying
      const tableCheck = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='intake_proposals'`
      ).get();
      if (!tableCheck) {
        console.log('[Worker] intake_proposals table not found, skipping cycle.');
        return;
      }

      const rows = db.prepare(
        `SELECT * FROM intake_proposals WHERE status = 'approved' LIMIT 10`
      ).all() as any[];

      ensureTrustLedger(db);

      if (rows.length > 0) {
        console.log(`[Worker] Found ${rows.length} approved proposal(s) to process.`);

        for (const row of rows) {
          try {
            await this.processOneProposal(db, row);
          } catch (e) {
            console.error(`[Worker] Failed to process proposal ${row.id}:`, e);
            // Mark as quarantined so we don't retry forever
            db.prepare(
              `UPDATE intake_proposals SET status = 'quarantined' WHERE id = ?`
            ).run(row.id);
            recordTrustEvent(db, row.sourceClient, 'memory_quarantined', row.id);
          }
        }
      }

      // Second pass (R3): distill repeated episodic traces into procedural SOPs
      try {
        await this.distillProcedural(db);
      } catch (e) {
        console.error('[Worker] Distillation pass failed:', e);
      }

      // Third pass: sleep-cycle consolidation (survival credit + forgetting)
      try {
        this.maybeRunSleepCycle(db);
      } catch (e) {
        console.error('[Worker] Sleep cycle failed:', e);
      }
    } catch (e) {
      console.error('[Worker] Database error:', e);
    } finally {
      if (db) {
        try { db.close(); } catch { /* ignore close errors */ }
      }
    }
  }

  private async processOneProposal(db: InstanceType<typeof Database>, row: any) {
    console.log(`[Worker] Processing proposal ${row.id}...`);

    // 1. Use low-cost model to convert raw content to structured Markdown
    const extractionPrompt = [
      'Convert this raw agent memory into structured Obsidian Markdown.',
      'Extract facts, entities, and skills as bullet points.',
      'Output ONLY the Markdown body, no introductory text.',
      `Raw data:\n${row.content.substring(0, 4000)}` // Cap prompt size
    ].join('\n');

    const markdownOutput = await this.router.callModel(extractionPrompt, 'low');

    // 2. ACTIVE FORGETTING: Check for contradictions with existing vault facts
    const contradicts = await this.findContradictions(db, row);

    // 3. TRUST LEDGER: weight the declared confidence by the proposer's
    // track record. Reliable agents get a boost toward the escalation
    // threshold; polluters get throttled automatically.
    const declaredConfidence = typeof row.confidence === 'number' ? row.confidence : 0.95;
    const trust = getAgentTrust(db, row.sourceClient || 'unknown');
    const weightedConfidence = trustWeightedConfidence(declaredConfidence, trust);

    // 4. Write to Vault with YAML Provenance
    const safeId = row.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeNs = (row.namespace || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filepath = `facts/${safeNs}_${safeId}.md`;

    writeVaultFile(filepath, markdownOutput, {
      confidence: weightedConfidence,
      source_session: row.sourceClient || 'unknown',
      status: 'active',
      contradicts,
    });

    // 5. Mark as promoted in SQLite + credit the proposer's trust score
    db.prepare(`UPDATE intake_proposals SET status = 'promoted' WHERE id = ?`).run(row.id);
    recordTrustEvent(db, row.sourceClient, 'memory_promoted', row.id);
    console.log(`[Worker] Promoted ${row.id} → Agent/${filepath} (trust ${trust.toFixed(2)}, confidence ${declaredConfidence} → ${weightedConfidence.toFixed(3)})`);
  }

  private async findContradictions(db: InstanceType<typeof Database>, row: any): Promise<string[]> {
    // Extract a few meaningful keywords from the content
    const words = (row.content || '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 3)
      .slice(0, 8);

    if (words.length === 0) return [];

    const query = words.join(' ');
    const relatedFiles = searchVault(query, false).slice(0, 3);

    if (relatedFiles.length === 0) return [];

    // SANDBOX: the LLM may ONLY name files from this exact candidate set.
    // Anything else — even a real vault path it happens to know about — is
    // rejected. This prevents a hallucinated-but-existing path (e.g.
    // facts/org_user.md) from being deprecated by accident.
    const allowedPaths = new Set(relatedFiles.map((f: any) => f.filepath));

    // Use mid-tier model to evaluate contradiction
    const conflictPrompt = [
      'Does the NEW information contradict any of the EXISTING facts below?',
      `NEW: "${row.content.substring(0, 1000)}"`,
      '',
      'EXISTING:',
      ...relatedFiles.map((f: any) => `- ${f.filepath}: ${f.preview}`),
      '',
      'Reply ONLY with the filepath(s) it contradicts, comma-separated. If none, reply "none".'
    ].join('\n');

    const result = await this.router.callModel(conflictPrompt, 'medium');
    if (result.toLowerCase().includes('none')) return [];

    const contradicts: string[] = [];
    const candidates = result.split(',').map((p: string) => p.trim()).filter(Boolean);

    for (const candidate of candidates) {
      if (!allowedPaths.has(candidate)) {
        console.log(`[Worker] Rejected out-of-candidate-set contradiction path: ${candidate}`);
        continue;
      }
      try {
        const oldContent = readVaultFile(candidate);
        if (oldContent.includes('status: "active"')) {
          // Deprecate: metadata MERGE preserves confidence/source_session/tags
          writeVaultFile(candidate, oldContent, {
            status: 'deprecated',
            tags: [`deprecated_by:${row.id}`],
          });
          contradicts.push(candidate);
          // Debit the ORIGINAL author's trust: their memory got contradicted
          const originalAuthor = parseFrontmatter(oldContent).meta.source_session;
          if (typeof originalAuthor === 'string' && originalAuthor) {
            recordTrustEvent(db, originalAuthor, 'memory_deprecated', candidate);
          }
          console.log(`[Worker] Deprecated conflicting file: ${candidate}`);
        }
      } catch {
        // File disappeared between search and read — ignore
        console.log(`[Worker] Skipping unreadable contradiction path: ${candidate}`);
      }
    }

    return contradicts;
  }

  /**
   * Sleep Cycle — throttled to once per SLEEP_CYCLE_INTERVAL_MS, with the
   * last-run timestamp persisted in worker_meta so restarts don't re-trigger.
   */
  private maybeRunSleepCycle(db: InstanceType<typeof Database>): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const row = db.prepare(`SELECT value FROM worker_meta WHERE key = 'last_sleep_cycle_at'`).get() as any;
    const lastRun = row ? new Date(row.value).getTime() : 0;
    if (Date.now() - lastRun < SLEEP_CYCLE_INTERVAL_MS) return;

    const report = runSleepCycle(db);
    db.prepare(`
      INSERT INTO worker_meta (key, value) VALUES ('last_sleep_cycle_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(new Date().toISOString());

    if (report.survived.length > 0 || report.forgotten.length > 0) {
      console.log(
        `[Worker] Sleep cycle: ${report.scanned} scanned, ` +
        `${report.survived.length} survival credit(s), ` +
        `${report.forgotten.length} forgotten.`
      );
    }
  }

  /**
   * R3 — Procedural Memory Engine.
   * Aggregates promoted episodic traces, clusters them deterministically by
   * keyword overlap, and distills dense clusters into SOP files under
   * Agent/skills/. A distill_log table makes the pass idempotent: each
   * proposal contributes to at most one SOP.
   */
  async distillProcedural(db: InstanceType<typeof Database>): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS distill_log (
        proposal_id TEXT PRIMARY KEY,
        sop_filepath TEXT NOT NULL,
        distilled_at TEXT NOT NULL
      );
    `);

    const traces = db.prepare(`
      SELECT p.id, p.content FROM intake_proposals p
      LEFT JOIN distill_log d ON d.proposal_id = p.id
      WHERE p.status = 'promoted'
        AND p.content LIKE '%episodic%'
        AND d.proposal_id IS NULL
      ORDER BY p.createdAt DESC
      LIMIT 20
    `).all() as Array<{ id: string; content: string }>;

    if (traces.length < MIN_TRACES_FOR_DISTILLATION) return; // Not enough signal

    const clusters = clusterByKeywords(traces).filter(c => c.size >= MIN_CLUSTER_SIZE);
    if (clusters.length === 0) return;

    for (const cluster of clusters) {
      const sop = await this.router.callModel(distillPrompt(cluster), 'medium');

      const safeTopic = cluster.topic.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filepath = `skills/sop_${safeTopic}.md`;

      writeVaultFile(filepath, sop, {
        confidence: 0.75,
        source_session: 'worker:distillation',
        status: 'active',
        tags: ['procedural', 'auto-distilled', ...cluster.ids.map(id => `from:${id}`)],
      });

      const logStmt = db.prepare(
        `INSERT OR IGNORE INTO distill_log (proposal_id, sop_filepath, distilled_at) VALUES (?, ?, ?)`
      );
      const now = new Date().toISOString();
      for (const id of cluster.ids) {
        logStmt.run(id, filepath, now);
      }

      console.log(`[Worker] Distilled ${cluster.size} episodic traces → Agent/${filepath}`);
    }
  }
}

// Standalone execution
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dbPath = process.env.AGENTMEMORY_DB_PATH || 'agentmemory.db';
  const worker = new BackgroundWorker(dbPath);
  worker.start(Number(process.env.WORKER_INTERVAL_MS) || 60_000);

  // Graceful shutdown
  process.on('SIGINT', () => { worker.stop(); process.exit(0); });
  process.on('SIGTERM', () => { worker.stop(); process.exit(0); });
}
