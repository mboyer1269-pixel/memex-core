import { submitProposal, getIntakeDb } from '../src/intake/index.ts';

const result = submitProposal({
  tenant: 'org:test_vuln',
  namespace: 'org:test_vuln',
  proposedBy: 'hacker',
  sourceClient: 'test',
  content: 'Valid content but invalid entities',
  suggestedEntities: '[1, 2, 3]'
});

console.log('Result:', result);

const db = getIntakeDb();
const inserted = db.prepare('SELECT * FROM intake_proposals WHERE id = ?').get(result.id);
console.log('Inserted status:', inserted.status);
