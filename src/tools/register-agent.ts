import * as z from 'zod';
import logger from '../utils/logger.js';
import { createToolResult } from '../utils/error-handler.js';
import { toolError } from '../utils/tool-wrapper.js';
import type { ToolContext } from './types.js';

export function register(ctx: ToolContext): void {
  ctx.server.registerTool(
    'gemini_agent',
    {
      title: 'Launch Gemini Agent',
      description:
        'Delegate a task to an autonomous Gemini agent (via the `agy` CLI). ' +
        'Unlike gemini_chat (a single text response), the agent can read and ' +
        'edit files and run shell commands inside a working directory to ' +
        'actually carry out multi-step work, then returns its final report. ' +
        'Use it to offload self-contained coding/research/automation tasks. ' +
        'Returns a conversation_id you can pass back to continue iterating ' +
        'with the same agent. Pick a "Flash" model for speed, a "Pro" model ' +
        'for harder reasoning (see gemini_agent_models).',
      inputSchema: {
        task: z
          .string()
          .describe(
            'The instructions for the agent. Be explicit and self-contained: ' +
              'state the goal, relevant files/paths, constraints, and what a ' +
              'finished result looks like — the agent runs without further input.'
          ),
        model: z
          .string()
          .optional()
          .describe(
            'Agent model label exactly as listed by gemini_agent_models, ' +
              'e.g. "Gemini 3.1 Pro (High)" or "Gemini 3.5 Flash (Low)". ' +
              'Defaults to agy\'s configured model.'
          ),
        directory: z
          .string()
          .optional()
          .describe(
            'Absolute path of the primary working directory the agent runs in. ' +
              'Defaults to the MCP server working directory.'
          ),
        add_directories: z
          .array(z.string())
          .optional()
          .describe('Additional absolute paths to grant the agent access to.'),
        conversation_id: z
          .string()
          .optional()
          .describe(
            'Resume a previous agent run by its conversation_id to keep its ' +
              'context and continue iterating.'
          ),
        continue_recent: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Continue the most recent agy conversation. Ignored when ' +
              'conversation_id is provided.'
          ),
        auto_approve: z
          .boolean()
          .optional()
          .describe(
            'Auto-approve the agent\'s tool/permission requests so it can work ' +
              'unattended. Defaults to true (set GEMINI_AGY_AUTO_APPROVE=false ' +
              'to change the default). Without it the agent stalls on prompts.'
          ),
        sandbox: z
          .boolean()
          .optional()
          .default(false)
          .describe('Run the agent in agy\'s restricted sandbox.'),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .optional()
          .describe(
            'Hard time budget for the run. Agent runs can be slow, especially ' +
              'with Pro/High models. Defaults to the configured agy timeout.'
          ),
      },
      outputSchema: {
        content: z.string(),
        conversation_id: z.string().optional(),
        timed_out: z.boolean(),
        success: z.boolean(),
      },
    },
    async ({
      task,
      model,
      directory,
      add_directories,
      conversation_id,
      continue_recent,
      auto_approve,
      sandbox,
      timeout_seconds,
    }) => {
      try {
        logger.info('Executing gemini_agent tool', {
          model,
          directory,
          conversation_id,
          taskLength: task.length,
        });

        const result = await ctx.agyService.launchAgent({
          prompt: task,
          model,
          directory,
          addDirectories: add_directories,
          conversationId: conversation_id,
          continueRecent: continue_recent,
          autoApprove: auto_approve,
          sandbox,
          timeoutMs: timeout_seconds ? timeout_seconds * 1000 : undefined,
        });

        const seconds = (result.durationMs / 1000).toFixed(1);
        let text = result.output || '(agent produced no output)';

        const footer: string[] = [];
        if (result.timedOut) {
          footer.push(
            '⚠️ The agent run hit the timeout and was stopped — the output above ' +
              'may be incomplete. Increase timeout_seconds or continue via conversation_id.'
          );
        }
        if (result.conversationId) {
          footer.push(`conversation_id: ${result.conversationId} (pass back to continue)`);
        }
        footer.push(`model: ${result.model ?? 'default'} · ${seconds}s`);
        text += `\n\n---\n${footer.join('\n')}`;

        return {
          content: createToolResult(true, text),
          structuredContent: {
            content: text,
            conversation_id: result.conversationId,
            timed_out: result.timedOut,
            success: true,
          },
        };
      } catch (error) {
        return toolError('gemini_agent', error);
      }
    }
  );

  ctx.server.registerTool(
    'gemini_agent_models',
    {
      title: 'List Gemini Agent Models',
      description:
        'List the model labels available to the Gemini agent (gemini_agent). ' +
        'These come from `agy models` and differ from the API models in ' +
        'gemini_list_models — use the exact label as the agent\'s "model".',
      inputSchema: {},
      outputSchema: {
        content: z.string(),
        models: z.array(z.string()),
        success: z.boolean(),
      },
    },
    async () => {
      try {
        logger.info('Executing gemini_agent_models tool');
        const models = await ctx.agyService.listModels();
        const text =
          'Available Gemini agent models (use the exact label):\n\n' +
          models.map((m) => `• ${m}`).join('\n');
        return {
          content: createToolResult(true, text),
          structuredContent: { content: text, models, success: true },
        };
      } catch (error) {
        return toolError('gemini_agent_models', error);
      }
    }
  );
}
