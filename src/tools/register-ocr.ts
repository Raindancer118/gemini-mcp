import * as z from 'zod';
import logger from '../utils/logger.js';
import { createToolResult } from '../utils/error-handler.js';
import { toolError } from '../utils/tool-wrapper.js';
import { resolveImageInputs } from '../utils/resolve-images.js';
import { imageInputSchema } from './schemas.js';
import type { ToolContext } from './types.js';

/** Build the OCR instruction (pure, unit-testable). */
export function buildOcrPrompt(language?: string): string {
  const langLine = language
    ? `\nThe text is primarily in ${language}; transcribe it in that language.`
    : '';
  return (
    'Perform OCR on the provided document/image(s). Extract ALL text verbatim, ' +
    'preserving the reading order and layout. Reproduce structure as Markdown: ' +
    'headings, lists, and tables (as Markdown tables). Keep line breaks where ' +
    'they are meaningful. Do NOT summarize, translate, explain, or add any ' +
    'commentary. If a region is unreadable, mark it as [illegible]. ' +
    'Output only the extracted text.' +
    langLine
  );
}

export function register(ctx: ToolContext): void {
  ctx.server.registerTool(
    'ocr',
    {
      title: 'OCR (Extract Text)',
      description:
        'Extract text verbatim from images or PDFs using Gemini multimodal OCR. ' +
        'Returns the raw text (as Markdown for structure) — no summarising or analysis. ' +
        'For documents/PDFs, MEDIUM resolution gives the same OCR quality at half the token cost.',
      inputSchema: {
        images: z.array(imageInputSchema)
          .min(1)
          .describe('One or more images/PDFs to OCR. Use filePath for large files (incl. .pdf).'),
        language: z.string()
          .optional()
          .describe('Optional hint for the document language (e.g. "German"). Improves accuracy.'),
        prompt: z.string()
          .optional()
          .describe('Optional override/extra instruction for the OCR (appended to the default).'),
        model: z.string()
          .optional()
          .describe('Model to use (defaults to the configured image-analysis model).'),
        max_tokens: z.number()
          .int()
          .min(1)
          .max(65536)
          .optional()
          .default(16384)
          .describe('Maximum tokens in response (default 16384).'),
        global_media_resolution: z.enum([
          'MEDIA_RESOLUTION_LOW',
          'MEDIA_RESOLUTION_MEDIUM',
          'MEDIA_RESOLUTION_HIGH'
        ])
          .optional()
          .default('MEDIA_RESOLUTION_MEDIUM')
          .describe('Image quality. MEDIUM (default) = same OCR quality as HIGH at 50% token cost.')
      },
      outputSchema: {
        content: z.string(),
        success: z.boolean()
      }
    },
    async ({ images, language, prompt, model, max_tokens, global_media_resolution }) => {
      try {
        logger.info('Executing ocr tool', {
          model,
          imageCount: images.length,
          language,
          globalMediaResolution: global_media_resolution
        });

        const resolved = await resolveImageInputs(images as any);

        let ocrPrompt = buildOcrPrompt(language);
        if (prompt) {
          ocrPrompt += `\n\nAdditional instruction: ${prompt}`;
        }

        const result = await ctx.geminiService.analyzeImages({
          images: resolved as any,
          prompt: ocrPrompt,
          model,
          maxTokens: max_tokens,
          globalMediaResolution: global_media_resolution
        });

        return {
          content: createToolResult(true, result),
          structuredContent: { content: result, success: true }
        };
      } catch (error) {
        return toolError('ocr', error);
      }
    }
  );
}
