import { SmartRouter } from './router.ts';
import { readVaultFile, writeVaultFile, searchVault } from '../vault/index.ts';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

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

  private async processPending() {
    let db: InstanceType<typeof Database> | null = null;
    try {
      db = new Database(this.dbPath);

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

      if (rows.length === 0) {
        return; // Nothing to process — silent
      }

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
        }
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
    const contradicts = await this.findContradictions(row);

    // 3. Write to Vault with YAML Provenance
    const safeId = row.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeNs = (row.namespace || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filepath = `facts/${safeNs}_${safeId}.md`;

    writeVaultFile(filepath, markdownOutput, {
      confidence: typeof row.confidence === 'number' ? row.confidence : 0.95,
      source_session: row.sourceClient || 'unknown',
      status: 'active',
      contradicts,
    });

    // 4. Mark as promoted in SQLite
    db.prepare(`UPDATE intake_proposals SET status = 'promoted' WHERE id = ?`).run(row.id);
    console.log(`[Worker] Promoted ${row.id} → Agent/${filepath}`);
  }

  private async findContradictions(row: any): Promise<string[]> {
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
      // Validate this is actually a real file in our vault before deprecating
      try {
        const oldContent = readVaultFile(candidate);
        if (oldContent.includes('status: "active"')) {
          // Re-write with deprecated status
          writeVaultFile(candidate, oldContent, {
            status: 'deprecated',
            tags: [`deprecated_by:${row.id}`],
          });
          contradicts.push(candidate);
          console.log(`[Worker] Deprecated conflicting file: ${candidate}`);
        }
      } catch {
        // File doesn't exist or can't be read — LLM hallucinated the path, ignore
        console.log(`[Worker] Skipping invalid contradiction path: ${candidate}`);
      }
    }

    return contradicts;
  }
}

// Standalone execution
const __workerFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dbPath = process.env.AGENTMEMORY_DB_PATH || 'agentmemory.db';
  const worker = new BackgroundWorker(dbPath);
  worker.start(Number(process.env.WORKER_INTERVAL_MS) || 60_000);
  
  // Graceful shutdown
  process.on('SIGINT', () => { worker.stop(); process.exit(0); });
  process.on('SIGTERM', () => { worker.stop(); process.exit(0); });
}
