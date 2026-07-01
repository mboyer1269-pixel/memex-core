import { initGraph, closeGraph, addEntity, queryEntities, exportGraph } from '../src/graph.ts';
import { agentmemory_librarian_brief, agentmemory_latest_updates } from '../src/memory/librarian.ts';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

async function runTests() {
  const dbPath = path.resolve(process.cwd(), 'data', 'stress_test.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  initGraph(dbPath);

  console.log('Inserting 15,000 entities...');
  // We bypass addEntity for speed, inserting directly
  const db = new Database(dbPath);
  const stmt = db.prepare(`
    INSERT INTO entities (id, type, namespace, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  db.transaction(() => {
    for (let i = 0; i < 15000; i++) {
      stmt.run(`ent-${i}`, 'Project', 'org:test', new Date().toISOString(), new Date().toISOString());
    }
  })();
  db.close();

  // Re-init to use our graph module
  initGraph(dbPath);

  console.log('Testing limit bypass in queryEntities...');
  let passed = true;

  try {
    const q1 = queryEntities({ limit: undefined as any });
    if (q1.length !== 10000) {
      console.error(`FAIL: expected 10000, got ${q1.length} for limit: undefined`);
      passed = false;
    }

    const q2 = queryEntities({ limit: null as any });
    if (q2.length !== 10000) {
      console.error(`FAIL: expected 10000, got ${q2.length} for limit: null`);
      passed = false;
    }

    const q3 = queryEntities({ limit: NaN as any });
    if (q3.length !== 10000) {
      console.error(`FAIL: expected 10000, got ${q3.length} for limit: NaN`);
      passed = false;
    }

    const q4 = queryEntities({ limit: 15000 });
    if (q4.length !== 10000) {
      console.error(`FAIL: expected 10000, got ${q4.length} for limit: 15000`);
      passed = false;
    }

    const q5 = queryEntities({ limit: 50 });
    if (q5.length !== 50) {
      console.error(`FAIL: expected 50, got ${q5.length} for limit: 50`);
      passed = false;
    }
  } catch (e) {
    console.error('FAIL: Error during queryEntities tests', e);
    passed = false;
  }

  console.log('Testing exportGraph returns all rows...');
  try {
    const exported = exportGraph();
    if (exported.entities.length !== 15000) {
      console.error(`FAIL: exportGraph returned ${exported.entities.length}, expected 15000`);
      passed = false;
    }
  } catch (e) {
    console.error('FAIL: Error during exportGraph tests', e);
    passed = false;
  }

  console.log('Testing librarian brief...');
  try {
    // librarian brief with a strict budget
    const brief = agentmemory_librarian_brief('org:test', 'test task', 50); // 200 chars
    if (brief.length > 200) {
      console.error(`FAIL: librarian brief exceeded budget. length: ${brief.length}, max: 200`);
      passed = false;
    }
  } catch (e) {
    console.error('FAIL: Error during librarian tests', e);
    passed = false;
  }

  closeGraph();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  if (passed) {
    console.log('ALL TESTS PASSED');
  } else {
    console.log('SOME TESTS FAILED');
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
