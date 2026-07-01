import { initGraph, addEntity, queryEntities, buildContextPack, getNeighbors } from './graph';

initGraph(':memory:', false);

for(let i = 0; i < 15; i++) {
  addEntity({
    type: 'User',
    namespace: 'global',
    name: 'User ' + i
  });
}

const allWithoutLimit = queryEntities({ type: 'User' });
console.log('Without limit, got:', allWithoutLimit.length); // should be 15

const withLimit = queryEntities({ type: 'User', limit: 5 });
console.log('With limit 5, got:', withLimit.length); // should be 5

const withNaNLimit = queryEntities({ type: 'User', limit: 'abc' as any });
console.log('With NaN limit, got:', withNaNLimit.length); // should be 15, wait, if limit is 10000, it gets all 15.

// Let's add more than 10000? No, that's too slow. 
// We just wanted to see that without limit, it returns all.

// ContextPack test
const centerId = addEntity({ type: 'Memory', namespace: 'global', name: 'Center' });
console.log('Context pack with NaN maxRelations:');
try {
  const pack = buildContextPack({
    entityId: centerId,
    namespace: 'global',
    maxRelations: 'abc' as any
  });
  console.log('Context pack ran, relations limit passed as NaN');
} catch(e) {
  console.error('Error:', e);
}

