import type { MemoryContextOutput } from './context-provider.ts';

export function buildMemoryPromptSection(memoryContext: MemoryContextOutput): string {
  const parts: string[] = [];

  parts.push('## AgentMemory Graph Context');

  if (memoryContext.warnings && memoryContext.warnings.length > 0) {
    parts.push('### Warnings');
    memoryContext.warnings.forEach(w => parts.push(`- ${w}`));
  }

  const { graphContext } = memoryContext;

  if (graphContext && graphContext.centerEntity) {
    parts.push('### Core Entity');
    parts.push(`- **${graphContext.centerEntity.type}**: ${graphContext.centerEntity.name || graphContext.centerEntity.id}`);
  }

  if (graphContext && graphContext.entities && graphContext.entities.length > 0) {
    parts.push('### Related Entities');
    graphContext.entities.forEach((e: any) => {
      if (!graphContext.centerEntity || e.id !== graphContext.centerEntity.id) {
        parts.push(`- [${e.type}] ${e.name || e.id} (Namespace: ${e.namespace})`);
      }
    });
  }

  if (graphContext && graphContext.relations && graphContext.relations.length > 0) {
    parts.push('### Relations');
    graphContext.relations.forEach((r: any) => {
      parts.push(`- ${r.sourceId} --[${r.type}]--> ${r.targetId}`);
    });
  } else {
    parts.push('### Relations\n- None found.');
  }

  if (memoryContext.provenance && memoryContext.provenance.length > 0) {
    parts.push('### Provenance');
    // Deduplicate provenance by source for cleaner output
    const uniqueSources = new Set<string>();
    memoryContext.provenance.forEach(p => uniqueSources.add(p.source));
    uniqueSources.forEach(source => parts.push(`- Source: ${source}`));
  }

  return parts.join('\n\n');
}
