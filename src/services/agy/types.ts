/**
 * Options for launching a single non-interactive Gemini agent run via `agy`.
 */
export interface AgyLaunchOptions {
  /** The task / instructions for the agent (the prompt). */
  prompt: string;
  /** Model label as shown by `agy models`, e.g. "Gemini 3.1 Pro (High)". */
  model?: string;
  /** Primary working directory for the agent (process cwd). */
  directory?: string;
  /** Additional directories to add to the agent workspace (--add-dir). */
  addDirectories?: string[];
  /** Resume a specific previous conversation by ID (--conversation). */
  conversationId?: string;
  /** Continue the most recent conversation (--continue). Ignored if conversationId set. */
  continueRecent?: boolean;
  /** Auto-approve all tool permission requests (--dangerously-skip-permissions). */
  autoApprove?: boolean;
  /** Run inside agy's restricted sandbox (--sandbox). */
  sandbox?: boolean;
  /** Hard timeout in milliseconds for the whole run. */
  timeoutMs?: number;
}

export interface AgyLaunchResult {
  /** The agent's final printed response (stdout). */
  output: string;
  /** Conversation ID parsed from the agy run log, if found. */
  conversationId?: string;
  /** Model that was requested (if any). */
  model?: string;
  /** Process exit code. */
  exitCode: number;
  /** Wall-clock duration of the run. */
  durationMs: number;
  /** True if the run was killed because it exceeded timeoutMs. */
  timedOut: boolean;
  /** Captured stderr (diagnostics), trimmed. */
  stderr: string;
}
