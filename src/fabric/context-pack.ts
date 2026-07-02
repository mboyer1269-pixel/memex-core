import type {
  ContextPackRequest,
  ContextPackResponse,
  MemoryCandidate,
  ContextPackItem,
  MemoryKind
} from './types.ts';
import { decideAccess, isContextEligible } from './policy.ts';

export function assembleContextPack(
  request: ContextPackRequest,
  candidates: MemoryCandidate[],
  now: Date = new Date()
): ContextPackResponse {
  // Check read access
  const accessReq = { ...request.requester, requestedMode: 'read' as const };
  const decision = decideAccess(accessReq);
  
  if (!decision.allowed) {
    throw new Error(`Access denied: ${decision.reason}`);
  }

  const items: ContextPackItem[] = [];
  const excluded: Array<{ memoryId: string; reason: string }> = [];

  for (const candidate of candidates) {
    if (candidate.namespace !== request.namespace) {
      excluded.push({ memoryId: candidate.id, reason: 'Cross-namespace memory is excluded.' });
      continue;
    }

    if (!isContextEligible(candidate.status)) {
      excluded.push({ memoryId: candidate.id, reason: `Status '${candidate.status}' is not eligible (only verified).` });
      continue;
    }

    if (candidate.validTo) {
      const validToDate = new Date(candidate.validTo);
      if (validToDate < now) {
        excluded.push({ memoryId: candidate.id, reason: 'Memory has expired based on validTo.' });
        continue;
      }
    }

    // Determine whyIncluded based on kind
    let whyIncluded = `Included as relevant ${candidate.kind} memory for ${request.packKind}.`;
    if (candidate.kind === 'failure') {
      whyIncluded = 'Included as critical failure memory (scar tissue) to prevent repeating mistakes.';
    } else if (candidate.kind === 'decision') {
      whyIncluded = 'Included as decision memory for architectural or operational context.';
    }

    items.push({
      memoryId: candidate.id,
      kind: candidate.kind,
      status: candidate.status,
      content: candidate.content,
      confidence: candidate.confidence,
      whyIncluded,
      source: candidate.provenance ? candidate.provenance.source : 'unknown',
      riskFlags: candidate.riskFlags,
      validFrom: candidate.validFrom,
      validTo: candidate.validTo,
      revocationPath: `fabric://${candidate.namespace}/memories/${candidate.id}/revoke`
    });
  }

  // Sorting: failure, decision, confidence descending
  const kindRank: Record<MemoryKind, number> = {
    failure: 0,
    decision: 1,
    semantic: 2,
    episodic: 2,
    procedural: 2
  };

  items.sort((a, b) => {
    const rankA = kindRank[a.kind];
    const rankB = kindRank[b.kind];
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return b.confidence - a.confidence;
  });

  // Apply maxItems constraint
  let finalItems = items;
  if (request.maxItems > 0 && items.length > request.maxItems) {
    const toExclude = items.slice(request.maxItems);
    for (const item of toExclude) {
      excluded.push({ memoryId: item.memoryId, reason: 'Excluded due to maxItems limit.' });
    }
    finalItems = items.slice(0, request.maxItems);
  }

  return {
    packKind: request.packKind,
    namespace: request.namespace,
    generatedAt: now.toISOString(),
    items: finalItems,
    excluded
  };
}
