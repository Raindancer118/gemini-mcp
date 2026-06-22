import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import logger from '../../utils/logger.js';
import { McpError } from '../../utils/error-handler.js';
import type { AgyConfig } from '../../config/types.js';
import type { AgyLaunchOptions, AgyLaunchResult } from './types.js';

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface RawRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Thin wrapper around the `agy` CLI that lets Claude launch Gemini agents.
 *
 * Each launch runs `agy --print` non-interactively in a workspace directory.
 * The agent can read/edit files and run commands there (auto-approved by
 * default), then prints its final answer to stdout. We always route agy's
 * verbose runtime log to a temp file so we can recover the conversation ID,
 * which Claude can pass back to continue the same agent session.
 */
export class AgyService {
  constructor(private cfg: AgyConfig) {}

  /** List the agent model labels available to `agy`. */
  async listModels(): Promise<string[]> {
    const { stdout, exitCode, stderr } = await this.run(['models'], {
      timeoutMs: 30_000,
    });
    if (exitCode !== 0) {
      throw new McpError(
        `agy models failed (exit ${exitCode}): ${stderr || 'no output'}`,
        'AGY_ERROR'
      );
    }
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /** Quick check that the agy binary is invokable. */
  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await this.run(['--help'], { timeoutMs: 10_000 });
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Build the agy argument vector for a launch (pure, unit-testable). */
  static buildArgs(opts: AgyLaunchOptions, logFile: string): string[] {
    const args: string[] = [];

    if (opts.conversationId) {
      args.push('--conversation', opts.conversationId);
    } else if (opts.continueRecent) {
      args.push('--continue');
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    for (const dir of opts.addDirectories ?? []) {
      if (dir) args.push('--add-dir', dir);
    }

    if (opts.autoApprove) {
      args.push('--dangerously-skip-permissions');
    }

    if (opts.sandbox) {
      args.push('--sandbox');
    }

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      args.push('--print-timeout', `${Math.ceil(opts.timeoutMs / 1000)}s`);
    }

    args.push('--log-file', logFile);
    args.push('--print', opts.prompt);

    return args;
  }

  /** Extract a conversation ID from agy's run log (pure, unit-testable). */
  static parseConversationId(logContent: string): string | undefined {
    const lines = logContent.split('\n');
    // Prefer lines that explicitly name a completed/active conversation stream.
    for (const line of lines) {
      if (/Stream completed for|conversation/i.test(line)) {
        const m = line.match(UUID_RE);
        if (m) return m[0];
      }
    }
    // Fallback: any UUID anywhere in the log.
    const any = logContent.match(UUID_RE);
    return any ? any[0] : undefined;
  }

  async launchAgent(opts: AgyLaunchOptions): Promise<AgyLaunchResult> {
    const timeoutMs = opts.timeoutMs ?? this.cfg.defaultTimeoutMs;
    const resolved: AgyLaunchOptions = {
      ...opts,
      model: opts.model ?? this.cfg.defaultModel,
      autoApprove: opts.autoApprove ?? this.cfg.autoApprove,
      timeoutMs,
    };

    const logDir = await mkdtemp(join(tmpdir(), 'agy-mcp-'));
    const logFile = join(logDir, 'run.log');
    const args = AgyService.buildArgs(resolved, logFile);

    logger.info('Launching Gemini agent via agy', {
      model: resolved.model,
      directory: resolved.directory,
      addDirectories: resolved.addDirectories,
      conversationId: resolved.conversationId,
      autoApprove: resolved.autoApprove,
      sandbox: resolved.sandbox,
      timeoutMs,
      promptLength: resolved.prompt.length,
    });

    const started = Date.now();
    try {
      const raw = await this.run(args, {
        cwd: resolved.directory,
        // give the process a small grace margin over agy's own print-timeout
        timeoutMs: timeoutMs + 15_000,
      });
      const durationMs = Date.now() - started;

      let conversationId: string | undefined;
      try {
        conversationId = AgyService.parseConversationId(
          await readFile(logFile, 'utf8')
        );
      } catch {
        /* log file may be absent on hard failure */
      }

      if (raw.exitCode !== 0 && !raw.timedOut) {
        throw new McpError(
          `agy exited with code ${raw.exitCode}: ${
            raw.stderr || raw.stdout || 'no output'
          }`,
          'AGY_ERROR'
        );
      }

      return {
        output: raw.stdout.trim(),
        conversationId,
        model: resolved.model,
        exitCode: raw.exitCode,
        durationMs,
        timedOut: raw.timedOut,
        stderr: raw.stderr.trim(),
      };
    } finally {
      await rm(logDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Spawn agy and collect output, enforcing a hard timeout. */
  private run(
    args: string[],
    { cwd, timeoutMs }: { cwd?: string; timeoutMs: number }
  ): Promise<RawRun> {
    return new Promise<RawRun>((resolve, reject) => {
      let child;
      try {
        child = spawn(this.cfg.binary, args, {
          cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(
          new McpError(
            `Failed to spawn agy ("${this.cfg.binary}"): ${
              (err as Error).message
            }. Is agy installed and on PATH?`,
            'AGY_SPAWN_ERROR'
          )
        );
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // escalate if it ignores SIGTERM
        setTimeout(() => child.kill('SIGKILL'), 3_000).unref();
      }, timeoutMs);

      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new McpError(
            `agy process error: ${err.message}. Is agy installed and on PATH?`,
            'AGY_SPAWN_ERROR'
          )
        );
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? (timedOut ? 124 : 1),
          timedOut,
        });
      });
    });
  }
}
