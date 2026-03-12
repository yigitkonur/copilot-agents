import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthError,
  ConnectionError,
  TimeoutError,
  PromptError,
  SessionError,
  toAppError,
  wrapAsync,
} from './errors.js';
import { ExitCode } from './types.js';

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('has correct name, message, code, and exitCode', () => {
    const err = new AppError('boom', 'TEST_CODE', ExitCode.GeneralError);
    expect(err.name).toBe('AppError');
    expect(err.message).toBe('boom');
    expect(err.code).toBe('TEST_CODE');
    expect(err.exitCode).toBe(ExitCode.GeneralError);
  });

  it('is instanceof Error', () => {
    const err = new AppError('boom', 'X', ExitCode.GeneralError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct prototype chain', () => {
    const err = new AppError('boom', 'X', ExitCode.GeneralError);
    expect(Object.getPrototypeOf(err)).toBe(AppError.prototype);
  });
});

// ---------------------------------------------------------------------------
// Domain error subclasses
// ---------------------------------------------------------------------------

describe.each([
  {
    Cls: AuthError,
    expectedName: 'AuthError',
    defaultCode: 'AUTH_FAILED',
    exitCode: ExitCode.AuthError,
  },
  {
    Cls: ConnectionError,
    expectedName: 'ConnectionError',
    defaultCode: 'CONNECTION_FAILED',
    exitCode: ExitCode.ConnectionError,
  },
  {
    Cls: TimeoutError,
    expectedName: 'TimeoutError',
    defaultCode: 'TIMEOUT',
    exitCode: ExitCode.TimeoutError,
  },
  {
    Cls: PromptError,
    expectedName: 'PromptError',
    defaultCode: 'PROMPT_INVALID',
    exitCode: ExitCode.PromptError,
  },
  {
    Cls: SessionError,
    expectedName: 'SessionError',
    defaultCode: 'SESSION_FAILED',
    exitCode: ExitCode.SessionError,
  },
] as const)('$expectedName', ({ Cls, expectedName, defaultCode, exitCode }) => {
  it('has correct default code', () => {
    const err = new Cls('msg');
    expect(err.code).toBe(defaultCode);
  });

  it('has correct exitCode', () => {
    const err = new Cls('msg');
    expect(err.exitCode).toBe(exitCode);
  });

  it('is instanceof AppError and Error', () => {
    const err = new Cls('msg');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('supports custom code override', () => {
    const err = new Cls('msg', 'CUSTOM_CODE');
    expect(err.code).toBe('CUSTOM_CODE');
  });

  it('has correct .name property', () => {
    const err = new Cls('msg');
    expect(err.name).toBe(expectedName);
  });
});

// ---------------------------------------------------------------------------
// toAppError
// ---------------------------------------------------------------------------

describe('toAppError', () => {
  it('returns same AppError if given an AppError', () => {
    const original = new AppError('test', 'X', ExitCode.GeneralError);
    expect(toAppError(original)).toBe(original);
  });

  it('wraps standard Error with GeneralError exit code', () => {
    const original = new Error('standard');
    const wrapped = toAppError(original);
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.message).toBe('standard');
    expect(wrapped.exitCode).toBe(ExitCode.GeneralError);
    expect(wrapped.code).toBe('UNKNOWN_ERROR');
  });

  it('preserves stack trace from original Error', () => {
    const original = new Error('traced');
    const wrapped = toAppError(original);
    expect(wrapped.stack).toBe(original.stack);
  });

  it('handles string input', () => {
    const wrapped = toAppError('oops');
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.message).toBe('oops');
  });

  it('handles number input', () => {
    const wrapped = toAppError(42);
    expect(wrapped.message).toBe('42');
  });

  it('handles undefined input', () => {
    const wrapped = toAppError(undefined);
    expect(wrapped.message).toBe('undefined');
  });

  it('handles null input', () => {
    const wrapped = toAppError(null);
    expect(wrapped.message).toBe('null');
  });

  it('handles object without message', () => {
    const wrapped = toAppError({ foo: 'bar' });
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.message).toBe('[object Object]');
  });
});

// ---------------------------------------------------------------------------
// wrapAsync
// ---------------------------------------------------------------------------

describe('wrapAsync', () => {
  it('returns success result for resolved promises', async () => {
    const result = await wrapAsync(() => Promise.resolve(42));
    expect(result).toEqual({ success: true, data: 42 });
  });

  it('returns failure result for rejected promises', async () => {
    const result = await wrapAsync(() => Promise.reject(new Error('fail')));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AppError);
      expect(result.error.message).toBe('fail');
    }
  });

  it('wraps non-Error rejections (string throw)', async () => {
    const result = await wrapAsync(() => Promise.reject('string-error'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(AppError);
      expect(result.error.message).toBe('string-error');
    }
  });

  it('works with async functions returning complex objects', async () => {
    const complex = { nested: { value: [1, 2, 3] }, ok: true };
    const result = await wrapAsync(async () => complex);
    expect(result).toEqual({ success: true, data: complex });
  });

  it('preserves AppError in rejection as-is', async () => {
    const original = new AuthError('auth failed');
    const result = await wrapAsync(() => Promise.reject(original));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(original);
    }
  });
});
