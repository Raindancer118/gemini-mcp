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

/**
 * Configuration for spawning autonomous agents through the `opencode` CLI.
 * opencode handles provider auth/config itself (e.g. a `z-ai` provider for GLM
 * in ~/.config/opencode/opencode.json), so this MCP needs no model API key —
 * it just drives opencode and selects a model via `provider/model`.
 */
export interface OpencodeConfig {
  binary: string;             // path/name of the opencode executable
  defaultModel?: string;      // `provider/model`, e.g. "z-ai/glm-5.2"
  defaultVariant?: string;    // reasoning effort: minimal | low | high | max
  defaultDir?: string;        // working directory agents run in
  handshakeTimeoutMs: number; // how long to wait for the session id on spawn
}

export interface Config {
  gemini: GeminiConfig;
  agy: AgyConfig;
  opencode: OpencodeConfig;
  server: ServerConfig;
  logging: {
    level: string;
    format: string;
  };
}
