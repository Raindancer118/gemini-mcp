import * as z from 'zod';
import logger from '../utils/logger.js';
import { createToolResult, McpError } from '../utils/error-handler.js';
import { toolError } from '../utils/tool-wrapper.js';
import { classifyFile } from '../utils/file-input.js';
import type { ToolContext } from './types.js';

export type SummaryLength = 'brief' | 'standard' | 'detailed' | 'bullets';

const LENGTH_INSTRUCTIONS: Record<SummaryLength, string> = {
  brief: 'Write a brief summary of 2-3 sentences capturing only the core message.',
  standard: 'Write a concise summary of one well-structured paragraph.',
  detailed:
    'Write a thorough summary across a few paragraphs, covering the main points, ' +
    'important details, and conclusions.',
  bullets:
    'Summarize as a Markdown bullet list of the key points (one idea per bullet), ' +
    'ordered by importance.',
};

/** Build the summarisation instruction (pure, unit-testable). */
export function buildSummaryInstruction(
  length: SummaryLength,
  focus?: string,
  language?: string
): string {
  let instruction =
    'You are an expert summariser. Produce a faithful, neutral summary of the ' +
    'provided content. Do not add information that is not in the source, and do ' +
    'not include preamble like "Here is the summary".\n\n' +
    LENGTH_INSTRUCTIONS[length];
  if (focus) {
    instruction += `\n\nFocus especially on: ${focus}.`;
  }
  if (language) {
    instruction += `\n\nWrite the summary in ${language}.`;
  }
  return instruction;
}

const MAX_TEXT_CHARS = 800_000; // guard against accidentally huge text files

export function register(ctx: ToolContext): void {
  ctx.server.registerTool(
    'generate_summary',
    {
      title: 'Generate Summary',
      description:
        'Summarise text or a local file with Gemini. Provide `text`, or `file_path` to almost any file: ' +
        'text/code, PDF, images, audio or video (Office docs must be exported to PDF first). ' +
        'Choose the length and optionally a focus or output language.',
      inputSchema: {
        text: z.string()
          .optional()
          .describe('The text to summarise. Provide this or file_path.'),
        file_path: z.string()
          .optional()
          .describe(
            'Absolute path to a local file to summarise. Accepts text/code, PDF, images, ' +
            'audio and video — loaded server-side (bypasses MCP transport limits).'
          ),
        length: z.enum(['brief', 'standard', 'detailed', 'bullets'])
          .optional()
          .default('standard')
          .describe('Summary length/format: brief, standard, detailed, or bullets.'),
        focus: z.string()
          .optional()
          .describe('Optional angle to emphasise (e.g. "risks and open questions").'),
        language: z.string()
          .optional()
          .describe('Optional output language (e.g. "German"). Defaults to the source language.'),
        model: z.string()
          .optional()
          .describe('Model to use (defaults to the configured chat/analysis model).')
      },
      outputSchema: {
        content: z.string(),
        success: z.boolean()
      }
    },
    async ({ text, file_path, length, focus, language, model }) => {
      try {
        if (!text && !file_path) {
          throw new McpError('Provide either `text` or `file_path`.', 'INVALID_INPUT');
        }

        const instruction = buildSummaryInstruction(length as SummaryLength, focus, language);

        // Inline (multimodal) path: PDF/image/audio/video files.
        if (!text && file_path) {
          const classified = await classifyFile(file_path);
          if (classified.mode === 'inline') {
            logger.info('Executing generate_summary tool (multimodal)', {
              model, length, mimeType: classified.mimeType, language
            });

            const result = await ctx.geminiService.analyzeImages({
              images: [{ data: classified.data, mimeType: classified.mimeType }],
              prompt: `${instruction}\n\nSummarise the attached file.`,
              model,
              globalMediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
            });

            return {
              content: createToolResult(true, result),
              structuredContent: { content: result, success: true }
            };
          }
          // text-mode file → fall through to chat with its contents
          text = classified.text;
        }

        const source = (text ?? '').trim();
        if (!source) {
          throw new McpError('No content to summarise (the input/file was empty).', 'INVALID_INPUT');
        }
        if (source.length > MAX_TEXT_CHARS) {
          throw new McpError(
            `Input too large (${source.length} chars, max ${MAX_TEXT_CHARS}). Split it or summarise in parts.`,
            'INPUT_TOO_LARGE'
          );
        }

        logger.info('Executing generate_summary tool (text)', {
          model, length, chars: source.length, hasFocus: !!focus, language
        });

        const response = await ctx.geminiService.chat({
          message: source,
          model,
          systemPrompt: instruction,
          grounding: false,
          temperature: 0.3,
        });

        return {
          content: createToolResult(true, response.content),
          structuredContent: { content: response.content, success: true }
        };
      } catch (error) {
        return toolError('generate_summary', error);
      }
    }
  );
}
