#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { config, validateConfig } from './config/index.js';
import { GeminiService } from './services/gemini/index.js';
import { GeminiImageService } from './services/gemini/image-service.js';
import { AgyService } from './services/agy/index.js';
import { MediaServer } from './services/media-server.js';
import logger from './utils/logger.js';

import { registerViewers } from './tools/register-viewers.js';
import { registerGeminiHelp } from './tools/gemini-help.js';
import { registerPromptAssistant } from './tools/image-prompt-assistant.js';
import { register as registerChat } from './tools/register-chat.js';
import { register as registerListModels } from './tools/register-list-models.js';
import { register as registerDeepResearch } from './tools/register-deep-research.js';
import { register as registerDescribeImage } from './tools/register-describe-image.js';
import { register as registerAnalyzeImage } from './tools/register-analyze-image.js';
import { register as registerLoadImage } from './tools/register-load-image.js';
import { register as registerImageGen } from './tools/register-image-gen.js';
import { register as registerLandingPage } from './tools/register-landing-page.js';
import { register as registerSvg } from './tools/register-svg.js';
import { register as registerVideo } from './tools/register-video.js';
import { register as registerAgent } from './tools/register-agent.js';
import { register as registerOcr } from './tools/register-ocr.js';
import { register as registerSummary } from './tools/register-summary.js';

import type { ToolContext } from './tools/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE_OUTPUT_DIR = resolve(__dirname, '..', 'output');

const TOOL_NAMES = [
  'gemini_chat', 'gemini_list_models', 'gemini_deep_research',
  'generate_image', 'edit_image', 'describe_image', 'analyze_image',
  'generate_video',
  'load_image_from_path', 'generate_landing_page', 'generate_svg',
  'gemini_agent', 'gemini_agent_models',
  'ocr', 'generate_summary',
  'gemini_help', 'gemini_prompt_assistant',
] as const;

class GeminiMcpServer {
  private server: McpServer;
  private geminiService: GeminiService;
  private agyService: AgyService;
  private mediaServer: MediaServer;
  private outputDir: string;

  constructor() {
    try {
      validateConfig();
    } catch (error) {
      logger.error('Configuration validation failed', { error });
      process.exit(1);
    }

    this.geminiService = new GeminiService(config.gemini, config.server.imageOutputDir);
    this.agyService = new AgyService(config.agy);
    this.outputDir = config.server.imageOutputDir || DEFAULT_IMAGE_OUTPUT_DIR;
    this.mediaServer = new MediaServer(this.outputDir);

    this.server = new McpServer({
      name: config.server.name,
      version: config.server.version,
    });

    logger.info('Gemini MCP Server initialized', {
      serverName: config.server.name,
      version: config.server.version,
    });
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Gemini MCP Server...');

      await this.mediaServer.start();

      const ctx: ToolContext = {
        server: this.server,
        geminiService: this.geminiService,
        imageService: new GeminiImageService(config.gemini),
        agyService: this.agyService,
        outputDir: this.outputDir,
        mediaServer: this.mediaServer,
      };

      await registerViewers(this.server, __dirname, this.mediaServer.getPort());
      registerGeminiHelp(this.server);
      registerPromptAssistant(this.server);
      registerChat(ctx);
      registerListModels(ctx);
      registerDeepResearch(ctx);
      registerDescribeImage(ctx);
      registerAnalyzeImage(ctx);
      registerLoadImage(ctx);
      registerImageGen(ctx);
      registerLandingPage(ctx);
      registerSvg(ctx);
      registerVideo(ctx);
      registerAgent(ctx);
      registerOcr(ctx);
      registerSummary(ctx);

      logger.info('Tools registered', {
        toolCount: TOOL_NAMES.length,
        tools: [...TOOL_NAMES],
      });

      // Connect the transport FIRST so the MCP initialize handshake completes
      // immediately. The API-key check is a network call (googleapis); doing it
      // before connecting can stall the handshake and make clients drop the
      // connection (-32000) on slow networks. Validate in the background instead.
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      logger.info('Gemini MCP Server started successfully', {
        transport: 'stdio',
        toolsAvailable: [...TOOL_NAMES],
        mediaServerPort: this.mediaServer.getPort(),
      });

      void this.geminiService
        .validateConfig()
        .then((isValid) => {
          if (!isValid) {
            logger.warn(
              'Gemini API key validation failed — API-backed tools will error until a valid GEMINI_API_KEY is set. (agy-based tools are unaffected.)'
            );
          }
        })
        .catch((error) => {
          logger.warn('Gemini API key validation could not be completed', {
            error: (error as Error).message,
          });
        });
    } catch (error) {
      logger.error('Failed to start Gemini MCP Server', { error });
      process.exit(1);
    }
  }

  shutdown(): void {
    this.mediaServer.stop();
  }
}

let serverInstance: GeminiMcpServer | null = null;

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  serverInstance?.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  serverInstance?.shutdown();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  serverInstance?.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  serverInstance?.shutdown();
  process.exit(1);
});

async function main() {
  serverInstance = new GeminiMcpServer();
  await serverInstance.start();
}

main().catch(error => {
  logger.error('Server startup failed', { error });
  serverInstance?.shutdown();
  process.exit(1);
});

export { GeminiMcpServer };
