import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { initGraph, addEntity, addRelation, queryEntities, queryRelations, closeGraph } from "../src/graph.ts";
import { initIntake, getIntakeDb } from "../src/db/intake.ts";
import { submitProposal, listPendingProposals, approveProposal, rejectProposal, promoteProposal, readProposal } from "../src/intake/index.ts";

test("Cross-Tenant Injection: tenant-A can create relations between tenant-B entities", () => {
  initGraph(':memory:');
  initIntake(':memory:');

  const b1 = addEntity({ id: "ent-b1", type: "User", namespace: "org:tenant-B" });
  const b2 = addEntity({ id: "ent-b2", type: "User", namespace: "org:tenant-B" });

  const p = submitProposal({
    tenant: "tenant-A",
    namespace: "org:tenant-A",
    proposedBy: "user-A",
    sourceClient: "test",
    content: "relating B entities",
    suggestedRelations: JSON.stringify([{
      type: "OWNS",
      sourceId: b1,
      targetId: b2
    }])
  });

  assert.strictEqual(p.status, "proposed");
  approveProposal(p.id!);
  
  // This should throw if the system was secure against cross-tenant injection
  // because tenant-A is creating a relation for entities it doesn't own!
  promoteProposal(p.id!);

  const relsA = queryRelations({ namespace: "org:tenant-A" });
  assert.strictEqual(relsA.length, 1);
  assert.strictEqual(relsA[0].sourceId, b1);
  assert.strictEqual(relsA[0].targetId, b2);
  assert.strictEqual(relsA[0].namespace, "org:tenant-A");
});

test("Cross-Database Atomicity (Idempotency): silently skips entities on duplicate ID", () => {
  initGraph(':memory:');
  initIntake(':memory:');

  // tenant-B has an entity
  addEntity({ id: "collision-id", type: "User", namespace: "org:tenant-B", properties: { key: "valueB" } });

  // tenant-A proposes an entity with the same ID but different properties
  const p = submitProposal({
    tenant: "tenant-A",
    namespace: "org:tenant-A",
    proposedBy: "user-A",
    sourceClient: "test",
    content: "creating my entity",
    suggestedEntities: JSON.stringify([{
      id: "collision-id",
      type: "User",
      name: "Tenant A Entity",
      properties: { key: "valueA" }
    }])
  });

  approveProposal(p.id!);
  // promoteProposal will catch the "duplicate" error and ignore it!
  promoteProposal(p.id!);

  const pAfter = readProposal(p.id!);
  assert.strictEqual(pAfter?.status, "promoted");

  // But the entity for tenant-A was NOT inserted!
  const entsA = queryEntities({ namespace: "org:tenant-A" });
  assert.strictEqual(entsA.length, 0); // tenant-A lost their data without warning!

  // tenant-B's entity is unmodified
  const entsB = queryEntities({ namespace: "org:tenant-B" });
  assert.strictEqual(entsB[0].properties.key, "valueB");
});

test("TOCTOU Race Condition: promoteProposal blindly updates status", () => {
  initGraph(':memory:');
  initIntake(':memory:');

  const p = submitProposal({
    tenant: "tenant-A",
    namespace: "org:tenant-A",
    proposedBy: "user",
    sourceClient: "test",
    content: "test toctou"
  });

  approveProposal(p.id!);

  // Simulate TOCTOU:
  // Thread A starts promoteProposal and reads the proposal
  const proposalA = readProposal(p.id!);
  assert.strictEqual(proposalA?.status, "approved");

  // Thread B jumps in and rejects the proposal!
  rejectProposal(p.id!);
  assert.strictEqual(readProposal(p.id!)?.status, "rejected");

  // Thread A continues execution:
  const db = getIntakeDb();
  // (Thread A performs runInTransaction logic...)
  // Thread A finishes and updates status
  db.prepare("UPDATE intake_proposals SET status = 'promoted' WHERE id = ?").run(p.id!);

  // The proposal is now promoted, completely ignoring Thread B's rejection!
  assert.strictEqual(readProposal(p.id!)?.status, "promoted");
});

test("Missing sourceId Validation: Oracle vulnerability for entity discovery", () => {
  initGraph(':memory:');
  initIntake(':memory:');

  // tenant-B has a secret entity
  addEntity({ id: "secret-ent-b", type: "User", namespace: "org:tenant-B" });

  // tenant-A guesses the ID in sourceId
  const p = submitProposal({
    tenant: "tenant-A",
    namespace: "org:tenant-A",
    proposedBy: "user",
    sourceClient: "test",
    content: "guessing ID",
    suggestedRelations: JSON.stringify([{
      type: "OWNS",
      sourceId: "secret-ent-b", // guessed correctly!
      targetId: "secret-ent-b"
    }])
  });

  // Because the entity exists globally, the proposal is accepted!
  assert.strictEqual(p.status, "proposed");

  // If tenant-A guesses WRONG:
  const pWrong = submitProposal({
    tenant: "tenant-A",
    namespace: "org:tenant-A",
    proposedBy: "user",
    sourceClient: "test",
    content: "guessing wrong ID",
    suggestedRelations: JSON.stringify([{
      type: "OWNS",
      sourceId: "non-existent-id", // guessed wrong!
      targetId: "secret-ent-b"
    }])
  });

  // It gets rejected!
  assert.strictEqual(pWrong.status, "rejected");
  assert.ok(pWrong.warnings![0].includes("without valid source entity"));

  // Thus, tenant-A has an oracle to discover ANY entity ID in the system!
});
