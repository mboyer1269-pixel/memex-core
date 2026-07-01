import { test, suite } from 'node:test';
import * as assert from 'node:assert';
import { 
  initIntake, submitProposal, approveProposal, promoteApprovedProposal, readProposal
} from '../src/intake.ts';
import { initGraph, queryEntities, queryRelations } from '../src/graph.ts';

suite('Adversarial Edge Cases', () => {
  test('Cannot promote unapproved proposals', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:test', namespace: 'org:test', proposedBy: 'agent-1', sourceClient: 'cli', content: 'test'
    });
    // Status is 'proposed', not 'approved'
    assert.throws(() => promoteApprovedProposal(res.id!), /Only approved proposals can be promoted/);
  });

  test('Cross-tenant entity pollution should throw and rollback', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    // Setup existing entity in tenant A
    const resA = submitProposal({
      tenant: 'org:tenantA', namespace: 'org:tenantA', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'shared-id', type: 'Agent', namespace: 'org:tenantA' }])
    });
    approveProposal(resA.id!);
    promoteApprovedProposal(resA.id!);

    // Tenant B tries to overwrite or collide with shared-id
    const resB = submitProposal({
      tenant: 'org:tenantB', namespace: 'org:tenantB', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'shared-id', type: 'Agent', namespace: 'org:tenantB', name: 'Malicious Overwrite' }])
    });
    approveProposal(resB.id!);

    assert.throws(() => promoteApprovedProposal(resB.id!), /Cross-tenant entity collision detected/);
    
    // Verify rollback: B's proposal remains approved, not promoted
    const pB = readProposal(resB.id!);
    assert.strictEqual(pB?.status, 'approved');
    
    // Verify entity in graph is still Tenant A's
    const entities = queryEntities({ namespace: 'org:tenantA' });
    assert.strictEqual(entities.length, 1);
    assert.strictEqual(entities[0].name, null); // Original had no name
  });

  test('Same-tenant duplicate ID should be silently ignored (idempotent)', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    const res1 = submitProposal({
      tenant: 'org:tenantA', namespace: 'org:tenantA', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:tenantA', name: 'First' }])
    });
    approveProposal(res1.id!);
    promoteApprovedProposal(res1.id!);

    const res2 = submitProposal({
      tenant: 'org:tenantA', namespace: 'org:tenantA', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:tenantA', name: 'Second' }])
    });
    approveProposal(res2.id!);
    
    // This should NOT throw, it should swallow the error and succeed promotion
    assert.doesNotThrow(() => promoteApprovedProposal(res2.id!));
    
    // But the entity name should remain 'First', because updates are not supported
    const entities = queryEntities({ namespace: 'org:tenantA' });
    assert.strictEqual(entities[0].name, 'First');
  });

  test('Cross-tenant relation pollution (target missing from tenant) should throw', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    const resA = submitProposal({
      tenant: 'org:tenantA', namespace: 'org:tenantA', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'eA', type: 'Agent', namespace: 'org:tenantA' }])
    });
    approveProposal(resA.id!);
    promoteApprovedProposal(resA.id!);

    const resB = submitProposal({
      tenant: 'org:tenantB', namespace: 'org:tenantB', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'eB', type: 'Agent', namespace: 'org:tenantB' }]),
      suggestedRelations: JSON.stringify([{ id: 'r1', type: 'USES', sourceId: 'eB', targetId: 'eA', namespace: 'org:tenantB' }])
    });
    approveProposal(resB.id!);

    // Should throw because eA belongs to tenantA, not global and not tenantB
    assert.throws(() => promoteApprovedProposal(resB.id!), /Relation without valid target entity/);
  });
});
