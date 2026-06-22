import { AgyService } from '../index.js';
import type { AgyConfig } from '../../../config/types.js';
import type { AgyLaunchOptions } from '../types.js';

const LOG = '/tmp/run.log';

const baseOpts: AgyLaunchOptions = { prompt: 'do the thing' };

describe('AgyService.buildArgs', () => {
  it('builds a minimal print invocation', () => {
    const args = AgyService.buildArgs(baseOpts, LOG);
    expect(args).toEqual(['--log-file', LOG, '--print', 'do the thing']);
  });

  it('includes model, sandbox and auto-approve flags', () => {
    const args = AgyService.buildArgs(
      { ...baseOpts, model: 'Gemini 3.1 Pro (High)', sandbox: true, autoApprove: true },
      LOG
    );
    expect(args).toContain('--model');
    expect(args).toContain('Gemini 3.1 Pro (High)');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--sandbox');
  });

  it('omits auto-approve and sandbox when not requested', () => {
    const args = AgyService.buildArgs(baseOpts, LOG);
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--sandbox');
  });

  it('adds every workspace directory via --add-dir', () => {
    const args = AgyService.buildArgs(
      { ...baseOpts, addDirectories: ['/a', '/b'] },
      LOG
    );
    expect(args.filter((a) => a === '--add-dir')).toHaveLength(2);
    expect(args).toContain('/a');
    expect(args).toContain('/b');
  });

  it('prefers conversationId over continueRecent', () => {
    const args = AgyService.buildArgs(
      { ...baseOpts, conversationId: 'abc-123', continueRecent: true },
      LOG
    );
    expect(args).toContain('--conversation');
    expect(args).toContain('abc-123');
    expect(args).not.toContain('--continue');
  });

  it('uses --continue when only continueRecent is set', () => {
    const args = AgyService.buildArgs(
      { ...baseOpts, continueRecent: true },
      LOG
    );
    expect(args).toContain('--continue');
    expect(args).not.toContain('--conversation');
  });

  it('converts timeoutMs into a Go-style print-timeout in seconds', () => {
    const args = AgyService.buildArgs({ ...baseOpts, timeoutMs: 90_000 }, LOG);
    const i = args.indexOf('--print-timeout');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('90s');
  });

  it('passes the prompt as the value of --print, last', () => {
    const args = AgyService.buildArgs(baseOpts, LOG);
    expect(args[args.length - 2]).toBe('--print');
    expect(args[args.length - 1]).toBe('do the thing');
  });
});

describe('AgyService.parseConversationId', () => {
  it('extracts the id from a "Stream completed for" line', () => {
    const log = [
      'I0622 06:28:34 http_helpers.go:198] URL: https://x ResponseID: abc',
      'I0622 06:28:34 conversation_manager.go:601] Stream completed for 212bb104-fa7f-4b91-a7b3-ac5baf361528, clearing ResponsePending',
    ].join('\n');
    expect(AgyService.parseConversationId(log)).toBe(
      '212bb104-fa7f-4b91-a7b3-ac5baf361528'
    );
  });

  it('falls back to any UUID when no conversation line exists', () => {
    const log = 'random line 11111111-2222-3333-4444-555555555555 trailing';
    expect(AgyService.parseConversationId(log)).toBe(
      '11111111-2222-3333-4444-555555555555'
    );
  });

  it('returns undefined when there is no UUID', () => {
    expect(AgyService.parseConversationId('no ids here')).toBeUndefined();
  });
});

describe('AgyService.launchAgent error handling', () => {
  const cfg: AgyConfig = {
    binary: '/nonexistent/agy-binary-xyz',
    defaultTimeoutMs: 5_000,
    autoApprove: true,
  };

  it('rejects with a helpful message when the binary cannot be spawned', async () => {
    const svc = new AgyService(cfg);
    await expect(svc.launchAgent({ prompt: 'hi' })).rejects.toThrow(/agy/i);
  });
});
