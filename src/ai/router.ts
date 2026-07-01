export type TaskComplexity = 'low' | 'medium' | 'high';

export interface RouteConfig {
  openRouterKey?: string;
  ollamaUrl?: string; // e.g. http://127.0.0.1:11434
}

export class SmartRouter {
  private config: RouteConfig;

  constructor(config: RouteConfig) {
    this.config = {
      openRouterKey: config.openRouterKey || process.env.OPENROUTER_API_KEY,
      ollamaUrl: config.ollamaUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    };
  }

  /**
   * Routes the task to the best available model.
   * Priority for 'low': Ollama (Free/Local) -> OpenRouter Free Tier
   * Priority for 'medium': Ollama -> OpenRouter mid-tier
   * Priority for 'high': OpenRouter top-tier (Claude/GPT-4o/Gemini Pro)
   */
  async callModel(prompt: string, complexity: TaskComplexity = 'medium'): Promise<string> {
    // Always try Ollama first for low/medium to save costs
    if (complexity === 'low' || complexity === 'medium') {
      const localResult = await this.callOllama(prompt, 'llama3');
      if (localResult !== null) return localResult;
    }

    // Fallback to OpenRouter
    if (!this.config.openRouterKey) {
      throw new Error(
        'No AI backend available. Either start Ollama locally or set OPENROUTER_API_KEY.'
      );
    }

    /**
     * Model selection strategy (inspired by Sakana Fugu's TRINITY pattern):
     *   low    → Ollama local (free) or OpenRouter free tier
     *   medium → Mid-tier (Gemini Flash) — fast, cheap, good for structuring data
     *   high   → Sakana Fugu Ultra (via OpenRouter) — multi-agent orchestrator
     *            that internally coordinates Thinker/Worker/Verifier roles
     *            across frontier models for maximum reasoning quality
     */
    const modelMap: Record<TaskComplexity, string> = {
      low: 'meta-llama/llama-3-8b-instruct:free',
      medium: 'google/gemini-flash-1.5',
      high: 'sakana/fugu-ultra',
    };

    return this.callOpenRouter(prompt, modelMap[complexity]);
  }

  private async callOllama(prompt: string, model: string): Promise<string | null> {
    if (!this.config.ollamaUrl) return null;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout
    
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json() as any;
      return data?.response ?? null;
    } catch {
      // Ollama not running or timed out — that's fine, we fall back
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callOpenRouter(prompt: string, model: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000); // 60s timeout
    
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.openRouterKey}`,
          'HTTP-Referer': 'https://github.com/memex-core',
          'X-Title': 'Memex Core',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => 'unknown');
        throw new Error(`OpenRouter ${response.status}: ${errBody}`);
      }

      const data = await response.json() as any;
      
      // Guard against empty or malformed responses
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error(`OpenRouter returned empty response for model ${model}`);
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}
