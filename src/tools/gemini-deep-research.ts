import { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GeminiService } from '../services/gemini/index.js';
import { createToolResult, McpError } from '../utils/error-handler.js';
import logger from '../utils/logger.js';

// Real Deep Research can legitimately run for many minutes. Stay just under the
// tool's advertised MCP_RECOMMENDED_TIMEOUT_MS so we return a graceful partial
// before the host kills the call.
const DEEP_RESEARCH_TIMEOUT_MS = 850_000;

/**
 * Runs Google's real Deep Research agent through the Gemini Interactions API.
 * The agent autonomously performs many rounds of live web search and returns a
 * synthesised, cited report — the actual "Deep Research" product. (The legacy
 * grounding-augmented chat loop was removed: those Google Search grounding
 * calls are not available on this API tier.)
 */
export class GeminiDeepResearchTool {
  constructor(private geminiService: GeminiService) {}

  async execute(args: any): Promise<TextContent[]> {
    const question: string = args.research_question;
    const focusAreas: string[] = args.focus_areas || [];
    const agent: string | undefined = args.model;

    logger.info('Starting deep research (Interactions API)', {
      question,
      agent: agent || this.geminiService.getDeepResearchAgent(),
      focusAreas,
    });

    try {
      const result = await this.geminiService.deepResearch({
        question,
        focusAreas,
        agent,
        timeoutMs: DEEP_RESEARCH_TIMEOUT_MS,
      });

      const minutes = (result.durationMs / 60000).toFixed(1);
      let report = result.report;

      if (result.timedOut) {
        report =
          `> ⚠️ *Deep research did not finish within the time budget (${minutes} min). ` +
          `Partial findings below — re-run with a narrower question.*\n\n` +
          report;
      }

      const sourcesNote =
        result.sources.length > 0
          ? ` · ${result.sources.length} source${result.sources.length === 1 ? '' : 's'} consulted`
          : '';
      report +=
        `\n\n---\n*Real Deep Research via \`${result.agent}\` · ` +
        `${result.stepCount} step${result.stepCount === 1 ? '' : 's'} · ` +
        `${minutes} min${sourcesNote}*`;

      logger.info('Deep research completed', {
        status: result.status,
        durationMs: result.durationMs,
        sources: result.sources.length,
        reportLength: result.report.length,
      });

      return createToolResult(true, report);
    } catch (error) {
      logger.error('Deep research failed', { error });
      if (error instanceof McpError) {
        return createToolResult(false, error.message, error);
      }
      const msg = (error as Error).message || 'Unknown error';
      return createToolResult(
        false,
        `Deep research failed: ${msg}\n\n` +
          `The Deep Research agents (deep-research-*) require Interactions API ` +
          `access on your Gemini key. Check that your key/tier can use them.`,
        error as Error
      );
    }
  }
}
