import { Config } from './types.js';
import * as dotenv from 'dotenv';

dotenv.config();

export const config: Config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE'
      }
    ],
    defaultModel: process.env.GEMINI_DEFAULT_MODEL || 'gemini-3.1-pro-preview',
    defaultDeepResearchAgent: process.env.GEMINI_DEEP_RESEARCH_AGENT || 'deep-research-pro-preview-12-2025',
    defaultImageAnalysisModel: process.env.GEMINI_IMAGE_ANALYSIS_MODEL || 'gemini-3.1-pro-preview',
    defaultImageDescribeModel: process.env.GEMINI_IMAGE_DESCRIBE_MODEL || 'gemini-3-flash-preview',
    defaultImageGenerationModel: process.env.GEMINI_IMAGE_GENERATION_MODEL || 'gemini-3-pro-image-preview',
    maxTokens: 65536,
    temperature: 1.0,
    defaultGrounding: true,
    allowExperimentalModels: process.env.GEMINI_ALLOW_EXPERIMENTAL === 'true'
  },
  agy: {
    binary: process.env.GEMINI_AGY_BIN || 'agy',
    defaultModel: process.env.GEMINI_AGY_MODEL || undefined,
    defaultTimeoutMs: process.env.GEMINI_AGY_TIMEOUT_SECONDS
      ? Math.max(10, parseInt(process.env.GEMINI_AGY_TIMEOUT_SECONDS, 10) || 600) * 1000
      : 600_000,
    // Non-interactive agents must auto-approve tool calls or they block forever
    // waiting for a permission prompt nobody can answer. Opt out with =false.
    autoApprove: process.env.GEMINI_AGY_AUTO_APPROVE !== 'false'
  },
  server: {
    name: 'gemini-mcp',
    version: '2.2.4',
    imageOutputDir: process.env.GEMINI_IMAGE_OUTPUT_DIR
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'combined'
  }
};

export function validateConfig(): void {
  if (!config.gemini.apiKey) {
    throw new Error(
      'GEMINI_API_KEY environment variable not set. ' +
      'Please set your Gemini API key: export GEMINI_API_KEY=your-api-key-here'
    );
  }
}
