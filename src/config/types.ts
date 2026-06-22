export interface SafetySetting {
  category: string;
  threshold: string;
}

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'minimal';

export interface GeminiConfig {
  apiKey?: string;
  safetySettings: SafetySetting[];
  // Task-specific default models
  defaultModel: string;                // chat / text generation
  defaultDeepResearchAgent: string;    // real Deep Research agent via the Interactions API
  defaultImageAnalysisModel: string;   // analyze_image (multimodal reasoning)
  defaultImageDescribeModel: string;   // describe_image (lighter vision task)
  defaultImageGenerationModel: string; // generate_image / edit_image
  maxTokens: number;
  temperature: number;
  defaultGrounding: boolean;
  allowExperimentalModels?: boolean;
}

export interface ServerConfig {
  name: string;
  version: string;
  imageOutputDir?: string;
}

/**
 * Configuration for launching Gemini agents through the `agy` CLI.
 * Unlike the Gemini API tools, the agent uses agy's own authentication
 * (Antigravity / Cloud Code login) and does not require GEMINI_API_KEY.
 */
export interface AgyConfig {
  binary: string;            // path/name of the agy executable
  defaultModel?: string;     // optional model label, e.g. "Gemini 3.1 Pro (High)"
  defaultTimeoutMs: number;  // default print-mode timeout
  autoApprove: boolean;      // pass --dangerously-skip-permissions by default
}

export interface Config {
  gemini: GeminiConfig;
  agy: AgyConfig;
  server: ServerConfig;
  logging: {
    level: string;
    format: string;
  };
}
