import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createStreamingEventHandler,
  createQuietEventHandler,
  createProgressEventHandler,
} from './events.js';
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

// simplified event mock — `as never` bypasses the SDK's full event discriminated union type
function makeEvent(type: string, data: Record<string, unknown> = {}) {
  return { type, data } as never;
}

describe('createStreamingEventHandler', () => {
  let logger: Logger;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = createMockLogger();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('writes delta content to stdout on assistant.message_delta', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('assistant.message_delta', { deltaContent: 'Hello' }));
    expect(stdoutSpy).toHaveBeenCalledWith('Hello');
  });

  it('logs reasoning delta in debug mode', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('assistant.reasoning_delta', { deltaContent: 'thinking...' }));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('thinking...'));
  });

  it('logs tool execution start with tool name', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('tool.execution_start', { toolName: 'read_file' }));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('read_file'));
  });

  it('logs tool failure warning on execution_complete with success=false', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('tool.execution_complete', { success: false, toolCallId: 'tc-1' }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('tc-1'));
  });

  it('logs session error', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('session.error', { message: 'something broke' }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('something broke'));
  });

  it('writes newline on session.idle when content was written', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('assistant.message_delta', { deltaContent: 'hi' }));
    handler(makeEvent('session.idle'));
    expect(stdoutSpy).toHaveBeenCalledWith('\n');
  });

  it('does not write newline on session.idle when no content was written', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('session.idle'));
    expect(stdoutSpy).not.toHaveBeenCalledWith('\n');
  });

  it('logs subagent started', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('subagent.started', { agentName: 'coder' }));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('coder'));
  });

  it('logs subagent completed', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('subagent.completed', { agentDisplayName: 'Coder Agent' }));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Coder Agent'));
  });

  it('logs subagent failed', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('subagent.failed', { agentName: 'coder', error: 'timeout' }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('coder'));
  });

  it('no-ops on unknown event types', () => {
    const handler = createStreamingEventHandler(logger);
    handler(makeEvent('unknown.event', { data: 'irrelevant' }));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe('createQuietEventHandler', () => {
  let logger: Logger;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = createMockLogger();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('logs session.error', () => {
    const handler = createQuietEventHandler(logger);
    handler(makeEvent('session.error', { message: 'crash' }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('crash'));
  });

  it('does NOT log tool events', () => {
    const handler = createQuietEventHandler(logger);
    handler(makeEvent('tool.execution_start', { toolName: 'read' }));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('does NOT write assistant content', () => {
    const handler = createQuietEventHandler(logger);
    handler(makeEvent('assistant.message_delta', { deltaContent: 'hello' }));
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('ignores all other event types', () => {
    const handler = createQuietEventHandler(logger);
    handler(makeEvent('subagent.started', { agentName: 'x' }));
    handler(makeEvent('session.idle'));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe('createProgressEventHandler', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('tags log messages with taskId', () => {
    const handler = createProgressEventHandler('task-42', logger);
    handler(makeEvent('tool.execution_start', { toolName: 'grep' }));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('task-42'));
  });

  it('logs tool.execution_start in debug', () => {
    const handler = createProgressEventHandler('t1', logger);
    handler(makeEvent('tool.execution_start', { toolName: 'write_file' }));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('write_file'));
  });

  it('logs session.error', () => {
    const handler = createProgressEventHandler('t1', logger);
    handler(makeEvent('session.error', { message: 'fatal' }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('fatal'));
  });

  it('ignores non-tracked events', () => {
    const handler = createProgressEventHandler('t1', logger);
    handler(makeEvent('assistant.message_delta', { deltaContent: 'hi' }));
    handler(makeEvent('assistant.reasoning_delta', { deltaContent: 'thinking' }));
    // subagent.started IS now handled by the progress handler, so we test a truly ignored event
    expect(logger.error).not.toHaveBeenCalled();
  });
});
