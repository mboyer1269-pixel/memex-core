import { buildContextPack } from '../graph.ts';

export interface MemoryContextInput {
  tenant: string;
  namespace: string;
  centerEntityId: string;
  depth?: number;
  maxEntities?: number;
  maxRelations?: number;
}

export interface MemoryContextOutput {
  graphContext: any;
  provenance: any[];
  warnings: string[];
  tokenEstimate: number;
}

export function getMemoryContext(input: MemoryContextInput): MemoryContextOutput {
  const warnings: string[] = [];
  const provenance: any[] = [];
  let graphContext: any = null;

  const pack = buildContextPack({
    entityId: input.centerEntityId,
    namespace: input.namespace,
    maxRelations: input.maxRelations
  });

  // In a real scenario, depth logic would iterate further or filter by depth. 
  // Here we respect maxEntities.
  if (input.maxEntities && pack.entities && pack.entities.length > input.maxEntities) {
    pack.entities = pack.entities.slice(0, input.maxEntities);
    warnings.push(`Entities truncated to maxEntities (${input.maxEntities})`);
  }

  graphContext = pack;
  if (input.tenant) graphContext.tenant = input.tenant;
  if (input.depth) graphContext.depth = input.depth;

  // Collect provenance from entities and relations
  const collectProvenance = (items: any[]) => {
    items.forEach(item => {
      if (item.source || item.originId) {
        provenance.push({
          id: item.id,
          source: item.source || 'unknown',
          originId: item.originId || null,
          confidence: item.confidence || null
        });
      }
    });
  };

  if (pack.entities) collectProvenance(pack.entities);
  if (pack.relations) collectProvenance(pack.relations);

  // Rough estimate: ~2 chars per token
  const contextStr = JSON.stringify(graphContext);
  const tokenEstimate = Math.ceil(contextStr.length / 2);

  return {
    graphContext,
    provenance,
    warnings,
    tokenEstimate
  };
}
