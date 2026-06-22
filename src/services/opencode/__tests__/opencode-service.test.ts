import { OpencodeService } from '../index.js';
import type { SessionCost } from '../types.js';

describe('OpencodeService.buildRunArgs', () => {
  it('builds a minimal run invocation', () => {
    expect(OpencodeService.buildRunArgs({ prompt: 'do it' })).toEqual(['run', 'do it']);
  });

  it('includes model, variant, agent and title', () => {
    const args = OpencodeService.buildRunArgs({
      prompt: 'do it',
      model: 'openrouter/z-ai/glm-5.2',
      variant: 'high',
      agent: 'build',
      title: 'mcp-abc',
    });
    expect(args).toContain('--model');
    expect(args).toContain('openrouter/z-ai/glm-5.2');
    expect(args).toContain('--variant');
    expect(args).toContain('high');
    expect(args).toContain('--agent');
    expect(args).toContain('build');
    expect(args).toContain('--title');
    expect(args).toContain('mcp-abc');
    // prompt is always last
    expect(args[args.length - 1]).toBe('do it');
  });

  it('resumes a session with --session', () => {
    const args = OpencodeService.buildRunArgs({ prompt: 'more', sessionId: 'ses_abc' });
    expect(args).toContain('--session');
    expect(args).toContain('ses_abc');
    expect(args[args.length - 1]).toBe('more');
  });
});

describe('OpencodeService.parseServerUrl', () => {
  it('extracts the listening url from serve output', () => {
    const log =
      'Warning: ...\nopencode server listening on http://127.0.0.1:47891\n';
    expect(OpencodeService.parseServerUrl(log)).toBe('http://127.0.0.1:47891');
  });

  it('returns undefined when no url present', () => {
    expect(OpencodeService.parseServerUrl('booting...')).toBeUndefined();
  });
});

describe('OpencodeService.parseSessionCost', () => {
  // Shape returned by GET /api/session/{id} (data) — same as export's info.
  const info = {
    id: 'ses_x',
    model: { providerID: 'openrouter', id: 'z-ai/glm-5.2', variant: 'high' },
    cost: 0.5035026,
    tokens: {
      input: 222928,
      output: 2122,
      reasoning: 7977,
      cache: { read: 521464, write: 12 },
    },
    time: { updated: 1781700287162 },
  };

  it('maps session info into a SessionCost', () => {
    const c = OpencodeService.parseSessionCost(info)!;
    expect(c.sessionId).toBe('ses_x');
    expect(c.model).toBe('openrouter/z-ai/glm-5.2');
    expect(c.cost).toBeCloseTo(0.5035026);
    expect(c.inputTokens).toBe(222928);
    expect(c.outputTokens).toBe(2122);
    expect(c.reasoningTokens).toBe(7977);
    expect(c.cacheReadTokens).toBe(521464);
    expect(c.cacheWriteTokens).toBe(12);
    expect(c.updated).toBe(1781700287162);
  });

  it('returns undefined for non-object input', () => {
    expect(OpencodeService.parseSessionCost(null)).toBeUndefined();
  });
});

describe('OpencodeService.aggregateCostByModel', () => {
  it('sums cost and tokens per model and sorts by cost', () => {
    const costs: SessionCost[] = [
      mkCost('s1', 'openrouter/z-ai/glm-5.2', 0.2, 100),
      mkCost('s2', 'openrouter/z-ai/glm-5.2', 0.3, 200),
      mkCost('s3', 'anthropic/claude', 1.0, 5),
    ];
    const agg = OpencodeService.aggregateCostByModel(costs);
    expect(agg).toHaveLength(2);
    expect(agg[0].model).toBe('anthropic/claude'); // highest cost first
    const glm = agg.find((m) => m.model === 'openrouter/z-ai/glm-5.2')!;
    expect(glm.cost).toBeCloseTo(0.5);
    expect(glm.inputTokens).toBe(300);
    expect(glm.sessions).toBe(2);
  });
});

describe('OpencodeService.parseThoughts', () => {
  // Shape from GET /session/{id}/message and `opencode export`.messages.
  const messages = [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'do the thing' }] },
    {
      info: { role: 'assistant' },
      parts: [
        { type: 'reasoning', text: 'let me think' },
        { type: 'step-start' },
        {
          type: 'tool',
          tool: 'glob',
          state: { status: 'completed', title: 'glob **/*.ts' },
        },
        { type: 'text', text: 'here is the answer' },
      ],
    },
  ];

  it('builds an ordered reasoning/tool/text timeline', () => {
    const steps = OpencodeService.parseThoughts(messages);
    expect(steps.map((s) => s.kind)).toEqual(['text', 'reasoning', 'tool', 'text']);
    const tool = steps.find((s) => s.kind === 'tool')!;
    expect(tool.tool).toBe('glob');
    expect(tool.status).toBe('completed');
    expect(tool.text).toBe('glob **/*.ts');
  });

  it('honours the limit (last N steps)', () => {
    const steps = OpencodeService.parseThoughts(messages, 1);
    expect(steps).toHaveLength(1);
    expect(steps[0].text).toBe('here is the answer');
  });
});

function mkCost(
  sessionId: string,
  model: string,
  cost: number,
  inputTokens: number
): SessionCost {
  return {
    sessionId,
    model,
    cost,
    inputTokens,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    updated: 0,
  };
}
