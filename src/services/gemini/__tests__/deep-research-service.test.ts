import { DeepResearchService } from '../deep-research-service.js';

type Resp = { ok?: boolean; statusText?: string; body: any };

function mockFetchSequence(responses: Resp[]) {
  let i = 0;
  return jest.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok ?? true,
      statusText: r.statusText ?? 'OK',
      json: async () => r.body,
    } as any;
  });
}

const userStep = { type: 'user_input', content: [{ type: 'text', text: 'q' }] };

describe('DeepResearchService.research', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('creates, polls until completed, and extracts the report + sources', async () => {
    const created = { id: 'abc', status: 'in_progress', steps: [userStep] };
    const inprog = { id: 'abc', status: 'in_progress', steps: [userStep] };
    const done = {
      id: 'abc',
      status: 'completed',
      steps: [
        userStep,
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: '# Report\nSee https://example.com/a and https://example.com/b.',
            },
          ],
        },
      ],
    };
    global.fetch = mockFetchSequence([
      { body: created }, // POST create
      { body: inprog }, // GET poll 1
      { body: done }, // GET poll 2
    ]) as any;

    const svc = new DeepResearchService('KEY', 'deep-research-pro-preview-12-2025');
    const res = await svc.research({ question: 'q', pollIntervalMs: 1, timeoutMs: 60_000 });

    expect(res.status).toBe('completed');
    expect(res.timedOut).toBe(false);
    expect(res.report).toContain('# Report');
    expect(res.interactionId).toBe('abc');
    expect(res.sources).toEqual(
      expect.arrayContaining(['https://example.com/a', 'https://example.com/b'])
    );
  });

  it('throws when no API key is configured', async () => {
    const svc = new DeepResearchService(undefined, 'agent');
    await expect(svc.research({ question: 'q' })).rejects.toThrow(/API key/i);
  });

  it('reports a timeout when the interaction never completes', async () => {
    global.fetch = mockFetchSequence([
      { body: { id: 'x', status: 'in_progress', steps: [userStep] } },
    ]) as any;

    const svc = new DeepResearchService('KEY', 'agent');
    const res = await svc.research({ question: 'q', pollIntervalMs: 1, timeoutMs: 5 });

    expect(res.timedOut).toBe(true);
    expect(res.status).toBe('timeout');
  });

  it('throws when the interaction ends in a non-completed state', async () => {
    global.fetch = mockFetchSequence([
      { body: { id: 'x', status: 'in_progress', steps: [userStep] } },
      {
        body: {
          id: 'x',
          status: 'failed',
          steps: [
            { type: 'model_output', content: [{ type: 'text', text: 'boom' }] },
          ],
        },
      },
    ]) as any;

    const svc = new DeepResearchService('KEY', 'agent');
    await expect(
      svc.research({ question: 'q', pollIntervalMs: 1, timeoutMs: 60_000 })
    ).rejects.toThrow(/failed/i);
  });

  it('surfaces a helpful error when interaction creation fails', async () => {
    global.fetch = mockFetchSequence([
      { ok: false, statusText: 'Bad Request', body: { error: { message: 'nope' } } },
    ]) as any;

    const svc = new DeepResearchService('KEY', 'agent');
    await expect(svc.research({ question: 'q', pollIntervalMs: 1 })).rejects.toThrow(/nope/);
  });
});
