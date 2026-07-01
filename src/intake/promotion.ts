import { getIntakeDb } from '../db/intake.ts';
import { addEntity, addRelation, getEntity, runInTransaction } from '../graph.ts';
import type { IntakeProposal } from './index.ts';

export function listPendingProposals(): IntakeProposal[] {
  const db = getIntakeDb();
  const rows = db.prepare("SELECT * FROM intake_proposals WHERE status IN ('proposed', 'approved')").all() as any[];
  return rows.map(r => {
    if (r.reviewedAt === null) delete r.reviewedAt;
    return r;
  });
}

export function readProposal(id: string): IntakeProposal | null {
  const db = getIntakeDb();
  const row = db.prepare("SELECT * FROM intake_proposals WHERE id = ?").get(id) as any;
  if (!row) return null;
  if (row.reviewedAt === null) delete row.reviewedAt;
  return row as IntakeProposal;
}

export function approveProposal(id: string): void {
  const db = getIntakeDb();
  const proposal = readProposal(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== 'proposed') {
    throw new Error("Only proposed proposals can be approved");
  }
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE intake_proposals SET status = 'approved', reviewedAt = ? WHERE id = ? AND status = 'proposed'").run(now, id);
  if (result.changes === 0) {
    throw new Error("Approval failed: proposal not found or not in proposed state");
  }
}

export function rejectProposal(id: string): void {
  const db = getIntakeDb();
  const proposal = readProposal(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== 'proposed' && proposal.status !== 'quarantined') {
    throw new Error("Only proposed or quarantined proposals can be rejected");
  }
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE intake_proposals SET status = 'rejected', reviewedAt = ? WHERE id = ? AND status IN ('proposed', 'quarantined')").run(now, id);
  if (result.changes === 0) {
    throw new Error("Rejection failed: proposal not found or not in correct state");
  }
}

export function promoteApprovedProposal(id: string): void {
  const db = getIntakeDb();
  const proposal = readProposal(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== 'approved') {
    throw new Error("Only approved proposals can be promoted");
  }

  runInTransaction(() => {
    let ents: any[] = [];
    if (proposal.suggestedEntities) {
      try {
        ents = JSON.parse(proposal.suggestedEntities);
      } catch (e) {
        throw new Error("Invalid JSON in suggestedEntities");
      }
      for (const ent of ents) {
        try {
          addEntity({
            id: ent.id,
            type: ent.type,
            namespace: proposal.namespace,
            name: ent.name,
            properties: ent.properties,
            source: proposal.provenance,
            confidence: proposal.confidence,
            validFrom: ent.validFrom,
            validTo: ent.validTo,
            observedAt: ent.observedAt,
            originId: ent.originId,
            sourceHash: ent.sourceHash
          });
        } catch (e: any) {
          if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || e.message?.toLowerCase().includes("duplicate")) {
            const existing = getEntity(ent.id);
            if (existing && existing.namespace !== proposal.namespace && existing.namespace !== 'global') {
              throw new Error(`Cross-tenant entity collision detected for entity: ${ent.id}`);
            }
          } else {
            throw e;
          }
        }
      }
    }

    if (proposal.suggestedRelations) {
      let rels: any[];
      try {
        rels = JSON.parse(proposal.suggestedRelations);
      } catch (e) {
        throw new Error("Invalid JSON in suggestedRelations");
      }
      
      const entIds = new Set(ents.map((e: any) => e.id));
      
      for (const rel of rels) {
        if (!rel.targetId) {
          throw new Error(`Relation without valid target entity: ${rel.targetId}`);
        } else {
          const existing = getEntity(rel.targetId);
          if (existing) {
            if (existing.namespace !== proposal.namespace && existing.namespace !== 'global') {
              throw new Error(`Relation without valid target entity: ${rel.targetId}`);
            }
          } else if (!entIds.has(rel.targetId)) {
            throw new Error(`Relation without valid target entity: ${rel.targetId}`);
          }
        }

        if (!rel.sourceId) {
          throw new Error(`Relation without valid source entity: ${rel.sourceId}`);
        } else {
          const existing = getEntity(rel.sourceId);
          if (existing) {
            if (existing.namespace !== proposal.namespace && existing.namespace !== 'global') {
              throw new Error(`Relation without valid source entity: ${rel.sourceId}`);
            }
          } else if (!entIds.has(rel.sourceId)) {
            throw new Error(`Relation without valid source entity: ${rel.sourceId}`);
          }
        }

        try {
          addRelation({
            id: rel.id,
            type: rel.type,
            sourceId: rel.sourceId,
            targetId: rel.targetId,
            namespace: proposal.namespace,
            properties: rel.properties,
            source: proposal.provenance,
            confidence: proposal.confidence,
            validFrom: rel.validFrom,
            validTo: rel.validTo,
            observedAt: rel.observedAt,
            originId: rel.originId,
            sourceHash: rel.sourceHash
          });
        } catch (e: any) {
          if (!(e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || e.message?.toLowerCase().includes("duplicate"))) {
            throw e;
          }
        }
      }
    }

  });

  const updateIntake = db.transaction(() => {
    const result = db.prepare("UPDATE intake_proposals SET status = 'promoted' WHERE id = ? AND status = 'approved'").run(id);
    if (result.changes === 0) {
      throw new Error("Promotion failed or proposal was not in approved state");
    }
  });
  updateIntake();
}
