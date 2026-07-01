import { getIntakeDb } from '../db/intake.ts';
import { getEntity } from '../graph.ts';
import crypto from 'crypto';

export * from './promotion.ts';

export interface IntakeProposal {
  id?: string;
  tenant: string;
  namespace: string;
  proposedBy: string;
  sourceClient: string;
  content: string;
  suggestedEntities?: string; // JSON
  suggestedRelations?: string; // JSON
  provenance?: string;
  confidence?: number;
  riskFlags?: string;
  status?: 'proposed' | 'quarantined' | 'approved' | 'rejected' | 'promoted';
  createdAt?: string;
  reviewedAt?: string;
}

export function submitProposal(proposal: IntakeProposal): { id?: string, status?: string, warnings?: string[] } {
  const db = getIntakeDb();
  const warnings: string[] = [];

  let status = 'proposed';

  if (!proposal.content || proposal.content.trim() === '') {
    warnings.push("Empty content payload.");
    status = 'rejected';
  }

  if (typeof proposal.namespace !== 'string' || !proposal.namespace.startsWith('org:')) {
    warnings.push("Invalid namespace pattern: must start with 'org:'.");
    status = 'rejected';
  }

  if (proposal.content && proposal.content.length > 100000) {
    warnings.push("Payload size is exceptionally large.");
  }

  if (typeof proposal.tenant !== 'string' || proposal.tenant.trim() === '') {
    warnings.push("Invalid tenant.");
    status = 'rejected';
  }

  if (proposal.tenant !== proposal.namespace) {
    warnings.push("Tenant must exactly match namespace.");
    status = 'rejected';
  }

  let parsedEnts: any[] | undefined = undefined;
  let parsedRels: any[] | undefined = undefined;

  if (proposal.suggestedEntities) {
    try {
      parsedEnts = JSON.parse(proposal.suggestedEntities);
      for (const ent of parsedEnts!) {
        if (typeof ent !== 'object' || ent === null || Array.isArray(ent)) {
          warnings.push("Invalid entity format: must be an object");
          status = 'rejected';
        } else {
          if (!ent.id) ent.id = crypto.randomUUID();
        }
      }
      proposal.suggestedEntities = JSON.stringify(parsedEnts);
    } catch (e) {
      warnings.push("Invalid JSON in suggestions");
      status = 'rejected';
    }
  }

  if (proposal.suggestedRelations) {
    try {
      parsedRels = JSON.parse(proposal.suggestedRelations);
      for (const rel of parsedRels!) {
        if (typeof rel !== 'object' || rel === null || Array.isArray(rel)) {
          warnings.push("Invalid relation format: must be an object");
          status = 'rejected';
        } else {
          if (!rel.id) rel.id = crypto.randomUUID();
        }
      }
      proposal.suggestedRelations = JSON.stringify(parsedRels);
    } catch (e) {
      warnings.push("Invalid JSON in suggestions");
      status = 'rejected';
    }
  }

  if (parsedRels && status !== 'rejected') {
    const entIds = new Set((parsedEnts || []).map(e => e.id));
    for (const rel of parsedRels) {
      if (!rel.targetId) {
        warnings.push(`Relation without valid target entity: ${rel.targetId}`);
        status = 'rejected';
      } else {
        const existing = getEntity(rel.targetId);
        if (existing) {
          if (existing.namespace !== proposal.namespace && existing.namespace !== 'global') {
            warnings.push(`Relation without valid target entity: ${rel.targetId}`);
            status = 'rejected';
          }
        } else if (!entIds.has(rel.targetId)) {
          warnings.push(`Relation without valid target entity: ${rel.targetId}`);
          status = 'rejected';
        }
      }

      if (!rel.sourceId) {
        warnings.push(`Relation without valid source entity: ${rel.sourceId}`);
        status = 'rejected';
      } else {
        const existing = getEntity(rel.sourceId);
        if (existing) {
          if (existing.namespace !== proposal.namespace && existing.namespace !== 'global') {
            warnings.push(`Relation without valid source entity: ${rel.sourceId}`);
            status = 'rejected';
          }
        } else if (!entIds.has(rel.sourceId)) {
          warnings.push(`Relation without valid source entity: ${rel.sourceId}`);
          status = 'rejected';
        }
      }
    }
  }

  const id = proposal.id || crypto.randomUUID();
  const createdAt = proposal.createdAt || new Date().toISOString();

  if (proposal.tenant === undefined) throw new Error("Missing required field: tenant");
  if (proposal.namespace === undefined) throw new Error("Missing required field: namespace");
  if (proposal.proposedBy === undefined) throw new Error("Missing required field: proposedBy");
  if (proposal.sourceClient === undefined) throw new Error("Missing required field: sourceClient");
  if (proposal.content === undefined) throw new Error("Missing required field: content");

  let finalId = id;
  const runInsert = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO intake_proposals (
        id, tenant, namespace, proposedBy, sourceClient, content, 
        suggestedEntities, suggestedRelations, provenance, confidence, 
        riskFlags, status, createdAt, reviewedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const info = stmt.run(
      id,
      proposal.tenant ?? null,
      proposal.namespace ?? null,
      proposal.proposedBy ?? null,
      proposal.sourceClient ?? null,
      proposal.content ?? null,
      proposal.suggestedEntities ?? null,
      proposal.suggestedRelations ?? null,
      proposal.provenance ?? null,
      proposal.confidence ?? null,
      proposal.riskFlags ?? null,
      status,
      createdAt,
      proposal.reviewedAt ?? null
    );

    if (info.changes === 0) {
      if (proposal.content && proposal.namespace) {
        const existing = db.prepare('SELECT id FROM intake_proposals WHERE namespace = ? AND content = ?').get(proposal.namespace, proposal.content) as any;
        if (existing) {
          warnings.push("Potential duplicate proposal content detected.");
          finalId = existing.id;
        } else {
          throw new Error("Proposal ID collision detected with different content.");
        }
      } else {
        throw new Error("Proposal ID collision.");
      }
    }
  });

  runInsert.exclusive();

  const res: { id?: string, status?: string, warnings?: string[] } = { id: finalId, status };
  if (warnings.length > 0) {
    res.warnings = warnings;
  }
  return res;
}

