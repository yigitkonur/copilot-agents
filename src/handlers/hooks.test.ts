import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionHooks, createAutoUserInputHandler } from './hooks.js';
import type { Logger } from '../utils/logger.js';

function createMockLogger(): Logger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
  };
}

// simplified invocation mock — `as never` bypasses the SDK's full invocation type
const mockInvocation = { sessionId: 'test-session-123' } as never;

describe('createSessionHooks', () => {
  it('returns object with all expected hook properties', () => {
    const hooks = createSessionHooks({ logger: createMockLogger(), verbose: false });
    expect(hooks).toHaveProperty('onPreToolUse');
    expect(hooks).toHaveProperty('onPostToolUse');
    expect(hooks).toHaveProperty('onSessionStart');
    expect(hooks).toHaveProperty('onSessionEnd');
    expect(hooks).toHaveProperty('onErrorOccurred');
    expect(hooks).toHaveProperty('onUserPromptSubmitted');
  });
});

describe('onPreToolUse', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns { permissionDecision: "allow" }', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onPreToolUse!({ toolName: 'read_file', toolArgs: {} } as never, mockInvocation);
    expect(result).toEqual({ permissionDecision: 'allow' });
  });

  it('logs tool name when verbose=true', async () => {
    const hooks = createSessionHooks({ logger, verbose: true });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPreToolUse!({ toolName: 'read_file', toolArgs: {} } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('read_file'));
  });

  it('does NOT log when verbose=false', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPreToolUse!({ toolName: 'read_file', toolArgs: {} } as never, mockInvocation);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('denies blocked tools', async () => {
    const hooks = createSessionHooks({ logger, verbose: false, blockedTools: ['dangerous_tool'] });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onPreToolUse!({ toolName: 'dangerous_tool', toolArgs: {} } as never, mockInvocation);
    expect(result).toEqual({ permissionDecision: 'deny' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dangerous_tool'));
  });

  it('allows non-blocked tools when blockedTools is set', async () => {
    const hooks = createSessionHooks({ logger, verbose: false, blockedTools: ['dangerous_tool'] });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onPreToolUse!({ toolName: 'safe_tool', toolArgs: {} } as never, mockInvocation);
    expect(result).toEqual({ permissionDecision: 'allow' });
  });
});

describe('onPostToolUse', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns undefined', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onPostToolUse!({
      toolName: 'write_file',
      toolResult: { resultType: 'success' },
    } as never, mockInvocation);
    expect(result).toBeUndefined();
  });

  it('logs success status when verbose=true', async () => {
    const hooks = createSessionHooks({ logger, verbose: true });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPostToolUse!({
      toolName: 'write_file',
      toolResult: { resultType: 'success' },
    } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('✓'));
  });

  it('logs failure status when verbose=true', async () => {
    const hooks = createSessionHooks({ logger, verbose: true });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPostToolUse!({
      toolName: 'write_file',
      toolResult: { resultType: 'failure', error: 'disk full' },
    } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('✗'));
  });

  it('logs error details on failure', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPostToolUse!({
      toolName: 'write_file',
      toolResult: { resultType: 'failure', error: 'disk full' },
    } as never, mockInvocation);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('warns on rejected/denied results', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPostToolUse!({
      toolName: 'exec',
      toolResult: { resultType: 'denied' },
    } as never, mockInvocation);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('denied'));
  });

  it('does NOT log debug when verbose=false', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onPostToolUse!({
      toolName: 'write_file',
      toolResult: { resultType: 'success' },
    } as never, mockInvocation);
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe('onUserPromptSubmitted', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns undefined without transform', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onUserPromptSubmitted!({ prompt: 'hello' } as never, mockInvocation);
    expect(result).toBeUndefined();
  });

  it('logs prompt length when verbose', async () => {
    const hooks = createSessionHooks({ logger, verbose: true });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onUserPromptSubmitted!({ prompt: 'hello world' } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('11 chars'));
  });

  it('applies promptTransform when provided', async () => {
    const transform = (p: string) => `[PREFIX] ${p}`;
    const hooks = createSessionHooks({ logger, verbose: false, promptTransform: transform });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onUserPromptSubmitted!({ prompt: 'hello' } as never, mockInvocation);
    expect(result).toEqual({ modifiedPrompt: '[PREFIX] hello' });
  });
});

describe('onSessionStart', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns undefined', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onSessionStart!({ source: 'new' } as never, mockInvocation);
    expect(result).toBeUndefined();
  });

  it('logs session source and id', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onSessionStart!({ source: 'resume' } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('resume'));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('test-session-123'));
  });
});

describe('onSessionEnd', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns sessionSummary from finalMessage', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onSessionEnd!({
      reason: 'complete',
      finalMessage: 'All done!',
    } as never, mockInvocation);
    expect(result).toEqual({ sessionSummary: 'All done!' });
  });

  it('logs error when reason=error', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onSessionEnd!({
      reason: 'error',
      error: 'something failed',
      finalMessage: undefined,
    } as never, mockInvocation);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  it('logs debug when reason is not error', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onSessionEnd!({
      reason: 'complete',
      finalMessage: 'done',
    } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('complete'));
  });
});

describe('onErrorOccurred', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns retry for recoverable model_call errors', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onErrorOccurred!({
      error: 'rate limit',
      errorContext: 'model_call',
      recoverable: true,
    } as never, mockInvocation);
    expect(result).toMatchObject({ errorHandling: 'retry' });
  });

  it('returns skip for tool_execution errors', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onErrorOccurred!({
      error: 'tool broke',
      errorContext: 'tool_execution',
      recoverable: false,
    } as never, mockInvocation);
    expect(result).toEqual({ errorHandling: 'skip' });
  });

  it('returns abort for other errors', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onErrorOccurred!({
      error: 'system crash',
      errorContext: 'system',
      recoverable: false,
    } as never, mockInvocation);
    expect(result).toMatchObject({ errorHandling: 'abort' });
  });

  it('always logs the error', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onErrorOccurred!({
      error: 'some error',
      errorContext: 'model_call',
      recoverable: false,
    } as never, mockInvocation);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('some error'));
  });

  it('uses errorStrategy override when provided', async () => {
    const hooks = createSessionHooks({ logger, verbose: false, errorStrategy: 'skip' });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await hooks.onErrorOccurred!({
      error: 'rate limit',
      errorContext: 'model_call',
      recoverable: true,
    } as never, mockInvocation);
    expect(result).toEqual({ errorHandling: 'skip' });
  });

  it('logs recoverability', async () => {
    const hooks = createSessionHooks({ logger, verbose: false });
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    await hooks.onErrorOccurred!({
      error: 'err',
      errorContext: 'system',
      recoverable: false,
    } as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('false'));
  });
});

describe('createAutoUserInputHandler', () => {
  it('returns first choice when choices provided', async () => {
    const handler = createAutoUserInputHandler();
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await handler({ choices: ['option-a', 'option-b'] } as never, mockInvocation);
    expect(result.answer).toBe('option-a');
  });

  it('returns "Yes, proceed" when no choices', async () => {
    const handler = createAutoUserInputHandler();
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await handler({} as never, mockInvocation);
    expect(result.answer).toBe('Yes, proceed');
  });

  it('sets wasFreeform=false for choice selection', async () => {
    const handler = createAutoUserInputHandler();
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await handler({ choices: ['a'] } as never, mockInvocation);
    expect(result.wasFreeform).toBe(false);
  });

  it('sets wasFreeform=true for freeform response', async () => {
    const handler = createAutoUserInputHandler();
    // `as never` — simplified hook arg mock bypasses the SDK's full type
    const result = await handler({} as never, mockInvocation);
    expect(result.wasFreeform).toBe(true);
  });
});
