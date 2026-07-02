/**
 * Michael Memory Fabric — Type Foundation
 * ----------------------------------------
 * Pure types + const vocabularies. Zero runtime dependencies.
 * Zero DB. Zero network. Zero MCP runtime coupling.
 *
 * Design rule: Node `--experimental-strip-types` compatible.
 * => NO enums, NO namespaces, NO parameter properties.
 *    Only erasable syntax: string-literal unions + `as const` arrays.
 *
 * This file is the single vocabulary source for the Fabric.
 * policy.ts and context-pack.ts import from here and nowhere else.
 */

// ── Client identity ────────────────────────────────────────────────

export const FABRIC_CLIENT_KINDS = [
  'claude_code',
  'claude_desktop',
  'openai_agents',
  'codex_style',
  'gemini_cli',
  'gemini_api_adapter',
  'chatgpt_android',      // direct custom MCP support: UNKNOWN — adapter path only
  'gemini_android',       // direct custom MCP support: UNKNOWN — adapter path only
  'cursor',
  'copilot_style',
  'deepseek_qwen_style',
  'hermes_agent',         // first-class internal client
  'oria_hq',              // first-class internal client
  'android_pwa',
  'unknown',
] as const;

export type FabricClientKind = (typeof FABRIC_CLIENT_KINDS)[number];

// ── Access scopes (token-level authority) ──────────────────────────

export const FABRIC_ACCESS_SCOPES = [
  'read_only',
  'propose_only',
  'read_propose',
  'write',
  'admin',
  'none',
] as const;

export type FabricAccessScope = (typeof FABRIC_ACCESS_SCOPES)[number];

// ── Access modes (what an operation is trying to do) ───────────────

export const MEMORY_ACCESS_MODES = ['read', 'propose', 'write', 'admin'] as const;
export type MemoryAccessMode = (typeof MEMORY_ACCESS_MODES)[number];

// ── Namespaces (isolation boundaries) ──────────────────────────────

export const FABRIC_NAMESPACES = [
  'personal',
  'oria',
  'hermes',
  'code',
  'health',
  'finance',
  'unknown',
] as const;

export type FabricNamespace = (typeof FABRIC_NAMESPACES)[number];

// ── Memory taxonomy ────────────────────────────────────────────────

export const MEMORY_KINDS = [
  'semantic',    // facts about the world / Michael
  'episodic',    // what happened, when
  'procedural',  // how to do things (SOPs)
  'failure',     // what already failed and why — scar tissue
  'decision',    // recorded decisions with rationale
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = [
  'proposed',     // written by an agent, awaiting approval
  'active',       // in force
  'verified',     // human-approved (Oria doctrine)
  'deprecated',   // superseded by time — kept for audit
  'superseded',   // explicitly replaced by another entry
  'quarantined',  // flagged as risky/contaminated — never injected
] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_RISK_FLAGS = [
  'prompt_injection_suspect',
  'cross_namespace_leak',
  'stale_time_sensitive',
  'contradicts_existing',
  'secret_material',
  'destructive_instruction',
  'unverified_external_source',
] as const;

export type MemoryRiskFlag = (typeof MEMORY_RISK_FLAGS)[number];

// ── Request context (who is asking, with what authority) ───────────

export interface FabricRequestContext {
  clientKind: FabricClientKind;
  scope: FabricAccessScope;
  namespace: FabricNamespace;
  /** Stable token identifier — NEVER the token value itself. */
  tokenId: string | null;
  requestedMode: MemoryAccessMode;
}

// ── Access decision (deterministic policy output) ──────────────────

export interface FabricAccessDecision {
  allowed: boolean;
  mode: MemoryAccessMode;
  /** Human-readable, log-safe reason. Never contains secrets. */
  reason: string;
  /** True when the operation may proceed only after human approval. */
  requiresApproval: boolean;
}

// ── Memory candidate (a proposal entering the admission gate) ──────

export interface MemoryProvenance {
  /** Where this memory came from: session id, file, URL, agent name. */
  source: string;
  /** Which client produced it. */
  sourceClient: FabricClientKind;
  /** ISO 8601. */
  capturedAt: string;
}

export interface MemoryCandidate {
  id: string;
  namespace: FabricNamespace;
  kind: MemoryKind;
  status: MemoryStatus;
  content: string;
  /** 0..1 — producer-declared confidence, later adjusted by policy. */
  confidence: number;
  provenance: MemoryProvenance | null;
  riskFlags: MemoryRiskFlag[];
  /** ISO 8601 validity window. null validTo = no known expiry. */
  validFrom: string;
  validTo: string | null;
}

export const ADMISSION_OUTCOMES = [
  'auto_admit',       // safe, complete, low-risk → enters as `proposed`→`active`
  'requires_review',  // human must approve before it becomes context-eligible
  'reject',           // never admitted (e.g. secret material)
] as const;

export type AdmissionOutcome = (typeof ADMISSION_OUTCOMES)[number];

export interface MemoryAdmissionDecision {
  outcome: AdmissionOutcome;
  /** Confidence after policy adjustment (provenance, risk). */
  adjustedConfidence: number;
  reasons: string[];
}

// ── Context packs (the ONLY thing agents consume) ──────────────────

export interface ContextPackRequest {
  requester: FabricRequestContext;
  /** e.g. "oria_daily_brief", "hermes_execution", "repo_handoff" */
  packKind: string;
  namespace: FabricNamespace;
  maxItems: number;
}

export interface ContextPackItem {
  memoryId: string;
  kind: MemoryKind;
  status: MemoryStatus;
  content: string;
  confidence: number;
  /** Explainability: why this item was selected for this pack. */
  whyIncluded: string;
  source: string;
  riskFlags: MemoryRiskFlag[];
  validFrom: string;
  validTo: string | null;
  /** How a consumer signals this memory should be revoked/reviewed. */
  revocationPath: string;
}

export interface ContextPackResponse {
  packKind: string;
  namespace: FabricNamespace;
  generatedAt: string;
  items: ContextPackItem[];
  /** Items excluded + machine-readable reason — auditability of absence. */
  excluded: Array<{ memoryId: string; reason: string }>;
}

// ── Client profiles (default posture per client kind) ──────────────

export interface AgentClientProfile {
  kind: FabricClientKind;
  /** Highest scope this client kind may ever be issued. */
  maxScope: FabricAccessScope;
  /** Namespaces this client may touch by default. */
  defaultNamespaces: FabricNamespace[];
  /** Whether direct MCP connectivity is verified for this client. */
  mcpDirectSupport: 'verified' | 'unknown' | 'adapter_required';
}
