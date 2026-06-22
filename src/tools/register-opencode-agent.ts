import * as z from 'zod';
import logger from '../utils/logger.js';
import { createToolResult } from '../utils/error-handler.js';
import { toolError } from '../utils/tool-wrapper.js';
import type { ToolContext } from './types.js';
import type {
  AgentStatus,
  ModelCostSummary,
  SessionCost,
  ThoughtStep,
} from '../services/opencode/types.js';

function fmtCost(c?: SessionCost): string {
  if (!c) return '(no cost data yet)';
  return (
    `$${c.cost.toFixed(4)} · in ${c.inputTokens} / out ${c.outputTokens} / ` +
    `reasoning ${c.reasoningTokens} · cache read ${c.cacheReadTokens} / write ${c.cacheWriteTokens}`
  );
}

function fmtStatus(s: AgentStatus): string {
  const lines = [
    `• ${s.sessionId ?? '(no session id)'} — ${s.state}` +
      (s.model ? ` · ${s.model}` : '') +
      (s.title ? ` · "${s.title}"` : ''),
  ];
  if (s.exitCode !== undefined && s.state === 'finished')
    lines.push(`    exit ${s.exitCode}${s.timedOut ? ' (timed out)' : ''}`);
  if (s.cost) lines.push(`    cost: ${fmtCost(s.cost)}`);
  return lines.join('\n');
}

export function register(ctx: ToolContext): void {
  const svc = ctx.opencodeService;

  // ---- agent_spawn ----------------------------------------------------------
  ctx.server.registerTool(
    'agent_spawn',
    {
      title: 'Spawn Agent (opencode)',
      description:
        'Spawn an autonomous agent backed by the `opencode` harness on any ' +
        'configured provider/model (e.g. GLM via "z-ai/glm-5.2"). The agent ' +
        'runs in the background — it can read/edit files and run tools in a ' +
        'working directory — and returns a session_id immediately. Use ' +
        'agent_send to continue the conversation, agent_status to check on it, ' +
        'agent_thoughts for its reasoning/tool timeline, and agent_cost for ' +
        'token spend. opencode handles prompt caching automatically; control ' +
        'reasoning effort (and token spend) with `variant`.',
      inputSchema: {
        task: z
          .string()
          .describe(
            'The instructions for the agent. Be explicit and self-contained: ' +
              'goal, relevant paths, constraints, and what "done" looks like.'
          ),
        model: z
          .string()
          .optional()
          .describe(
            'Model as `provider/model`, e.g. "z-ai/glm-5.2". Defaults to ' +
              'OPENCODE_DEFAULT_MODEL. See agent_models for available ids.'
          ),
        variant: z
          .enum(['minimal', 'low', 'high', 'max'])
          .optional()
          .describe(
            'Provider reasoning effort. Higher = more thinking tokens (more ' +
              'cost) but deeper reasoning. For GLM: high/max enable thinking.'
          ),
        agent: z
          .string()
          .optional()
          .describe('Named opencode agent profile (e.g. "build", "plan").'),
        directory: z
          .string()
          .optional()
          .describe('Absolute working directory the agent runs in.'),
        title: z
          .string()
          .optional()
          .describe('Optional human-readable session title.'),
        timeout_seconds: z
          .number()
          .int()
          .min(5)
          .max(120)
          .optional()
          .describe(
            'How long to wait for the session id before returning (the agent ' +
              'keeps running after). Defaults to the configured handshake timeout.'
          ),
      },
      outputSchema: {
        content: z.string(),
        session_id: z.string().optional(),
        running: z.boolean(),
        success: z.boolean(),
      },
    },
    async ({ task, model, variant, agent, directory, title, timeout_seconds }) => {
      try {
        logger.info('Executing agent_spawn tool', { model, variant, title });
        const result = await svc.spawn({
          prompt: task,
          model,
          variant,
          agent,
          directory,
          title,
          timeoutMs: timeout_seconds ? timeout_seconds * 1000 : undefined,
        });

        const lines = [
          result.sessionId
            ? `Agent spawned. session_id: ${result.sessionId}`
            : 'Agent spawned, but the session id was not detected in time. ' +
              'Use agent_status to list running agents.',
          `model: ${result.model ?? 'default'} · ${
            result.running ? 'running in background' : 'finished'
          }`,
          result.sessionId
            ? 'Continue with agent_send(session_id, message); inspect with ' +
              'agent_thoughts / agent_status / agent_cost.'
            : '',
        ].filter(Boolean);
        const text = lines.join('\n');

        return {
          content: createToolResult(true, text),
          structuredContent: {
            content: text,
            session_id: result.sessionId,
            running: result.running,
            success: true,
          },
        };
      } catch (error) {
        return toolError('agent_spawn', error);
      }
    }
  );

  // ---- agent_send -----------------------------------------------------------
  ctx.server.registerTool(
    'agent_send',
    {
      title: 'Send Message to Agent (opencode)',
      description:
        'Continue an existing agent session ("unterhalten") by sending a ' +
        'follow-up message. Reuses the session context (and its prompt cache), ' +
        'so it is cheap. Runs in the background like agent_spawn.',
      inputSchema: {
        session_id: z
          .string()
          .describe('The session_id returned by agent_spawn.'),
        message: z.string().describe('The follow-up message for the agent.'),
        model: z
          .string()
          .optional()
          .describe('Override the model for this turn (rarely needed).'),
        variant: z
          .enum(['minimal', 'low', 'high', 'max'])
          .optional()
          .describe('Override reasoning effort for this turn.'),
        directory: z.string().optional().describe('Override working directory.'),
        timeout_seconds: z.number().int().min(5).max(120).optional(),
      },
      outputSchema: {
        content: z.string(),
        session_id: z.string().optional(),
        running: z.boolean(),
        success: z.boolean(),
      },
    },
    async ({ session_id, message, model, variant, directory, timeout_seconds }) => {
      try {
        logger.info('Executing agent_send tool', { session_id, model });
        const result = await svc.send({
          sessionId: session_id,
          message,
          model,
          variant,
          directory,
          timeoutMs: timeout_seconds ? timeout_seconds * 1000 : undefined,
        });
        const text =
          `Message sent to ${session_id} · ${
            result.running ? 'running in background' : 'finished'
          }. Inspect with agent_thoughts / agent_status.`;
        return {
          content: createToolResult(true, text),
          structuredContent: {
            content: text,
            session_id: result.sessionId ?? session_id,
            running: result.running,
            success: true,
          },
        };
      } catch (error) {
        return toolError('agent_send', error);
      }
    }
  );

  // ---- agent_status ---------------------------------------------------------
  ctx.server.registerTool(
    'agent_status',
    {
      title: 'Agent Status (opencode)',
      description:
        'Check the status of agents. With no argument, lists all agents ' +
        'spawned in this session (running/finished + cost). With a session_id, ' +
        'reports that one (works for persisted sessions too).',
      inputSchema: {
        session_id: z
          .string()
          .optional()
          .describe('Specific session to report. Omit to list all.'),
      },
      outputSchema: {
        content: z.string(),
        agents: z.array(z.any()),
        success: z.boolean(),
      },
    },
    async ({ session_id }) => {
      try {
        logger.info('Executing agent_status tool', { session_id });
        const agents: AgentStatus[] = session_id
          ? [await svc.status(session_id)]
          : await svc.listAgents();
        const text = agents.length
          ? agents.map(fmtStatus).join('\n')
          : 'No agents spawned in this session yet.';
        return {
          content: createToolResult(true, text),
          structuredContent: { content: text, agents, success: true },
        };
      } catch (error) {
        return toolError('agent_status', error);
      }
    }
  );

  // ---- agent_thoughts -------------------------------------------------------
  ctx.server.registerTool(
    'agent_thoughts',
    {
      title: 'Agent Thought-Chain (opencode)',
      description:
        "Retrieve an agent's reasoning/action timeline for a session: its " +
        'thinking (reasoning) blocks, tool calls (with status), and assistant ' +
        'text, in order. Use to follow how the agent is working through a task.',
      inputSchema: {
        session_id: z.string().describe('The session to inspect.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Only return the last N steps (default: all).'),
        kinds: z
          .array(z.enum(['reasoning', 'text', 'tool']))
          .optional()
          .describe('Filter to certain step kinds (default: all).'),
      },
      outputSchema: {
        content: z.string(),
        steps: z.array(z.any()),
        success: z.boolean(),
      },
    },
    async ({ session_id, limit, kinds }) => {
      try {
        logger.info('Executing agent_thoughts tool', { session_id, limit });
        let steps: ThoughtStep[] = await svc.thoughts(session_id, limit ?? 0);
        if (kinds?.length) steps = steps.filter((s) => kinds.includes(s.kind));
        const text = steps.length
          ? steps
              .map((s) => {
                if (s.kind === 'tool')
                  return `🔧 [${s.tool}${
                    s.status ? `:${s.status}` : ''
                  }] ${s.text}`;
                if (s.kind === 'reasoning') return `💭 ${s.text}`;
                return `${s.role === 'user' ? '👤' : '🤖'} ${s.text}`;
              })
              .join('\n\n')
          : 'No steps found for this session.';
        return {
          content: createToolResult(true, text),
          structuredContent: { content: text, steps, success: true },
        };
      } catch (error) {
        return toolError('agent_thoughts', error);
      }
    }
  );

  // ---- agent_cost -----------------------------------------------------------
  ctx.server.registerTool(
    'agent_cost',
    {
      title: 'Agent Cost & Tokens (opencode)',
      description:
        'Report token usage and cost. With no argument, aggregates the cost of ' +
        'every agent spawned in this session, broken down by model — answering ' +
        '"which model has cost what so far". With a session_id, reports that ' +
        "session's breakdown. Cache read/write tokens show prompt-caching savings.",
      inputSchema: {
        session_id: z
          .string()
          .optional()
          .describe('Specific session. Omit for the by-model session total.'),
      },
      outputSchema: {
        content: z.string(),
        by_model: z.array(z.any()),
        session: z.any().optional(),
        success: z.boolean(),
      },
    },
    async ({ session_id }) => {
      try {
        logger.info('Executing agent_cost tool', { session_id });
        if (session_id) {
          const c = await svc.cost(session_id);
          const text = `Session ${session_id}\n  ${fmtCost(c)}`;
          return {
            content: createToolResult(true, text),
            structuredContent: {
              content: text,
              by_model: [],
              session: c,
              success: true,
            },
          };
        }
        const byModel: ModelCostSummary[] = await svc.sessionCostByModel();
        const total = byModel.reduce((s, m) => s + m.cost, 0);
        const text = byModel.length
          ? `Cost this session by model (total $${total.toFixed(4)}):\n\n` +
            byModel
              .map(
                (m) =>
                  `• ${m.model} — $${m.cost.toFixed(4)} over ${m.sessions} ` +
                  `session(s)\n    in ${m.inputTokens} / out ${m.outputTokens} / ` +
                  `reasoning ${m.reasoningTokens} · cache read ${m.cacheReadTokens} / write ${m.cacheWriteTokens}`
              )
              .join('\n')
          : 'No agent costs recorded in this session yet.';
        return {
          content: createToolResult(true, text),
          structuredContent: {
            content: text,
            by_model: byModel,
            success: true,
          },
        };
      } catch (error) {
        return toolError('agent_cost', error);
      }
    }
  );

  // ---- agent_models ---------------------------------------------------------
  ctx.server.registerTool(
    'agent_models',
    {
      title: 'List Agent Models (opencode)',
      description:
        'List the models opencode can run, optionally filtered by provider ' +
        '(e.g. "z-ai" for GLM). Includes cost metadata. Use the exact ' +
        '`provider/model` id as agent_spawn\'s `model`.',
      inputSchema: {
        provider: z
          .string()
          .optional()
          .describe('Provider id to filter by, e.g. "z-ai", "anthropic".'),
      },
      outputSchema: {
        content: z.string(),
        success: z.boolean(),
      },
    },
    async ({ provider }) => {
      try {
        logger.info('Executing agent_models tool', { provider });
        const text = await svc.listModels(provider);
        return {
          content: createToolResult(true, text || '(no models listed)'),
          structuredContent: { content: text, success: true },
        };
      } catch (error) {
        return toolError('agent_models', error);
      }
    }
  );

  // ---- agent_stop -----------------------------------------------------------
  ctx.server.registerTool(
    'agent_stop',
    {
      title: 'Stop Agent (opencode)',
      description:
        'Stop a running background agent by session_id (terminates its ' +
        'process). The session and its transcript remain queryable.',
      inputSchema: {
        session_id: z.string().describe('The session to stop.'),
      },
      outputSchema: {
        content: z.string(),
        stopped: z.boolean(),
        success: z.boolean(),
      },
    },
    async ({ session_id }) => {
      try {
        logger.info('Executing agent_stop tool', { session_id });
        const stopped = await svc.stop(session_id);
        const text = stopped
          ? `Stopped agent ${session_id}.`
          : `Could not stop ${session_id} — it may have already finished or ` +
            'was not spawned in this session.';
        return {
          content: createToolResult(true, text),
          structuredContent: { content: text, stopped, success: true },
        };
      } catch (error) {
        return toolError('agent_stop', error);
      }
    }
  );
}
