import { initGraph, addEntity, addRelation, queryEntities, queryRelations, buildContextPack, exportGraph, closeGraph } from './graph.ts';

const args = process.argv.slice(2);
const command = args[0];

const params: Record<string, string> = {};
let currentKey = '';
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('-')) {
    currentKey = args[i].replace(/^-+/, '').toLowerCase();
  } else if (currentKey) {
    params[currentKey] = args[i];
    currentKey = '';
  }
}

try {
  const isReadOnly = ['query', 'context-pack', 'export'].includes(command);
  initGraph(undefined, isReadOnly);

  if (command === 'add-entity') {
    if (!params.type || !params.namespace) throw new Error('Missing Type or Namespace');
    const id = addEntity({ type: params.type, namespace: params.namespace, name: params.name });
    console.log(JSON.stringify({ success: true, id }));
  } else if (command === 'add-relation') {
    if (!params.type || !params.sourceid || !params.targetid || !params.namespace) throw new Error('Missing arguments');
    const id = addRelation({ type: params.type, sourceId: params.sourceid, targetId: params.targetid, namespace: params.namespace });
    console.log(JSON.stringify({ success: true, id }));
  } else if (command === 'query') {
    const type = params.entitytype || params.type;
    const res = queryEntities({ type, namespace: params.namespace });
    console.log(JSON.stringify(res, null, 2));
  } else if (command === 'context-pack') {
    if (!params.entityid || !params.namespace) throw new Error('Missing EntityId or Namespace');
    const res = buildContextPack({ entityId: params.entityid, namespace: params.namespace });
    console.log(JSON.stringify(res, null, 2));
  } else if (command === 'export') {
    const res = exportGraph(params.namespace);
    console.log(JSON.stringify(res, null, 2));
  } else if (command === 'init') {
    console.log(JSON.stringify({ success: true, message: 'Graph DB initialized.' }));
  }
} catch (e: any) {
  console.error(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
} finally {
  closeGraph();
}
