import { test, suite } from 'node:test';
import * as assert from 'node:assert';
import { 
  initIntake, submitProposal, listPendingProposals, readProposal, 
  approveProposal, rejectProposal, promoteApprovedProposal 
} from '../src/intake.ts';
import { initGraph, queryEntities, queryRelations, exportGraph } from '../src/graph.ts';

suite('Tier 1: F1. Intake Queue Model', () => {
  test('Should initialize intake queue without errors', () => {
    assert.doesNotThrow(() => initIntake(':memory:'));
  });

  test('Should return saved proposal with all fields present', () => {
    initIntake(':memory:');
    const result = submitProposal({
      tenant: 'org:test',
      namespace: 'org:test',
      proposedBy: 'agent-1',
      sourceClient: 'claude',
      content: 'Test content',
      suggestedEntities: JSON.stringify([{ type: 'Agent', id: 'a1', namespace: 'org:test' }, { type: 'Agent', id: 'a2', namespace: 'org:test' }]),
      suggestedRelations: JSON.stringify([{ type: 'USES', sourceId: 'a1', targetId: 'a2', namespace: 'org:test' }]),
      provenance: 'Some doc',
      confidence: 0.9,
      riskFlags: 'None'
    });
    const prop = readProposal(result.id!);
    assert.ok(prop);
    assert.strictEqual(prop.tenant, 'org:test');
    assert.strictEqual(prop.namespace, 'org:test');
    assert.strictEqual(prop.status, 'proposed');
  });

  test('Should handle minimal valid payload missing optional fields', () => {
    initIntake(':memory:');
    const result = submitProposal({
      tenant: 'org:test',
      namespace: 'org:test',
      proposedBy: 'agent-1',
      sourceClient: 'claude',
      content: 'Minimal content'
    });
    assert.ok(result.id);
  });

  test('Should strictly define default status as proposed', () => {
    initIntake(':memory:');
    const result = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c'
    });
    const prop = readProposal(result.id!);
    assert.strictEqual(prop?.status, 'proposed');
  });

  test('Should record timestamps on creation and review', () => {
    initIntake(':memory:');
    const result = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c'
    });
    const prop = readProposal(result.id!);
    assert.ok(prop?.createdAt);
    assert.strictEqual(prop?.reviewedAt, undefined);
  });
});

suite('Tier 1: F2. Submit Proposal MCP', () => {
  test('Should successfully submit a valid proposal and return ID', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c'
    });
    assert.ok(res.id);
    assert.strictEqual(res.status, 'proposed');
  });

  test('Should maintain sourceClient and proposedBy', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'agentX', sourceClient: 'clientY', content: 'c'
    });
    const p = readProposal(res.id!);
    assert.strictEqual(p?.proposedBy, 'agentX');
    assert.strictEqual(p?.sourceClient, 'clientY');
  });

  test('Should accept JSON strings for suggested entities', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ type: 'Agent', namespace: 'org:t' }])
    });
    const p = readProposal(res.id!);
    assert.ok(p?.suggestedEntities);
    const parsed = JSON.parse(p.suggestedEntities!);
    assert.strictEqual(parsed[0].type, 'Agent');
  });

  test('Should accept JSON strings for suggested relations', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedRelations: JSON.stringify([{ type: 'USES', sourceId: '1', targetId: '2', namespace: 'org:t' }])
    });
    const p = readProposal(res.id!);
    assert.ok(p?.suggestedRelations);
  });

  test('Should strictly preserve tenant and namespace bindings', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:tenant123', namespace: 'org:tenant123', proposedBy: 'a', sourceClient: 'c', content: 'c'
    });
    const p = readProposal(res.id!);
    assert.strictEqual(p?.tenant, 'org:tenant123');
    assert.strictEqual(p?.namespace, 'org:tenant123');
  });
});

suite('Tier 1: F3. Built-in Validator', () => {
  test('Should return warnings for empty content payload', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: ''
    });
    assert.strictEqual(res.status, 'rejected'); // or proposed with warnings, specification says "refuse empty payload" "returns controlled warnings"
    assert.ok(res.warnings?.length! > 0);
  });

  test('Should return warnings for invalid namespace', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'invalid-ns', namespace: 'invalid-ns', proposedBy: 'a', sourceClient: 'c', content: 'c'
    });
    assert.ok(res.warnings?.some(w => w.includes('namespace')));
  });

  test('Should detect and warn on excessively large payload', () => {
    initIntake(':memory:');
    const largeContent = 'a'.repeat(1000000);
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: largeContent
    });
    assert.ok(res.warnings?.some(w => w.includes('size') || w.includes('large')));
  });

  test('Should detect probable duplicates', () => {
    initIntake(':memory:');
    const p1 = { tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'Identical content' };
    submitProposal(p1);
    const res2 = submitProposal(p1);
    assert.ok(res2.warnings?.some(w => w.toLowerCase().includes('duplicate')));
  });

  test('Should warn on relations without valid target entities', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedRelations: JSON.stringify([{ type: 'USES', sourceId: 'none', targetId: 'none', namespace: 'org:t' }])
    });
    assert.ok(res.warnings?.some(w => w.toLowerCase().includes('target') || w.toLowerCase().includes('entity')));
  });
});

suite('Tier 1: F4. Graph Isolation', () => {
  test('Should not insert entities into main graph when proposed', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ type: 'Agent', namespace: 'org:t', id: 'test-agent' }])
    });
    const entities = queryEntities({ namespace: 'org:t' });
    assert.strictEqual(entities.length, 0);
  });

  test('Should not insert relations into main graph when proposed', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedRelations: JSON.stringify([{ type: 'USES', sourceId: 'a1', targetId: 'a2', namespace: 'org:t' }])
    });
    const relations = queryRelations({ namespace: 'org:t' });
    assert.strictEqual(relations.length, 0);
  });

  test('Graph export should remain unchanged after submitting proposals', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const exportBefore = exportGraph();
    submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    const exportAfter = exportGraph();
    assert.deepStrictEqual(exportBefore, exportAfter);
  });

  test('Should not affect main graph entity queries', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    const count = queryEntities({}).length;
    assert.strictEqual(count, 0);
  });

  test('Should not affect main graph relation queries', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    const count = queryRelations({}).length;
    assert.strictEqual(count, 0);
  });
});

suite('Tier 1: F5. Admin Review API', () => {
  test('Should list all pending proposals', () => {
    initIntake(':memory:');
    submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c1' });
    submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c2' });
    const pending = listPendingProposals();
    assert.strictEqual(pending.length, 2);
  });

  test('Should read a specific proposal by ID', () => {
    initIntake(':memory:');
    const res = submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'test-read' });
    const prop = readProposal(res.id!);
    assert.strictEqual(prop?.content, 'test-read');
  });

  test('Should update status to approved', () => {
    initIntake(':memory:');
    const res = submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    approveProposal(res.id!);
    const prop = readProposal(res.id!);
    assert.strictEqual(prop?.status, 'approved');
  });

  test('Should update status to rejected', () => {
    initIntake(':memory:');
    const res = submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    rejectProposal(res.id!);
    const prop = readProposal(res.id!);
    assert.strictEqual(prop?.status, 'rejected');
  });

  test('Should not include rejected proposals in pending list', () => {
    initIntake(':memory:');
    const res = submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    rejectProposal(res.id!);
    const pending = listPendingProposals();
    assert.strictEqual(pending.length, 0);
  });
});

suite('Tier 1: F6. Promotion logic', () => {
  test('Should promote an approved proposal into main graph', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ type: 'Agent', namespace: 'org:t', name: 'agent-z' }])
    });
    approveProposal(res.id!);
    promoteApprovedProposal(res.id!);
    const entities = queryEntities({ namespace: 'org:t' });
    assert.strictEqual(entities.length, 1);
    assert.strictEqual(entities[0].name, 'agent-z');
  });

  test('Should fail to promote a rejected proposal', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const res = submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    rejectProposal(res.id!);
    assert.throws(() => promoteApprovedProposal(res.id!));
  });

  test('Should fail to promote a pending proposal', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const res = submitProposal({ tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c' });
    assert.throws(() => promoteApprovedProposal(res.id!));
  });

  test('Should map properties and relationships correctly on promotion', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([
        { id: 'e1', type: 'Agent', namespace: 'org:t' },
        { id: 'e2', type: 'Task', namespace: 'org:t' }
      ]),
      suggestedRelations: JSON.stringify([
        { type: 'ASSIGNED_TO', sourceId: 'e2', targetId: 'e1', namespace: 'org:t' }
      ])
    });
    approveProposal(res.id!);
    promoteApprovedProposal(res.id!);
    const relations = queryRelations({ namespace: 'org:t' });
    assert.strictEqual(relations.length, 1);
    assert.strictEqual(relations[0].type, 'ASSIGNED_TO');
  });

  test('Should preserve provenance metadata on promotion', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'agentX', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:t' }]),
      provenance: 'doc-source-123'
    });
    approveProposal(res.id!);
    promoteApprovedProposal(res.id!);
    const entities = queryEntities({ namespace: 'org:t' });
    assert.strictEqual(entities[0].source, 'doc-source-123'); // Or some audit mapped field
  });
});

suite('Tier 4: Scenarios', () => {
  test('Scenario 1: Submit -> Approve -> Promote -> Verify Graph', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    // Submit
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:t' }])
    });
    assert.strictEqual(res.status, 'proposed');
    assert.strictEqual(queryEntities({ namespace: 'org:t' }).length, 0);

    // Approve
    approveProposal(res.id!);
    assert.strictEqual(readProposal(res.id!)?.status, 'approved');

    // Promote
    promoteApprovedProposal(res.id!);
    assert.strictEqual(readProposal(res.id!)?.status, 'promoted');

    // Verify Graph
    const entities = queryEntities({ namespace: 'org:t' });
    assert.strictEqual(entities.length, 1);
    assert.strictEqual(entities[0].id, 'e1');
  });

  test('Scenario 2: Submit -> Reject -> Verify NO Promotion', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    const res = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:t' }])
    });

    rejectProposal(res.id!);
    assert.strictEqual(readProposal(res.id!)?.status, 'rejected');

    assert.throws(() => promoteApprovedProposal(res.id!));

    assert.strictEqual(queryEntities({ namespace: 'org:t' }).length, 0);
  });

  test('Scenario 3: Submit Invalid -> Verify Validator Block', () => {
    initIntake(':memory:');
    const res = submitProposal({
      tenant: 'invalid', namespace: 'invalid', proposedBy: 'a', sourceClient: 'c', content: ''
    });
    
    assert.ok(res.warnings && res.warnings.length > 0);
    // Might not return an id or return as rejected depending on implementation.
    // Spec: "refuse payload empty... returns warnings".
  });

  test('Scenario 4: Submit Valid -> Verify NO Graph Mutation', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'c',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:t' }])
    });

    assert.strictEqual(queryEntities({ namespace: 'org:t' }).length, 0);
  });

  test('Scenario 5: Mixed Batch (Valid + Invalid + Duplicates)', () => {
    initGraph(':memory:', false);
    initIntake(':memory:');
    
    // Valid 1
    const p1 = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'v1',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:t' }])
    });
    // Invalid 1
    const pInvalid = submitProposal({
      tenant: 'invalid', namespace: 'invalid', proposedBy: 'a', sourceClient: 'c', content: ''
    });
    // Duplicate of Valid 1
    const pDup = submitProposal({
      tenant: 'org:t', namespace: 'org:t', proposedBy: 'a', sourceClient: 'c', content: 'v1',
      suggestedEntities: JSON.stringify([{ id: 'e1', type: 'Agent', namespace: 'org:t' }])
    });
    assert.strictEqual(pDup.id, p1.id);

    // Review Actions
    approveProposal(p1.id!);
    
    // Attempt promote on invalid or dup - should throw or they shouldn't exist
    assert.throws(() => promoteApprovedProposal(pInvalid.id!));
    
    promoteApprovedProposal(p1.id!);

    assert.strictEqual(queryEntities({ namespace: 'org:t' }).length, 1);
  });
});
