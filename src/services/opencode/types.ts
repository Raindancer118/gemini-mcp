/**
 * Types for driving autonomous agents through the `opencode` CLI.
 *
 * opencode is a full agent harness (the Claude Code alternative) that already
 * implements the agent loop, tool-calling, sandboxing, session persistence and
 * prompt caching. We wrap its CLI so Claude can spawn agents on ANY provider/model
 * opencode is configured for (e.g. `z-ai/glm-5.2`) without reimplementing any of
 * that machinery — exactly mirroring how AgyService wraps the `agy` CLI.
 */

/** Options for spawning a brand-new agent run. */
export interface SpawnOptions {
  /** The task/prompt for the agent (required). */
  prompt: string;
  /** Model as `provider/model`, e.g. `z-ai/glm-5.2`. Defaults to config. */
  model?: string;
  /** Provider-specific reasoning effort: `minimal` | `low` | `high` | `max`. */
  variant?: string;
  /** Named opencode agent profile (`--agent`), e.g. `build`, `plan`. */
  agent?: string;
  /** Working directory the agent runs in. Defaults to config / cwd. */
  directory?: string;
  /** Optional human-readable session title. */
  title?: string;
  /** Hard time budget in ms (for the spawn handshake / sync runs). */
  timeoutMs?: number;
}

/** Options for continuing an existing session ("unterhalten"). */
export interface SendOptions {
  sessionId: string;
  message: string;
  model?: string;
  variant?: string;
  directory?: string;
  timeoutMs?: number;
}

/** Result of spawning an agent (returns once the session id is known). */
export interface SpawnResult {
  /** opencode session id (`ses_...`) — pass back to send/status/thoughts. */
  sessionId?: string;
  /** OS process id of the background run, if still tracked. */
  pid?: number;
  model?: string;
  /** Whether the run is still executing in the background. */
  running: boolean;
}

/** A tracked background agent (detached `opencode run`) in this MCP lifetime. */
export interface TrackedAgent {
  sessionId?: string;
  pid: number;
  model?: string;
  title: string;
  logFile: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

/** Per-session token + cost breakdown parsed from `opencode export`. */
export interface SessionCost {
  sessionId: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  updated: number;
}

/** Cost aggregated by model across several sessions ("this session" view). */
export interface ModelCostSummary {
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sessions: number;
}

/** One step in an agent's reasoning / action timeline. */
export interface ThoughtStep {
  kind: 'reasoning' | 'text' | 'tool';
  role: 'user' | 'assistant';
  /** For `tool` steps: the tool name. */
  tool?: string;
  /** For `tool` steps: status (`completed`, `error`, `running`, ...). */
  status?: string;
  /** Human-readable content (reasoning text, assistant text, or tool summary). */
  text: string;
}

/** Status of a tracked / persisted agent. */
export interface AgentStatus {
  sessionId?: string;
  pid?: number;
  model?: string;
  title?: string;
  /** `running` (pid alive), `finished` (pid exited), `unknown` (not tracked). */
  state: 'running' | 'finished' | 'unknown';
  exitCode?: number;
  timedOut?: boolean;
  startedAt?: number;
  finishedAt?: number;
  /** Latest cost snapshot if the session has been persisted. */
  cost?: SessionCost;
}
