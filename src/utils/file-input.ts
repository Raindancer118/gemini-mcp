import { readFile } from 'fs/promises';
import { basename, extname, resolve } from 'path';
import { McpError } from './error-handler.js';
import logger from './logger.js';

/**
 * A local file classified for Gemini consumption:
 *  - `text`   → read as UTF-8 and sent as a normal text prompt
 *  - `inline` → read as base64 and sent as multimodal inlineData (PDF, image,
 *               audio, video)
 */
export type ClassifiedFile =
  | { mode: 'text'; text: string; mimeType: string }
  | { mode: 'inline'; data: string; mimeType: string };

// Text/code formats we read as UTF-8.
const TEXT_MIME: Record<string, string> = {
  '.txt': 'text/plain', '.text': 'text/plain', '.log': 'text/plain',
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.rst': 'text/plain',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.json': 'application/json', '.jsonl': 'application/json', '.ndjson': 'application/json',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
  '.ini': 'text/plain', '.cfg': 'text/plain', '.conf': 'text/plain', '.env': 'text/plain',
  '.properties': 'text/plain', '.xml': 'text/xml', '.svg': 'text/xml',
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'text/plain', '.jsx': 'text/plain', '.mjs': 'text/plain', '.cjs': 'text/plain',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.py': 'text/plain', '.rb': 'text/plain',
  '.java': 'text/plain', '.kt': 'text/plain', '.scala': 'text/plain', '.go': 'text/plain',
  '.rs': 'text/plain', '.c': 'text/plain', '.h': 'text/plain', '.cpp': 'text/plain',
  '.hpp': 'text/plain', '.cc': 'text/plain', '.cs': 'text/plain', '.php': 'text/plain',
  '.swift': 'text/plain', '.m': 'text/plain', '.r': 'text/plain', '.lua': 'text/plain',
  '.pl': 'text/plain', '.sh': 'text/plain', '.bash': 'text/plain', '.zsh': 'text/plain',
  '.fish': 'text/plain', '.sql': 'text/plain', '.tex': 'text/plain', '.bib': 'text/plain',
  '.gradle': 'text/plain', '.dockerfile': 'text/plain', '.srt': 'text/plain', '.vtt': 'text/plain',
};

const TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'license', 'readme', 'changelog', 'authors',
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.env',
]);

// Binary formats Gemini accepts as inline multimodal data.
const INLINE_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.tiff': 'image/tiff', '.tif': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp', '.flv': 'video/x-flv', '.mkv': 'video/x-matroska',
};

// Max bytes for inline media (the API rejects oversized inline requests).
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

/** Heuristic: treat as text if there is no NUL byte in the first chunk. */
function looksTextual(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 8192));
  return !slice.includes(0);
}

/**
 * Classify a local file for Gemini. Routes text/code to a text prompt and
 * PDF/image/audio/video to inline multimodal data. Files with an unknown
 * extension are read as text when they look textual; otherwise unsupported.
 */
export async function classifyFile(filePath: string): Promise<ClassifiedFile> {
  const abs = resolve(filePath);
  const ext = extname(abs).toLowerCase();
  const base = basename(abs).toLowerCase();

  if (TEXT_MIME[ext] || TEXT_BASENAMES.has(base)) {
    const text = await readFile(abs, 'utf8');
    return { mode: 'text', text, mimeType: TEXT_MIME[ext] || 'text/plain' };
  }

  if (INLINE_MIME[ext]) {
    const buf = await readFile(abs);
    if (buf.length > MAX_INLINE_BYTES) {
      throw new McpError(
        `File too large for inline processing (${Math.round(buf.length / 1024 / 1024)} MB, ` +
          `max ${Math.round(MAX_INLINE_BYTES / 1024 / 1024)} MB).`,
        'FILE_TOO_LARGE'
      );
    }
    logger.info('Classified file as inline media', { file: abs, mimeType: INLINE_MIME[ext], bytes: buf.length });
    return { mode: 'inline', data: buf.toString('base64'), mimeType: INLINE_MIME[ext] };
  }

  // Unknown extension: accept it as text if it looks textual.
  const buf = await readFile(abs);
  if (looksTextual(buf)) {
    return { mode: 'text', text: buf.toString('utf8'), mimeType: 'text/plain' };
  }

  throw new McpError(
    `Unsupported file type "${ext || base}". Supported: text/code files, PDF, images, ` +
      `audio and video. Office documents (docx/xlsx/pptx) must be exported to PDF first.`,
    'UNSUPPORTED_FILE'
  );
}
