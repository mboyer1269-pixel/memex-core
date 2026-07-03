import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Entity {
  id?: string;
  type: string;
  namespace: string;
  name?: string;
  properties?: Record<string, any>;
  source?: string;
  originId?: string;
  sourceHash?: string;
  confidence?: number;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Relation {
  id?: string;
  type: string;
  sourceId: string;
  targetId: string;
  namespace: string;
  properties?: Record<string, any>;
  source?: string;
  originId?: string;
  sourceHash?: string;
  confidence?: number;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

const VALID_ENTITY_TYPES = ["User", "Organization", "Project", "Agent", "Workflow", "Task", "Document", "Decision", "Skill", "Service", "Memory", "Policy", "Permission", "ContextPack"];
const VALID_RELATION_TYPES = ["OWNS", "USES", "DEPENDS_ON", "CREATED_BY", "ASSIGNED_TO", "BLOCKED_BY", "DECIDED_IN", "MENTIONS", "SUPERSEDES", "RELATED_TO", "HAS_POLICY", "HAS_PERMISSION", "APPLIES_TO", "HAS_CONTEXT_PACK"];

let db: ReturnType<typeof Database>;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    schema_version TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO meta (schema_version, created_at, updated_at) VALUES ('v0.5.1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    namespace TEXT NOT NULL,
    name TEXT,
    properties TEXT,
    source TEXT,
    originId TEXT,
    sourceHash TEXT,
    confidence REAL,
    validFrom TEXT,
    validTo TEXT,
    observedAt TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS relations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    sourceId TEXT NOT NULL,
    targetId TEXT NOT NULL,
    namespace TEXT NOT NULL,
    properties TEXT,
    source TEXT,
    originId TEXT,
    sourceHash TEXT,
    confidence REAL,
    validFrom TEXT,
    validTo TEXT,
    observedAt TEXT,
    createdAt TEXT,
    updatedAt TEXT
  );
`;

export function initGraph(dbPath?: string, readonly: boolean = false): void {
  const finalPath = dbPath || path.resolve(__dirname, '..', 'data', 'graph.db');
  
  if (db) {
    try { db.close(); } catch (e) {}
  }

  // Ensure directory exists if not in-memory
  const dir = path.dirname(finalPath);
  if (finalPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // A readonly open on a nonexistent file throws SQLITE_CANTOPEN and crashes
  // the MCP server on first run. Bootstrap an empty schema first.
  if (readonly && finalPath !== ':memory:' && !fs.existsSync(finalPath)) {
    const bootstrap = new Database(finalPath);
    bootstrap.pragma('journal_mode = WAL');
    bootstrap.exec(SCHEMA_SQL);
    bootstrap.close();
  }

  db = new Database(finalPath, readonly ? { readonly: true } : undefined);
  if (!readonly && finalPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  
  if (!readonly) {
    db.exec(SCHEMA_SQL);
  }
}

export function closeGraph(): void {
  if (db) db.close();
}

/**
 * Read a worker_meta value (e.g. 'last_sleep_cycle_at'). The table is
 * created by the BackgroundWorker; on a fresh DB or a readonly server it
 * may not exist yet — returns null instead of throwing.
 */
export function getWorkerMetaValue(key: string): string | null {
  if (!db) return null;
  try {
    const row = db.prepare('SELECT value FROM worker_meta WHERE key = ?').get(key) as any;
    return row ? String(row.value) : null;
  } catch {
    return null;
  }
}

export function runInTransaction<T>(fn: () => T): T {
  const transaction = db.transaction(fn);
  return transaction();
}

export function getEntity(id: string): Entity | null {
  if (!db) return null;
  const existing = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
  if (!existing) return null;
  return { ...existing, properties: existing.properties ? JSON.parse(existing.properties) : undefined };
}

function safeStringify(obj: any): string | null {
  if (!obj) return null;
  try {
    return JSON.stringify(obj);
  } catch (e) {
    throw new Error('Invalid JSON payload');
  }
}

export function addEntity(entity: Entity): string {
  if (!VALID_ENTITY_TYPES.includes(entity.type)) {
    throw new Error(`Invalid entity type: ${entity.type}`);
  }
  if (!entity.namespace || (!entity.namespace.startsWith('org:') && entity.namespace !== 'global')) {
    throw new Error(`Invalid namespace pattern: ${entity.namespace}`);
  }

  const id = entity.id || crypto.randomUUID();
  
  const existing = db.prepare('SELECT id FROM entities WHERE id = ?').get(id);
  if (existing) {
    throw new Error(`Entity duplicate: id ${id} already exists`);
  }

  const stmt = db.prepare(`
    INSERT INTO entities (
      id, type, namespace, name, properties, source, originId, sourceHash, confidence, validFrom, validTo, observedAt, createdAt, updatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    id,
    entity.type,
    entity.namespace,
    entity.name || null,
    safeStringify(entity.properties),
    entity.source || null,
    entity.originId || null,
    entity.sourceHash || null,
    entity.confidence || null,
    entity.validFrom || null,
    entity.validTo || null,
    entity.observedAt || null,
    entity.createdAt || new Date().toISOString(),
    entity.updatedAt || new Date().toISOString()
  );
  return id;
}

export function addRelation(relation: Relation): string {
  if (!VALID_RELATION_TYPES.includes(relation.type)) {
    throw new Error(`Invalid relation type: ${relation.type}`);
  }
  if (!relation.namespace || (!relation.namespace.startsWith('org:') && relation.namespace !== 'global')) {
    throw new Error(`Invalid namespace pattern: ${relation.namespace}`);
  }

  const srcStmt = db.prepare('SELECT namespace FROM entities WHERE id = ?');
  const targetStmt = db.prepare('SELECT namespace FROM entities WHERE id = ?');
  const src = srcStmt.get(relation.sourceId) as any;
  const target = targetStmt.get(relation.targetId) as any;
  
  if (!src) throw new Error(`Source entity missing: ${relation.sourceId}`);
  if (!target) throw new Error(`Target entity missing: ${relation.targetId}`);

  if ((src.namespace !== target.namespace) && relation.namespace !== 'global' && src.namespace !== 'global' && target.namespace !== 'global') {
    throw new Error('Cross-tenant relation rejected: namespaces must match unless using a global exception.');
  }

  const id = relation.id || crypto.randomUUID();
  const existing = db.prepare('SELECT id FROM relations WHERE id = ?').get(id);
  if (existing) {
    throw new Error(`Relation duplicate: id ${id} already exists`);
  }

  const stmt = db.prepare(`
    INSERT INTO relations (
      id, type, sourceId, targetId, namespace, properties, source, originId, sourceHash, confidence, validFrom, validTo, observedAt, createdAt, updatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    id,
    relation.type,
    relation.sourceId,
    relation.targetId,
    relation.namespace,
    safeStringify(relation.properties),
    relation.source || null,
    relation.originId || null,
    relation.sourceHash || null,
    relation.confidence || null,
    relation.validFrom || null,
    relation.validTo || null,
    relation.observedAt || null,
    relation.createdAt || new Date().toISOString(),
    relation.updatedAt || new Date().toISOString()
  );
  return id;
}

export function queryEntities(filter: { type?: string, namespace?: string, limit?: number }): Entity[] {
  let query = 'SELECT * FROM entities WHERE 1=1';
  const params: any[] = [];
  if (filter.type) {
    query += ' AND type = ?';
    params.push(filter.type);
  }
  if (filter.namespace) {
    query += ' AND namespace = ?';
    params.push(filter.namespace);
  }
  const rawLimit = filter.limit != null ? filter.limit : 10000;
  const numLimit = Number(rawLimit);
  const sqlLimit = isNaN(numLimit) ? 10000 : Math.max(1, Math.min(numLimit, 10000));
  query += ' LIMIT ?';
  params.push(sqlLimit);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];
  return rows.map(r => ({
    ...r,
    properties: r.properties ? JSON.parse(r.properties) : undefined
  }));
}

export function queryRelations(filter: { type?: string, namespace?: string, limit?: number }): Relation[] {
  let query = 'SELECT * FROM relations WHERE 1=1';
  const params: any[] = [];
  if (filter.type) {
    query += ' AND type = ?';
    params.push(filter.type);
  }
  if (filter.namespace) {
    query += ' AND namespace = ?';
    params.push(filter.namespace);
  }
  const rawLimit = filter.limit != null ? filter.limit : 10000;
  const numLimit = Number(rawLimit);
  const sqlLimit = isNaN(numLimit) ? 10000 : Math.max(1, Math.min(numLimit, 10000));
  query += ' LIMIT ?';
  params.push(sqlLimit);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];
  return rows.map(r => ({
    ...r,
    properties: r.properties ? JSON.parse(r.properties) : undefined
  }));
}

export function getNeighbors(entityId: string, limit?: number): { entity: Entity | null, relations: Relation[] } {
  const entityStmt = db.prepare('SELECT * FROM entities WHERE id = ?');
  const entityRow = entityStmt.get(entityId) as any;
  const entity = entityRow ? { ...entityRow, properties: entityRow.properties ? JSON.parse(entityRow.properties) : undefined } as Entity : null;

  let relQuery = 'SELECT * FROM relations WHERE sourceId = ? OR targetId = ?';
  const relParams = [entityId, entityId];
  const rawLimit = limit != null ? limit : 10000;
  const numLimit = Number(rawLimit);
  const sqlLimit = isNaN(numLimit) ? 10000 : Math.max(1, Math.min(numLimit, 10000));
  relQuery += ' LIMIT ?';
  relParams.push(sqlLimit);

  const relStmt = db.prepare(relQuery);
  const relRows = relStmt.all(...relParams) as any[];
  const relations = relRows.map(r => ({ ...r, properties: r.properties ? JSON.parse(r.properties) : undefined } as Relation));

  return { entity, relations };
}

export interface TimelineOptions {
  /** Max rows to return. Default 50, capped at 500. */
  limit?: number;
  /** Rows to skip — enables pagination. Default 0. */
  offset?: number;
  /** Only entities created at/after this ISO timestamp. */
  since?: string;
  /** Filter by entity type. */
  type?: string;
}

export function getTimeline(namespace: string, opts?: TimelineOptions): Entity[] {
  let query = 'SELECT * FROM entities WHERE namespace = ?';
  const params: any[] = [namespace];

  if (opts?.type) {
    query += ' AND type = ?';
    params.push(opts.type);
  }
  if (opts?.since) {
    query += ' AND createdAt >= ?';
    params.push(opts.since);
  }

  const rawLimit = Number(opts?.limit ?? 50);
  const limit = isNaN(rawLimit) ? 50 : Math.max(1, Math.min(rawLimit, 500));
  const rawOffset = Number(opts?.offset ?? 0);
  const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

  query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(r => ({ ...r, properties: r.properties ? JSON.parse(r.properties) : undefined } as Entity));
}

/**
 * Deterministic forgetting (R4): BFS over SUPERSEDES relations starting from
 * a new entity. Every reachable target is transitively superseded — no LLM in
 * the critical path, fully testable.
 *
 * When `apply` is true (default), superseded entities get their validity
 * window closed (validTo = now) and a `status: 'superseded'` property, which
 * excludes them from future context packs without deleting audit history.
 */
export function findSupersededEntities(
  newEntityId: string,
  namespace: string,
  opts?: { apply?: boolean }
): string[] {
  const apply = opts?.apply !== false;
  const now = new Date().toISOString();

  const relStmt = db.prepare(
    `SELECT targetId FROM relations WHERE type = 'SUPERSEDES' AND sourceId = ? AND namespace = ?`
  );

  const queue: string[] = [newEntityId];
  const visited = new Set<string>([newEntityId]);
  const superseded: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const targets = relStmt.all(id, namespace) as Array<{ targetId: string }>;

    for (const { targetId } of targets) {
      if (visited.has(targetId)) continue; // cycle guard
      visited.add(targetId);
      superseded.push(targetId);
      queue.push(targetId);
    }
  }

  if (apply && superseded.length > 0) {
    const getStmt = db.prepare('SELECT properties FROM entities WHERE id = ?');
    const updateStmt = db.prepare(
      'UPDATE entities SET validTo = ?, updatedAt = ?, properties = ? WHERE id = ? AND namespace = ?'
    );
    const applyAll = db.transaction(() => {
      for (const id of superseded) {
        const row = getStmt.get(id) as any;
        if (!row) continue;
        let props: Record<string, any> = {};
        try { props = row.properties ? JSON.parse(row.properties) : {}; } catch { /* keep {} */ }
        props.status = 'superseded';
        props.supersededBy = newEntityId;
        updateStmt.run(now, now, JSON.stringify(props), id, namespace);
      }
    });
    applyAll();
  }

  return superseded;
}

export function buildContextPack(request: { entityId: string, namespace: string, maxFacts?: number, maxRelations?: number }): any {
  const maxRels = request.maxRelations || 30;
  const { entity, relations } = getNeighbors(request.entityId, maxRels * 2); // Pull extra in case some don't match namespace
  if (!entity) {
    throw new Error(`ContextPack failed: Entity ${request.entityId} does not exist`);
  }
  if (entity.namespace !== request.namespace && request.namespace !== 'global') {
    throw new Error('Namespace access denied');
  }
  const rels = relations.filter(r => r.namespace === request.namespace || request.namespace === 'global').slice(0, maxRels);
  
  // Resolve neighbor entities
  const neighborIds = Array.from(new Set(rels.flatMap(r => [r.sourceId, r.targetId]))).filter(id => id !== request.entityId);
  const entitiesList = [entity];
  if (neighborIds.length > 0) {
    const placeholders = neighborIds.map(() => '?').join(',');
    const nStmt = db.prepare(`SELECT * FROM entities WHERE id IN (${placeholders}) AND (namespace = ? OR ? = 'global')`);
    const nRows = nStmt.all(...neighborIds, request.namespace, request.namespace) as any[];
    entitiesList.push(...nRows.map(r => ({ ...r, properties: r.properties ? JSON.parse(r.properties) : undefined })));
  }

  return {
    centerEntity: entity,
    entities: entitiesList,
    relations: rels,
    tenant: entity.namespace,
    namespace: request.namespace,
    depth: 1,
    generatedAt: new Date().toISOString(),
    relationCount: rels.length
  };
}

export function exportGraph(namespace?: string): any {
  let eQuery = 'SELECT * FROM entities';
  let rQuery = 'SELECT * FROM relations';
  const params: any[] = [];
  if (namespace) {
    eQuery += ' WHERE namespace = ?';
    rQuery += ' WHERE namespace = ?';
    params.push(namespace);
  }
  
  const eRows = db.prepare(eQuery).all(...params) as any[];
  const rRows = db.prepare(rQuery).all(...params) as any[];

  const entities = eRows.map(r => ({
    ...r,
    properties: r.properties ? JSON.parse(r.properties) : undefined
  }));
  const relations = rRows.map(r => ({
    ...r,
    properties: r.properties ? JSON.parse(r.properties) : undefined
  }));

  return { entities, relations };
}
