import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import logger from '../../utils/logger.js';
import { McpError } from '../../utils/error-handler.js';
import type { OpencodeConfig } from '../../config/types.js';
import type {
  AgentStatus,
  ModelCostSummary,
  SendOptions,
  SessionCost,
  SpawnOptions,
  SpawnResult,
  ThoughtStep,
  TrackedAgent,
} from './types.js';

/**
 * Drives autonomous agents through `opencode` (the Claude Code alternative),
 * so Claude can spawn agents on ANY configured provider/model (e.g. GLM via
 * `openrouter/z-ai/glm-5.2`) without reimplementing the agent loop, tool-calling,
 * sandboxing, session persistence or prompt caching — opencode owns all of that.
 *
 * Hybrid design (each half verified against opencode 1.17.x):
 *  - EXECUTION via a detached `opencode run` process. The run creates a session
 *    and carries out the task in the background; we tag it with a unique --title.
 *    (The headless server's REST `prompt` endpoints only *admit* prompts without
 *    ever executing them, so we do not use them to run agents.)
 *  - INTROSPECTION via one headless `opencode serve` HTTP server we keep for the
 *    MCP's lifetime. It discovers the detached run's session (by title) within a
 *    few seconds and exposes live status, cost/tokens and the full thought-chain.
 *
 * This makes spawn return a session id almost immediately while the agent keeps
 * "thinking" in the background — status/thoughts/cost are queryable at any time.
 */
export class OpencodeService {
  private server?: ChildProcess;
  private baseUrl?: string;
  private starting?: Promise<string>;
  /** Agents spawned in this MCP lifetime, keyed by session id (or temp key). */
  private agents = new Map<string, TrackedAgent>();

  constructor(private cfg: OpencodeConfig) {
    const stop = () => this.dispose();
    process.once('exit', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }

  // ---------------------------------------------------------------------------
  // Pure, unit-testable helpers
  // ---------------------------------------------------------------------------

  /** Build the `opencode run` argument vector (pure, unit-testable). */
  static buildRunArgs(opts: {
    prompt: string;
    model?: string;
    variant?: string;
    agent?: string;
    title?: string;
    sessionId?: string;
  }): string[] {
    const args = ['run'];
    if (opts.sessionId) args.push('--session', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);
    if (opts.variant) args.push('--variant', opts.variant);
    if (opts.agent) args.push('--agent', opts.agent);
    if (opts.title) args.push('--title', opts.title);
    args.push(opts.prompt);
    return args;
  }

  /** Parse the listening URL from `opencode serve` stdout (pure). */
  static parseServerUrl(log: string): string | undefined {
    const m = log.match(/https?:\/\/[0-9.]+:\d+/);
    return m ? m[0] : undefined;
  }

  /** Map an opencode session `info` object to a token/cost breakdown (pure). */
  static parseSessionCost(info: unknown): SessionCost | undefined {
    if (!info || typeof info !== 'object') return undefined;
    const i = info as Record<string, unknown>;
    const model = i.model as { providerID?: string; id?: string } | undefined;
    const tokens = i.tokens as
      | {
          input?: number;
          output?: number;
          reasoning?: number;
          cache?: { read?: number; write?: number };
        }
      | undefined;
    const time = i.time as { updated?: number } | undefined;
    return {
      sessionId: String(i.id ?? ''),
      model: model ? `${model.providerID ?? '?'}/${model.id ?? '?'}` : 'unknown',
      cost: Number(i.cost ?? 0),
      inputTokens: Number(tokens?.input ?? 0),
      outputTokens: Number(tokens?.output ?? 0),
      reasoningTokens: Number(tokens?.reasoning ?? 0),
      cacheReadTokens: Number(tokens?.cache?.read ?? 0),
      cacheWriteTokens: Number(tokens?.cache?.write ?? 0),
      updated: Number(time?.updated ?? 0),
    };
  }

  /** Aggregate several per-session costs by model (pure). */
  static aggregateCostByModel(costs: SessionCost[]): ModelCostSummary[] {
    const byModel = new Map<string, ModelCostSummary>();
    for (const c of costs) {
      const agg =
        byModel.get(c.model) ??
        ({
          model: c.model,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sessions: 0,
        } satisfies ModelCostSummary);
      agg.cost += c.cost;
      agg.inputTokens += c.inputTokens;
      agg.outputTokens += c.outputTokens;
      agg.reasoningTokens += c.reasoningTokens;
      agg.cacheReadTokens += c.cacheReadTokens;
      agg.cacheWriteTokens += c.cacheWriteTokens;
      agg.sessions += 1;
      byModel.set(c.model, agg);
    }
    return [...byModel.values()].sort((a, b) => b.cost - a.cost);
  }

  /**
   * Build a reasoning/action timeline from a `{ info, parts }[]` message list
   * (pure). Matches both the HTTP `/session/{id}/message` response and the
   * `opencode export` `.messages` array.
   */
  static parseThoughts(
    messages: Array<Record<string, unknown>>,
    limit = 0
  ): ThoughtStep[] {
    const steps: ThoughtStep[] = [];
    for (const msg of messages ?? []) {
      const info = (msg.info ?? {}) as { role?: 'user' | 'assistant' };
      const role = info.role === 'user' ? 'user' : 'assistant';
      const parts = (msg.parts ?? []) as Array<Record<string, unknown>>;
      for (const part of parts) {
        const type = part.type;
        if (type === 'reasoning') {
          const text = String(part.text ?? '').trim();
          if (text) steps.push({ kind: 'reasoning', role, text });
        } else if (type === 'text') {
          const text = String(part.text ?? '').trim();
          if (text) steps.push({ kind: 'text', role, text });
        } else if (type === 'tool') {
          const state = (part.state ?? {}) as {
            status?: string;
            title?: string;
            input?: unknown;
          };
          const tool = String(part.tool ?? 'tool');
          const summary = state.title
            ? String(state.title)
            : JSON.stringify(state.input ?? {}).slice(0, 200);
          steps.push({ kind: 'tool', role, tool, status: state.status, text: summary });
        }
      }
    }
    return limit > 0 ? steps.slice(-limit) : steps;
  }

  // ---------------------------------------------------------------------------
  // Server lifecycle (introspection backend)
  // ---------------------------------------------------------------------------

  private async ensureServer(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    if (this.starting) return this.starting;

    this.starting = new Promise<string>((resolve, reject) => {
      let log = '';
      let child: ChildProcess;
      try {
        child = spawn(this.cfg.binary, ['serve', '--port', '0'], {
          cwd: this.cfg.defaultDir,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(
          new McpError(
            `Failed to start opencode server ("${this.cfg.binary}"): ${
              (err as Error).message
            }. Is opencode installed and on PATH?`,
            'OPENCODE_SPAWN_ERROR'
          )
        );
        return;
      }
      this.server = child;

      const onData = (d: Buffer) => {
        log += d.toString();
        const url = OpencodeService.parseServerUrl(log);
        if (url) {
          this.baseUrl = url;
          child.stdout?.off('data', onData);
          child.stderr?.off('data', onData);
          logger.info('opencode server ready', { url });
          resolve(url);
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.on('error', (err) =>
        reject(new McpError(`opencode server error: ${err.message}`, 'OPENCODE_SPAWN_ERROR'))
      );
      child.on('close', (code) => {
        this.baseUrl = undefined;
        this.server = undefined;
        reject(
          new McpError(
            `opencode server exited (code ${code}) before becoming ready: ${
              log.slice(-400) || 'no output'
            }`,
            'OPENCODE_ERROR'
          )
        );
      });

      setTimeout(() => {
        if (!this.baseUrl)
          reject(
            new McpError(
              `opencode server did not become ready within ${this.cfg.handshakeTimeoutMs}ms`,
              'OPENCODE_TIMEOUT'
            )
          );
      }, this.cfg.handshakeTimeoutMs).unref();
    }).finally(() => {
      this.starting = undefined;
    });

    return this.starting;
  }

  /** Stop the managed opencode server, if running. */
  dispose(): void {
    if (this.server) {
      try {
        this.server.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      this.server = undefined;
      this.baseUrl = undefined;
    }
  }

  /** True if opencode can be reached (starts the server as a side effect). */
  async isAvailable(): Promise<boolean> {
    try {
      const base = await this.ensureServer();
      const r = await fetch(`${base}/api/health`);
      return r.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers (introspection)
  // ---------------------------------------------------------------------------

  private async api<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const base = await this.ensureServer();
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new McpError(
        `opencode request failed (${method} ${path}): ${(err as Error).message}`,
        'OPENCODE_ERROR'
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new McpError(
        `opencode ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`,
        'OPENCODE_ERROR'
      );
    }
    return (await res.json()) as T;
  }

  /** Unwrap the `{ data }` envelope used by the /api routes. */
  private static unwrap<T>(payload: unknown): T {
    const p = payload as { data?: T };
    return (p && typeof p === 'object' && 'data' in p ? p.data : payload) as T;
  }

  // ---------------------------------------------------------------------------
  // Spawning & conversing (execution via detached `opencode run`)
  // ---------------------------------------------------------------------------

  /** Spawn a new background agent and resolve its session id (by title). */
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const model = opts.model ?? this.cfg.defaultModel;
    const variant = opts.variant ?? this.cfg.defaultVariant;
    const title = opts.title ?? `mcp-${randomUUID().slice(0, 8)}`;

    const args = OpencodeService.buildRunArgs({
      prompt: opts.prompt,
      model,
      variant,
      agent: opts.agent,
      title,
    });
    return this.launch(args, model, title, opts.directory);
  }

  /** Continue an existing session with a new message ("unterhalten"). */
  async send(opts: SendOptions): Promise<SpawnResult> {
    const model = opts.model ?? this.cfg.defaultModel;
    const variant = opts.variant ?? this.cfg.defaultVariant;
    const existing = this.agents.get(opts.sessionId);
    const title = existing?.title ?? `mcp-${randomUUID().slice(0, 8)}`;

    const args = OpencodeService.buildRunArgs({
      prompt: opts.message,
      model,
      variant,
      sessionId: opts.sessionId,
    });
    // We already know the session id here, so launch and tag it directly.
    const res = await this.launch(args, model, title, opts.directory, opts.sessionId);
    return { ...res, sessionId: opts.sessionId };
  }

  /** Launch a detached `opencode run`; discover/attach its session id. */
  private async launch(
    args: string[],
    model: string,
    title: string,
    directory?: string,
    knownSessionId?: string
  ): Promise<SpawnResult> {
    const logDir = await mkdtemp(join(tmpdir(), 'opencode-mcp-'));
    const logFile = join(logDir, 'run.log');
    const out = createWriteStream(logFile);

    let child: ChildProcess;
    try {
      child = spawn(this.cfg.binary, args, {
        cwd: directory ?? this.cfg.defaultDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (err) {
      throw new McpError(
        `Failed to spawn opencode run ("${this.cfg.binary}"): ${
          (err as Error).message
        }. Is opencode installed and on PATH?`,
        'OPENCODE_SPAWN_ERROR'
      );
    }
    child.stdout?.on('data', (d) => out.write(d));
    child.stderr?.on('data', (d) => out.write(d));

    const pid = child.pid ?? -1;
    const tracked: TrackedAgent = {
      sessionId: knownSessionId,
      pid,
      model,
      title,
      logFile,
      startedAt: Date.now(),
    };
    const key = knownSessionId ?? `pid-${pid}`;
    this.agents.set(key, tracked);

    child.on('close', (code) => {
      tracked.finishedAt = Date.now();
      tracked.exitCode = code ?? 1;
      out.end();
    });

    logger.info('Launched opencode run', { model, title, pid, knownSessionId });

    let sessionId = knownSessionId;
    if (!sessionId) {
      sessionId = await this.discoverSessionByTitle(title);
      if (sessionId) {
        tracked.sessionId = sessionId;
        this.agents.delete(key);
        this.agents.set(sessionId, tracked);
      }
    }

    child.unref();

    return {
      sessionId,
      pid: pid > 0 ? pid : undefined,
      model,
      running: tracked.finishedAt === undefined,
    };
  }

  /** Poll the server's session list for the run we just tagged by title. */
  private async discoverSessionByTitle(title: string): Promise<string | undefined> {
    const deadline = Date.now() + this.cfg.handshakeTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const sessions = OpencodeService.unwrap<Array<{ id: string; title?: string }>>(
          await this.api('GET', '/api/session')
        );
        const hit = sessions.find((s) => s.title === title);
        if (hit) return hit.id;
      } catch {
        /* server may still be warming up */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Status, thoughts, cost (introspection via HTTP)
  // ---------------------------------------------------------------------------

  /** List sessions spawned in this MCP lifetime with live status + cost. */
  async listAgents(): Promise<AgentStatus[]> {
    const out: AgentStatus[] = [];
    for (const a of this.agents.values()) out.push(await this.statusOf(a));
    return out;
  }

  /** Status of a single session by id (works for persisted sessions too). */
  async status(sessionId: string): Promise<AgentStatus> {
    const tracked = this.agents.get(sessionId);
    if (tracked) return this.statusOf(tracked);
    const cost = await this.cost(sessionId).catch(() => undefined);
    return { sessionId, state: 'unknown', cost };
  }

  private async statusOf(a: TrackedAgent): Promise<AgentStatus> {
    const alive = a.finishedAt === undefined && a.pid > 0 && isAlive(a.pid);
    let cost: SessionCost | undefined;
    if (a.sessionId) cost = await this.cost(a.sessionId).catch(() => undefined);
    return {
      sessionId: a.sessionId,
      pid: a.pid > 0 ? a.pid : undefined,
      model: a.model,
      title: a.title,
      state: alive ? 'running' : 'finished',
      exitCode: a.exitCode,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      cost,
    };
  }

  /** Reasoning/action timeline for a session (the "thought-chain"). */
  async thoughts(sessionId: string, limit = 0): Promise<ThoughtStep[]> {
    const messages = OpencodeService.unwrap<Array<Record<string, unknown>>>(
      await this.api('GET', `/session/${sessionId}/message`)
    );
    return OpencodeService.parseThoughts(messages, limit);
  }

  /** Latest assistant text for a session. */
  async output(sessionId: string): Promise<string> {
    const steps = await this.thoughts(sessionId, 0);
    const texts = steps.filter((s) => s.kind === 'text' && s.role === 'assistant');
    return texts.map((s) => s.text).join('\n\n') || '(no output yet)';
  }

  /** Token + cost breakdown for one session. */
  async cost(sessionId: string): Promise<SessionCost> {
    const info = OpencodeService.unwrap<Record<string, unknown>>(
      await this.api('GET', `/api/session/${sessionId}`)
    );
    const parsed = OpencodeService.parseSessionCost(info);
    if (!parsed)
      throw new McpError(
        `Could not parse cost for session ${sessionId}`,
        'OPENCODE_PARSE_ERROR'
      );
    return parsed;
  }

  /** Cost of all agents spawned this MCP lifetime, aggregated by model. */
  async sessionCostByModel(): Promise<ModelCostSummary[]> {
    const ids = [...this.agents.values()]
      .map((a) => a.sessionId)
      .filter((x): x is string => Boolean(x));
    const costs: SessionCost[] = [];
    for (const id of ids) {
      const c = await this.cost(id).catch(() => undefined);
      if (c) costs.push(c);
    }
    return OpencodeService.aggregateCostByModel(costs);
  }

  /** List models opencode currently exposes (optionally filtered by provider). */
  async listModels(provider?: string): Promise<string> {
    const models = OpencodeService.unwrap<Array<{ providerID: string; id: string; name?: string }>>(
      await this.api('GET', '/api/model')
    );
    const filtered = provider
      ? models.filter((m) => m.providerID === provider)
      : models;
    return filtered
      .map((m) => `${m.providerID}/${m.id}${m.name ? ` — ${m.name}` : ''}`)
      .join('\n');
  }

  /** Stop a running background agent: kill its process and abort the turn. */
  async stop(sessionId: string): Promise<boolean> {
    let ok = false;
    const a = this.agents.get(sessionId);
    if (a && a.pid > 0) {
      try {
        process.kill(-a.pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(-a.pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }, 3_000).unref();
        a.finishedAt = Date.now();
        ok = true;
      } catch {
        /* process already gone */
      }
    }
    await this.api('POST', `/session/${sessionId}/abort`).catch(() => {});
    return ok;
  }
}

/** Whether a pid is currently alive (signal 0 probe). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
