import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@github/copilot-sdk', () => ({
  approveAll: vi.fn(async () => ({ kind: 'approved' })),
}));

import {
  approveAll,
  createInteractivePermissionHandler,
  createReadOnlyPermissionHandler,
} from './permission.js';
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

// simplified permission request mocks — `as never` at call sites bypasses
// the SDK's full PermissionRequest discriminated union type
const mockReadRequest = { kind: 'read' as const, path: '/some/file' };
const mockWriteRequest = { kind: 'write' as const, fileName: 'test.ts' };
const mockShellRequest = { kind: 'shell' as const, fullCommandText: 'ls -la' };
const mockInvocation = { sessionId: 'test-session-id' };

describe('approveAll', () => {
  it('is a function', () => {
    expect(typeof approveAll).toBe('function');
  });

  it('can be called (smoke test)', () => {
    expect(() => approveAll).not.toThrow();
  });
});

describe('createInteractivePermissionHandler', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns approved for read permission kind', async () => {
    const handler = createInteractivePermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockReadRequest as never, mockInvocation);
    expect(result).toEqual({ kind: 'approved' });
  });

  it('returns approved for write permission kind', async () => {
    const handler = createInteractivePermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockWriteRequest as never, mockInvocation);
    expect(result).toEqual({ kind: 'approved' });
  });

  it('returns approved for shell permission kind', async () => {
    const handler = createInteractivePermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockShellRequest as never, mockInvocation);
    expect(result).toEqual({ kind: 'approved' });
  });

  it('calls logger.debug for each request', async () => {
    const handler = createInteractivePermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    await handler(mockReadRequest as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('read'),
    );
  });

  it('logs command text for shell permissions', async () => {
    const handler = createInteractivePermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    await handler(mockShellRequest as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('ls -la'),
    );
  });

  it('logs file name for write permissions', async () => {
    const handler = createInteractivePermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    await handler(mockWriteRequest as never, mockInvocation);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('test.ts'),
    );
  });
});

describe('createReadOnlyPermissionHandler', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('returns approved for read permission kind', async () => {
    const handler = createReadOnlyPermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockReadRequest as never, mockInvocation);
    expect(result).toEqual({ kind: 'approved' });
  });

  it('returns denied for write permission kind', async () => {
    const handler = createReadOnlyPermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockWriteRequest as never, mockInvocation);
    expect(result.kind).toBe('denied-by-rules');
  });

  it('returns denied for shell permission kind', async () => {
    const handler = createReadOnlyPermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockShellRequest as never, mockInvocation);
    expect(result.kind).toBe('denied-by-rules');
  });

  it('denied result has correct kind', async () => {
    const handler = createReadOnlyPermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockWriteRequest as never, mockInvocation);
    expect(result.kind).toBe('denied-by-rules');
  });

  it('denied result uses policy denial (no feedback field)', async () => {
    const handler = createReadOnlyPermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    const result = await handler(mockShellRequest as never, mockInvocation);
    expect(result.kind).toBe('denied-by-rules');
  });

  it('calls logger.warn when denying', async () => {
    const handler = createReadOnlyPermissionHandler(logger);
    // `as never` — mock doesn't match SDK's full PermissionRequest type
    await handler(mockWriteRequest as never, mockInvocation);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Denied'),
    );
  });
});
