import * as z from 'zod';
import logger from '../utils/logger.js';
import { createToolResult, McpError } from '../utils/error-handler.js';
import { toolError } from '../utils/tool-wrapper.js';
import { classifyFile } from '../utils/file-input.js';
import { parseJsonLoose } from '../utils/json-extract.js';
import type { ToolContext } from './types.js';

/** Build the structured-extraction instruction (pure, unit-testable). */
export function buildExtractionPrompt(instructions: string, hasSchema: boolean): string {
  let p =
    'You are a precise data-extraction engine. Extract the requested information ' +
    'from the provided content and return it as a single valid JSON value. ' +
    'Output ONLY JSON — no prose, no Markdown code fences.\n\n' +
    `What to extract:\n${instructions}\n\n` +
    'Rules:\n' +
    '- Use null for any requested field that is absent.\n' +
    '- Do not invent values; only use information present in the content.\n' +
    '- Use clear, consistent snake_case keys when no schema is given.';
  if (hasSchema) {
    p += '\n- Conform exactly to the provided response schema.';
  }
  return p;
}

export function register(ctx: ToolContext): void {
  ctx.server.registerTool(
    'extract_structured_data',
    {
      title: 'Extract Structured Data',
      description:
        'Extract structured JSON from text or almost any local file (text/code, PDF, image, audio, video) ' +
        'using Gemini JSON mode. Describe the fields you want in `instructions`, optionally constrain the ' +
        'output with a `json_schema` (Gemini/OpenAPI subset). Returns parsed JSON.',
      inputSchema: {
        instructions: z.string()
          .describe('What to extract, e.g. "invoice number, date, total, and an array of line items".'),
        text: z.string()
          .optional()
          .describe('The source text to extract from. Provide this or file_path.'),
        file_path: z.string()
          .optional()
          .describe('Absolute path to a local file to extract from (text/code, PDF, image, audio, video).'),
        json_schema: z.union([z.string(), z.record(z.any())])
          .optional()
          .describe('Optional response schema (Gemini OpenAPI subset) to enforce the JSON shape. JSON string or object.'),
        model: z.string()
          .optional()
          .describe('Model to use (defaults to the configured chat/analysis model).'),
        max_tokens: z.number()
          .int()
          .min(1)
          .max(65536)
          .optional()
          .default(16384)
          .describe('Maximum tokens in response (default 16384).')
      },
      outputSchema: {
        content: z.string(),
        success: z.boolean()
      }
    },
    async ({ instructions, text, file_path, json_schema, model, max_tokens }) => {
      try {
        if (!text && !file_path) {
          throw new McpError('Provide either `text` or `file_path`.', 'INVALID_INPUT');
        }

        let responseSchema: unknown;
        if (json_schema) {
          responseSchema = typeof json_schema === 'string'
            ? JSON.parse(json_schema)
            : json_schema;
        }

        const prompt = buildExtractionPrompt(instructions, !!responseSchema);
        let raw: string;

        // Inline (multimodal) path for PDF/image/audio/video files.
        if (!text && file_path) {
          const classified = await classifyFile(file_path);
          if (classified.mode === 'inline') {
            logger.info('Executing extract_structured_data (multimodal)', { model, mimeType: classified.mimeType });
            raw = await ctx.geminiService.analyzeImages({
              images: [{ data: classified.data, mimeType: classified.mimeType }],
              prompt,
              model,
              maxTokens: max_tokens,
              responseMimeType: 'application/json',
              responseSchema,
            });
          } else {
            text = classified.text;
            raw = '';
          }
        } else {
          raw = '';
        }

        if (!raw) {
          const source = (text ?? '').trim();
          if (!source) {
            throw new McpError('No content to extract from (input/file was empty).', 'INVALID_INPUT');
          }
          logger.info('Executing extract_structured_data (text)', { model, chars: source.length });
          const response = await ctx.geminiService.chat({
            message: `${prompt}\n\n--- CONTENT ---\n${source}`,
            model,
            grounding: false,
            temperature: 0.1,
            maxTokens: max_tokens,
            responseMimeType: 'application/json',
            responseSchema,
          });
          raw = response.content;
        }

        // Normalise to pretty JSON when parseable; otherwise return raw with a note.
        const parsed = parseJsonLoose(raw);
        const output = parsed.ok
          ? JSON.stringify(parsed.value, null, 2)
          : `${raw}\n\n[warning: response was not valid JSON]`;

        return {
          content: createToolResult(true, output),
          structuredContent: { content: output, success: true }
        };
      } catch (error) {
        return toolError('extract_structured_data', error);
      }
    }
  );
}
