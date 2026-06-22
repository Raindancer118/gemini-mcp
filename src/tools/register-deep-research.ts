import * as z from 'zod';
import logger from '../utils/logger.js';
import { toolError } from '../utils/tool-wrapper.js';
import { GeminiDeepResearchTool } from './gemini-deep-research.js';
import type { ToolContext } from './types.js';

export function register(ctx: ToolContext): void {
  ctx.server.registerTool(
    'gemini_deep_research',
    {
      title: 'Gemini Deep Research',
      description:
        'Conduct real Deep Research on complex topics: Google\'s autonomous Deep Research agent does multi-step ' +
        'live web search and returns a synthesised, cited report (takes several minutes). Runs the actual Deep ' +
        'Research agents via the Gemini Interactions API. [MCP_RECOMMENDED_TIMEOUT_MS: 900000]',
      inputSchema: {
        research_question: z.string().describe('The complex research question or topic to investigate deeply'),
        model: z.string()
          .optional()
          .describe(
            'Deep Research agent to use: "deep-research-pro-preview-12-2025" (default), ' +
            '"deep-research-preview-04-2026", or "deep-research-max-preview-04-2026" (most thorough/slowest).'
          ),
        focus_areas: z.array(z.string())
          .optional()
          .describe('Optional: specific areas to focus the research on')
      },
      outputSchema: {
        content: z.string(),
        success: z.boolean()
      }
    },
    async ({ research_question, model, focus_areas }) => {
      try {
        logger.info('Starting deep research', {
          question: research_question,
          model
        });

        const deepResearchTool = new GeminiDeepResearchTool(ctx.geminiService);
        const result = await deepResearchTool.execute({
          research_question,
          model,
          focus_areas
        });

        return {
          content: result,
          structuredContent: {
            content: result[0]?.text || 'Research completed',
            success: true
          }
        };
      } catch (error) {
        return toolError('gemini_deep_research', error);
      }
    }
  );
}
