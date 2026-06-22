import * as z from 'zod';
import logger from '../utils/logger.js';
import { createToolResult, McpError } from '../utils/error-handler.js';
import { toolError } from '../utils/tool-wrapper.js';
import { classifyFile } from '../utils/file-input.js';
import type { ToolContext } from './types.js';

/** Build the transcription prompt (pure, unit-testable). */
export function buildTranscribePrompt(opts: {
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  extra?: string;
}): string {
  let p =
    'Transcribe the speech in this audio/video accurately and verbatim. ' +
    'Output only the transcript text — no summary, translation, or commentary.';
  if (opts.language) {
    p += ` The audio is primarily in ${opts.language}; transcribe in that language.`;
  }
  if (opts.diarization) {
    p +=
      ' Label distinct speakers as "Speaker 1:", "Speaker 2:", etc., starting a ' +
      'new line whenever the speaker changes.';
  }
  if (opts.timestamps) {
    p +=
      ' Prefix each line (or speaker turn) with an approximate timestamp in ' +
      '[mm:ss] format.';
  }
  p += ' If a passage is unclear, mark it [inaudible].';
  if (opts.extra) p += `\n\nAdditional instruction: ${opts.extra}`;
  return p;
}

const AUDIO_VIDEO = /^(audio|video)\//;

export function register(ctx: ToolContext): void {
  ctx.server.registerTool(
    'transcribe',
    {
      title: 'Transcribe Audio/Video',
      description:
        'Transcribe speech from an audio or video file to text using Gemini. ' +
        'Optional timestamps, speaker labels (diarization) and language hint. ' +
        'Provide a local file_path (loaded server-side) or inline base64 data.',
      inputSchema: {
        file_path: z.string()
          .optional()
          .describe('Absolute path to a local audio/video file (mp3, wav, m4a, mp4, mov, webm, ...).'),
        data: z.string()
          .optional()
          .describe('Base64-encoded audio/video data (alternative to file_path).'),
        mime_type: z.string()
          .optional()
          .describe('MIME type for inline data (e.g. "audio/mpeg", "video/mp4"). Required with data.'),
        language: z.string()
          .optional()
          .describe('Optional spoken-language hint (e.g. "German"). Improves accuracy.'),
        timestamps: z.boolean()
          .optional()
          .default(false)
          .describe('Prefix lines with [mm:ss] timestamps.'),
        diarization: z.boolean()
          .optional()
          .default(false)
          .describe('Label distinct speakers (Speaker 1, Speaker 2, ...).'),
        prompt: z.string()
          .optional()
          .describe('Optional extra instruction appended to the transcription prompt.'),
        model: z.string()
          .optional()
          .describe('Model to use (defaults to the configured image/analysis model).'),
        max_tokens: z.number()
          .int()
          .min(1)
          .max(65536)
          .optional()
          .default(32768)
          .describe('Maximum tokens in response (default 32768 for long transcripts).')
      },
      outputSchema: {
        content: z.string(),
        success: z.boolean()
      }
    },
    async ({ file_path, data, mime_type, language, timestamps, diarization, prompt, model, max_tokens }) => {
      try {
        let mediaData: string;
        let mimeType: string;

        if (data) {
          if (!mime_type) {
            throw new McpError('mime_type is required when passing inline data.', 'INVALID_INPUT');
          }
          mediaData = data;
          mimeType = mime_type;
        } else if (file_path) {
          const classified = await classifyFile(file_path);
          if (classified.mode !== 'inline' || !AUDIO_VIDEO.test(classified.mimeType)) {
            throw new McpError(
              `transcribe expects an audio or video file; got ${
                classified.mode === 'inline' ? classified.mimeType : 'a text file'
              }.`,
              'INVALID_INPUT'
            );
          }
          mediaData = classified.data;
          mimeType = classified.mimeType;
        } else {
          throw new McpError('Provide either file_path or data + mime_type.', 'INVALID_INPUT');
        }

        if (!AUDIO_VIDEO.test(mimeType)) {
          throw new McpError(`Not an audio/video MIME type: ${mimeType}`, 'INVALID_INPUT');
        }

        logger.info('Executing transcribe tool', { model, mimeType, language, timestamps, diarization });

        const result = await ctx.geminiService.analyzeImages({
          images: [{ data: mediaData, mimeType }],
          prompt: buildTranscribePrompt({ language, timestamps, diarization, extra: prompt }),
          model,
          maxTokens: max_tokens,
        });

        return {
          content: createToolResult(true, result),
          structuredContent: { content: result, success: true }
        };
      } catch (error) {
        return toolError('transcribe', error);
      }
    }
  );
}
