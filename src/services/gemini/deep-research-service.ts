import { GeminiError } from '../../utils/error-handler.js';
import logger from '../../utils/logger.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface DeepResearchOptions {
  question: string;
  focusAreas?: string[];
  /** Deep Research agent name, e.g. "deep-research-pro-preview-12-2025". */
  agent?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface DeepResearchResult {
  report: string;
  agent: string;
  interactionId: string;
  status: string;
  durationMs: number;
  timedOut: boolean;
  stepCount: number;
  /** Source URLs gathered from the research steps. */
  sources: string[];
}

interface InteractionStep {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  [k: string]: unknown;
}

interface Interaction {
  id: string;
  status: string;
  steps?: InteractionStep[];
  [k: string]: unknown;
}

/**
 * Runs Google's real **Deep Research** agents through the Gemini Interactions
 * API. These agents (deep-research-*-preview-*) do not support generateContent —
 * they require an asynchronous background interaction: create it, then poll the
 * interaction resource until it leaves the in_progress state, and read the
 * synthesised report out of the final step.
 */
export class DeepResearchService {
  constructor(
    private apiKey: string | undefined,
    private defaultAgent: string
  ) {}

  async research(opts: DeepResearchOptions): Promise<DeepResearchResult> {
    if (!this.apiKey) {
      throw new GeminiError('Missing API key for deep research');
    }

    const agent = opts.agent || this.defaultAgent;
    const pollIntervalMs = opts.pollIntervalMs ?? 10_000;
    const timeoutMs = opts.timeoutMs ?? 1_500_000; // 25 min
    const input = this.buildInput(opts.question, opts.focusAreas || []);

    const started = Date.now();
    const created = await this.createInteraction(agent, input);

    logger.info('Deep research interaction created', {
      id: created.id,
      agent,
      status: created.status,
    });

    let interaction = created;
    let timedOut = false;

    while (this.isPending(interaction.status)) {
      if (Date.now() - started > timeoutMs) {
        timedOut = true;
        break;
      }
      await this.delay(pollIntervalMs);
      interaction = await this.getInteraction(created.id);
      logger.info('Deep research poll', {
        id: created.id,
        status: interaction.status,
        steps: interaction.steps?.length ?? 0,
      });
    }

    const durationMs = Date.now() - started;

    if (!timedOut && interaction.status !== 'completed') {
      const detail =
        this.allText(interaction).slice(0, 400) ||
        `status=${interaction.status}`;
      throw new GeminiError(
        `Deep research interaction ${interaction.status}. ${detail}`
      );
    }

    const report = this.extractReport(interaction);
    if (!report && !timedOut) {
      throw new GeminiError(
        'Deep research completed but no report text was returned.'
      );
    }

    return {
      report: report || '(deep research did not finish before the timeout)',
      agent,
      interactionId: created.id,
      status: timedOut ? 'timeout' : interaction.status,
      durationMs,
      timedOut,
      stepCount: interaction.steps?.length ?? 0,
      sources: this.extractSources(interaction),
    };
  }

  private isPending(status: string): boolean {
    return (
      status === 'in_progress' || status === 'queued' || status === 'pending'
    );
  }

  private buildInput(question: string, focusAreas: string[]): string {
    if (focusAreas.length === 0) return question;
    return (
      `${question}\n\nFocus especially on:\n` +
      focusAreas.map((a) => `- ${a}`).join('\n')
    );
  }

  private async createInteraction(
    agent: string,
    input: string
  ): Promise<Interaction> {
    const res = await fetch(`${API_BASE}/interactions?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, input, background: true }),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new GeminiError(
        `Failed to start deep research: ${
          data?.error?.message || res.statusText
        }`
      );
    }
    return data as Interaction;
  }

  private async getInteraction(id: string): Promise<Interaction> {
    const res = await fetch(`${API_BASE}/interactions/${id}?key=${this.apiKey}`);
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new GeminiError(
        `Failed to poll deep research: ${data?.error?.message || res.statusText}`
      );
    }
    return data as Interaction;
  }

  /**
   * The synthesised report is the last substantial text block among the
   * non-user steps (research/thought steps come earlier; the final answer last).
   */
  private extractReport(interaction: Interaction): string {
    const steps = interaction.steps || [];
    let last = '';
    for (const step of steps) {
      if (step.type === 'user_input') continue;
      const t = this.stepText(step).trim();
      if (t) last = t;
    }
    return last;
  }

  private allText(interaction: Interaction): string {
    return (interaction.steps || [])
      .map((s) => this.stepText(s))
      .filter(Boolean)
      .join('\n');
  }

  private stepText(step: InteractionStep): string {
    if (!Array.isArray(step.content)) return '';
    return step.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
  }

  private extractSources(interaction: Interaction): string[] {
    const text = this.allText(interaction);
    const urls = text.match(/https?:\/\/[^\s)\]]+/g) || [];
    const cleaned = urls
      .map((u) => u.replace(/[.,;:]+$/, ''))
      .filter((u) => u.length > 10);
    return [...new Set(cleaned)];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
