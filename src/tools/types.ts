import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GeminiService } from '../services/gemini/index.js';
import { GeminiImageService } from '../services/gemini/image-service.js';
import { MediaServer } from '../services/media-server.js';
import { AgyService } from '../services/agy/index.js';
import { OpencodeService } from '../services/opencode/index.js';

export interface ToolContext {
  server: McpServer;
  geminiService: GeminiService;
  imageService: GeminiImageService;
  agyService: AgyService;
  opencodeService: OpencodeService;
  outputDir: string;
  mediaServer: MediaServer;
}
