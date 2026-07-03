import type {
  FabricClientKind,
  FabricNamespace,
  FabricAccessScope,
  MemoryAccessMode,
  FabricRequestContext,
  FabricAccessDecision,
  AgentClientProfile,
  MemoryCandidate,
  MemoryAdmissionDecision,
  AdmissionOutcome
} from './types.ts';

import {
  FABRIC_CLIENT_KINDS,
  FABRIC_NAMESPACES,
  FABRIC_ACCESS_SCOPES
} from './types.ts';

export function normalizeClientKind(kind: string): FabricClientKind {
  return (FABRIC_CLIENT_KINDS as readonly string[]).includes(kind)
    ? (kind as FabricClientKind)
    : 'unknown';
}

export function normalizeNamespace(ns: string): FabricNamespace {
  return (FABRIC_NAMESPACES as readonly string[]).includes(ns)
    ? (ns as FabricNamespace)
    : 'unknown';
}

export function normalizeScope(scope: string): FabricAccessScope {
  return (FABRIC_ACCESS_SCOPES as readonly string[]).includes(scope)
    ? (scope as FabricAccessScope)
    : 'none';
}

interface Capabilities {
  read: boolean;
  propose: boolean;
  write: boolean;
  admin: boolean;
}

function getCapabilities(scope: FabricAccessScope): Capabilities {
  switch (scope) {
    case 'admin':
      return { read: true, propose: true, write: true, admin: true };
    case 'write':
      return { read: true, propose: true, write: true, admin: false };
    case 'read_propose':
      return { read: true, propose: true, write: false, admin: false };
    case 'read_only':
      return { read: true, propose: false, write: false, admin: false };
    case 'propose_only':
      return { read: false, propose: true, write: false, admin: false };
    case 'none':
    default:
      return { read: false, propose: false, write: false, admin: false };
  }
}

function capabilitiesToScope(caps: Capabilities): FabricAccessScope {
  if (caps.admin) return 'admin';
  if (caps.write) return 'write';
  if (caps.read && caps.propose) return 'read_propose';
  if (caps.read) return 'read_only';
  if (caps.propose) return 'propose_only';
  return 'none';
}

export function intersectScopes(a: FabricAccessScope, b: FabricAccessScope): FabricAccessScope {
  const capsA = getCapabilities(a);
  const capsB = getCapabilities(b);
  
  return capabilitiesToScope({
    read: capsA.read && capsB.read,
    propose: capsA.propose && capsB.propose,
    write: capsA.write && capsB.write,
    admin: capsA.admin && capsB.admin
  });
}

export function canRead(scope: FabricAccessScope): boolean {
  return getCapabilities(scope).read;
}

export function canPropose(scope: FabricAccessScope): boolean {
  return getCapabilities(scope).propose;
}

export function canWrite(scope: FabricAccessScope): boolean {
  return getCapabilities(scope).write;
}

export function canAdmin(scope: FabricAccessScope): boolean {
  return getCapabilities(scope).admin;
}

export function resolveClientProfile(kind: FabricClientKind): AgentClientProfile {
  switch (kind) {
    case 'hermes_agent':
    case 'oria_hq':
      return {
        kind,
        maxScope: 'admin',
        defaultNamespaces: ['personal', 'oria', 'hermes', 'code', 'health', 'finance'],
        mcpDirectSupport: 'verified'
      };
    case 'claude_code':
    case 'claude_desktop':
    case 'cursor':
      return {
        kind,
        maxScope: 'write',
        defaultNamespaces: ['code'],
        mcpDirectSupport: 'verified'
      };
    case 'gemini_api_adapter':
    case 'openai_agents':
      return {
        kind,
        maxScope: 'read_propose',
        defaultNamespaces: ['personal', 'code'],
        mcpDirectSupport: 'adapter_required'
      };
    case 'gemini_cli':
    case 'codex_style':
    case 'copilot_style':
    case 'deepseek_qwen_style':
      return {
        kind,
        maxScope: 'read_only',
        defaultNamespaces: ['code'],
        mcpDirectSupport: 'unknown'
      };
    case 'chatgpt_android':
    case 'gemini_android':
    case 'android_pwa':
      return {
        kind,
        maxScope: 'read_only',
        defaultNamespaces: ['personal'],
        mcpDirectSupport: 'unknown'
      };
    case 'unknown':
    default:
      return {
        kind,
        maxScope: 'none',
        defaultNamespaces: [],
        mcpDirectSupport: 'unknown'
      };
  }
}

export function effectiveScope(clientKind: FabricClientKind, tokenScope: FabricAccessScope): FabricAccessScope {
  if (clientKind === 'unknown') {
    return 'none';
  }
  const profile = resolveClientProfile(clientKind);
  return intersectScopes(profile.maxScope, tokenScope);
}

export function decideAccess(ctx: FabricRequestContext): FabricAccessDecision {
  const scope = effectiveScope(ctx.clientKind, ctx.scope);
  const caps = getCapabilities(scope);
  
  let allowed = false;
  switch (ctx.requestedMode) {
    case 'read': allowed = caps.read; break;
    case 'propose': allowed = caps.propose; break;
    case 'write': allowed = caps.write; break;
    case 'admin': allowed = caps.admin; break;
  }
  
  if (!allowed) {
    return {
      allowed: false,
      mode: ctx.requestedMode,
      reason: `Access denied. Effective scope '${scope}' does not permit '${ctx.requestedMode}'.`,
      requiresApproval: false
    };
  }
  
  return {
    allowed: true,
    mode: ctx.requestedMode,
    reason: `Access granted for '${ctx.requestedMode}' via scope '${scope}'.`,
    requiresApproval: ctx.requestedMode === 'admin'
  };
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function admitMemory(candidate: MemoryCandidate): MemoryAdmissionDecision {
  if (candidate.riskFlags.includes('secret_material')) {
    return {
      outcome: 'reject',
      adjustedConfidence: 0,
      reasons: ['Memory contains secret material and is rejected outright.']
    };
  }
  
  let confidence = clamp01(candidate.confidence);
  const reasons: string[] = [];
  let requiresReview = false;
  
  if (!candidate.provenance) {
    confidence = Math.min(confidence, 0.4);
    requiresReview = true;
    reasons.push('Missing provenance caps confidence to 0.4 and requires review.');
  }
  
  if (candidate.riskFlags.length > 0 && !candidate.riskFlags.includes('secret_material')) {
    requiresReview = true;
    reasons.push('High-risk flags detected, requires review.');
  }
  
  if (requiresReview) {
    return {
      outcome: 'requires_review',
      adjustedConfidence: confidence,
      reasons
    };
  }
  
  return {
    outcome: 'auto_admit',
    adjustedConfidence: confidence,
    reasons: ['Safe for auto-admission.']
  };
}

/**
 * Escalation threshold: an 'active' memory whose EFFECTIVE confidence
 * (declared confidence x temporal decay) meets this bar is context-eligible
 * without human verification. This unblocks autonomous operation while
 * keeping low-confidence or stale material behind human review.
 */
export const ACTIVE_ELIGIBILITY_THRESHOLD = 0.8;

export function isContextEligible(status: string, effectiveConfidence?: number): boolean {
  if (status === 'verified') return true;
  if (status === 'active') {
    return typeof effectiveConfidence === 'number'
      && effectiveConfidence >= ACTIVE_ELIGIBILITY_THRESHOLD;
  }
  return false;
}
