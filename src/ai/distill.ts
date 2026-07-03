/**
 * Procedural Memory Distillation (R3) — deterministic half.
 * ----------------------------------------------------------
 * Pure functions: keyword extraction and greedy clustering of episodic
 * traces. No LLM, no DB, no filesystem — fully unit-testable. The
 * BackgroundWorker feeds promoted episodic traces through here, then asks
 * an LLM to write an SOP only for clusters dense enough to carry signal.
 */

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'them',
  'then', 'than', 'when', 'what', 'which', 'while', 'will', 'would',
  'could', 'should', 'about', 'after', 'before', 'into', 'over', 'under',
  'again', 'also', 'because', 'between', 'both', 'each', '其他', 'here',
  'there', 'these', 'those', 'very', 'just', 'only', 'some', 'such',
  'their', 'your', 'ours', 'does', 'doing', 'done', 'more', 'most',
]);

export interface TraceInput {
  id: string;
  content: string;
}

export interface TraceCluster {
  /** Most frequent shared keyword — used for the SOP filename. */
  topic: string;
  /** Proposal ids in this cluster. */
  ids: string[];
  /** Original trace contents, for the distillation prompt. */
  contents: string[];
  size: number;
}

/** Lowercased, de-duplicated keywords of length > 3, stopwords removed. */
export function extractKeywords(text: string): Set<string> {
  const words = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Greedy single-pass clustering: each trace joins the first cluster whose
 * seed shares enough keyword overlap (Jaccard >= threshold), otherwise it
 * seeds a new cluster. Deterministic for a given input order.
 */
export function clusterByKeywords(
  traces: TraceInput[],
  threshold: number = 0.2
): TraceCluster[] {
  interface WorkingCluster {
    seedKeywords: Set<string>;
    keywordCounts: Map<string, number>;
    ids: string[];
    contents: string[];
  }

  const clusters: WorkingCluster[] = [];

  for (const trace of traces) {
    const keywords = extractKeywords(trace.content);
    if (keywords.size === 0) continue;

    let target: WorkingCluster | undefined;
    for (const cluster of clusters) {
      if (jaccard(cluster.seedKeywords, keywords) >= threshold) {
        target = cluster;
        break;
      }
    }

    if (!target) {
      target = { seedKeywords: keywords, keywordCounts: new Map(), ids: [], contents: [] };
      clusters.push(target);
    }

    target.ids.push(trace.id);
    target.contents.push(trace.content);
    for (const word of keywords) {
      target.keywordCounts.set(word, (target.keywordCounts.get(word) ?? 0) + 1);
    }
  }

  return clusters.map(cluster => {
    let topic = 'general';
    let best = 0;
    for (const [word, count] of cluster.keywordCounts) {
      if (count > best || (count === best && word < topic)) {
        best = count;
        topic = word;
      }
    }
    return {
      topic,
      ids: cluster.ids,
      contents: cluster.contents,
      size: cluster.ids.length
    };
  });
}

/** Prompt for the LLM half of distillation. */
export function distillPrompt(cluster: TraceCluster): string {
  return [
    'You are distilling repeated agent experiences into ONE reusable Standard Operating Procedure (SOP).',
    `Topic: ${cluster.topic}`,
    'Below are raw episodic traces of the same kind of task. Extract the stable, repeatable procedure:',
    'prerequisites, ordered steps, pitfalls to avoid, and how to verify success.',
    'Output ONLY Markdown, starting with a # title. No preamble.',
    '',
    ...cluster.contents.map((c, i) => `--- TRACE ${i + 1} ---\n${c.substring(0, 1500)}`),
  ].join('\n');
}
