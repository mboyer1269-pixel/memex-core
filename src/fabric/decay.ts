/**
 * Temporal Decay — Ebbinghaus forgetting curve (R2).
 * ---------------------------------------------------
 * R(t) = e^(-t / S)  where S is the memory stability in days.
 *
 * A memory's *effective* confidence is its declared confidence multiplied
 * by retention. Old episodic details fade fast; procedural SOPs and failure
 * scar-tissue stay relevant for months. Nothing mutates validTo — decay is
 * a pure read-time computation, fully deterministic and testable.
 */

import type { MemoryKind } from './types.ts';

/** Stability (S) per memory kind, in days. */
export const STABILITY_DAYS: Record<MemoryKind, number> = {
  procedural: 90,   // how-to knowledge ages slowly
  semantic: 30,     // world facts drift over weeks
  episodic: 7,      // "what happened" loses value fast
  failure: 180,     // scar tissue must persist — repeating failures is costly
  decision: 60,     // decisions stay binding for a couple of months
};

/** Effective confidence below this is auto-excluded from context packs. */
export const DECAY_EXCLUSION_FLOOR = 0.1;

const MS_PER_DAY = 86_400_000;

/** Retention factor in [0, 1] for a memory of the given kind and age. */
export function retention(kind: MemoryKind, ageDays: number): number {
  if (!(ageDays > 0)) return 1; // future or invalid timestamps: no decay
  const stability = STABILITY_DAYS[kind] ?? STABILITY_DAYS.semantic;
  return Math.exp(-ageDays / stability);
}

/**
 * Declared confidence x Ebbinghaus retention, anchored on validFrom.
 * Invalid dates degrade gracefully to the declared confidence.
 */
export function effectiveConfidence(
  candidate: { kind: MemoryKind; confidence: number; validFrom: string },
  now: Date = new Date()
): number {
  const from = new Date(candidate.validFrom).getTime();
  if (Number.isNaN(from)) return candidate.confidence;
  const ageDays = (now.getTime() - from) / MS_PER_DAY;
  return candidate.confidence * retention(candidate.kind, ageDays);
}
