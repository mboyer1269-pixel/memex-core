import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: ReturnType<typeof Database>;

export function initIntake(dbPath?: string): void {
  const finalPath = dbPath || path.resolve(__dirname, '..', '..', 'data', 'intake.db');
  
  if (db) {
    try { db.close(); } catch (e) {}
  }

  const dir = path.dirname(finalPath);
  if (finalPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(finalPath);
  if (finalPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS intake_proposals (
      id TEXT PRIMARY KEY,
      tenant TEXT,
      namespace TEXT,
      proposedBy TEXT,
      sourceClient TEXT,
      content TEXT,
      suggestedEntities TEXT,
      suggestedRelations TEXT,
      provenance TEXT,
      confidence REAL,
      riskFlags TEXT,
      status TEXT,
      createdAt TEXT,
      reviewedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_proposals_content ON intake_proposals(namespace, content);
  `);
}

export function getIntakeDb() {
  if (!db) {
    throw new Error("Intake DB not initialized");
  }
  return db;
}
