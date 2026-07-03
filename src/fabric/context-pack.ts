import type {
  ContextPackRequest,
  ContextPackResponse,
  MemoryCandidate,
  ContextPackItem,
  MemoryKind
} from './types.ts';
import { decideAccess, isContextEligible, ACTIVE_ELIGIBILITY_THRESHOLD } from './policy.ts';
import { effectiveConfidence, DECAY_EXCLUSION_FLOOR } from './decay.ts';

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

    // Ebbinghaus temporal decay: effective = declared confidence x e^(-age/S)
    const effConfidence = effectiveConfidence(candidate, now);

    // Eligibility: 'verified' always; 'active' auto-escalates when its
    // effective confidence clears the threshold — no human bottleneck for
    // fresh, high-confidence memories.
    if (!isContextEligible(candidate.status, effConfidence)) {
      const detail = candidate.status === 'active'
        ? ` (verified, or active with effective confidence >= ${ACTIVE_ELIGIBILITY_THRESHOLD}; got ${effConfidence.toFixed(3)})`
        : ' (only verified, or active above the confidence threshold)';
      excluded.push({
        memoryId: candidate.id,
        reason: `Status '${candidate.status}' is not eligible${detail}.`
      });
      continue;
    }

    // Decay floor: even verified memories that have decayed to noise are cut,
    // UNLESS they are failure memories (scar tissue never fades away silently).
    if (candidate.status !== 'verified' && candidate.kind !== 'failure' && effConfidence < DECAY_EXCLUSION_FLOOR) {
      excluded.push({
        memoryId: candidate.id,
        reason: `Effective confidence ${effConfidence.toFixed(3)} decayed below floor ${DECAY_EXCLUSION_FLOOR}.`
      });
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
    if (candidate.status === 'active') {
      whyIncluded += ` Auto-escalated: active with effective confidence ${effConfidence.toFixed(3)} >= ${ACTIVE_ELIGIBILITY_THRESHOLD}.`;
    }

    items.push({
      memoryId: candidate.id,
      kind: candidate.kind,
      status: candidate.status,
      content: candidate.content,
      confidence: candidate.confidence,
      effectiveConfidence: effConfidence,
      whyIncluded,
      source: candidate.provenance ? candidate.provenance.source : 'unknown',
      riskFlags: candidate.riskFlags,
      validFrom: candidate.validFrom,
      validTo: candidate.validTo,
      revocationPath: `fabric://${candidate.namespace}/memories/${candidate.id}/revoke`
    });
  }

  // Sorting: failure, decision, then decayed (effective) confidence descending
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
    return (b.effectiveConfidence ?? b.confidence) - (a.effectiveConfidence ?? a.confidence);
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
