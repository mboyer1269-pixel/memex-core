# Ollama Librarian — Model & Boundaries

> Ollama runs local models on the VPS. The Librarian is the Fabric's **advisor**.
> It reads, classifies, flags, suggests. It never decides.

## Model roles

| Model | Role | Note |
|---|---|---|
| `nomic-embed-text` | Embeddings ONLY | Embedding model — not for reasoning. ~274MB class, short context. |
| Small local LLM (llama/qwen/deepseek class) | Librarian reasoning | classification, summaries, contradiction candidates |
| Policy code | **Final authority** | `src/fabric/policy.ts` |

## Librarian responsibilities (advisory outputs)

1. Classify memory candidates → suggested `kind` + `namespace` + tags
2. Summarize long content for pack projection
3. Detect duplicate candidates → merge suggestions
4. Detect contradiction candidates → feeds Active Forgetting (deprecation *proposals*)
5. Suggest deprecation of stale entries
6. Propose context pack compositions
7. Flag risk → suggested `MemoryRiskFlag[]`

## Librarian non-authorities (hard limits)

- Cannot bypass auth or scopes — its output enters `admitMemory()` like any producer
- Cannot approve destructive writes alone
- Cannot override deterministic policy
- Cannot write to `Human/` (vault zoning already enforces this)
- Cannot expose secrets — `secret_material` flag → outright reject

## Future phases

1. Embedding pipeline (`nomic-embed-text`) → rebuildable index only
2. Classification eval set — precision on Michael's real corpus
3. Contradiction detection eval — false-positive rate must be measured before trust
4. Hallucination/risk red-team set — Librarian suggestions vs known-bad inputs
5. Context pack proposal quality review
