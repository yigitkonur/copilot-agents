import { describe, it, expect } from 'vitest';
import {
  toNonEmptyString,
  toSessionId,
  toMilliseconds,
  ExitCode,
  LogLevel,
} from './types.js';

// ---------------------------------------------------------------------------
// toNonEmptyString
// ---------------------------------------------------------------------------

describe('toNonEmptyString', () => {
  it('returns branded string for valid input', () => {
    const result = toNonEmptyString('hello');
    expect(result).toBe('hello');
  });

  it('throws for empty string', () => {
    expect(() => toNonEmptyString('')).toThrow('Expected a non-empty string');
  });

  it('does NOT throw for whitespace-only string', () => {
    expect(() => toNonEmptyString(' ')).not.toThrow();
    expect(toNonEmptyString(' ')).toBe(' ');
  });

  it('works with single character', () => {
    expect(toNonEmptyString('x')).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// toSessionId
// ---------------------------------------------------------------------------

describe('toSessionId', () => {
  it('returns branded string for valid UUID-like input', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(toSessionId(uuid)).toBe(uuid);
  });

  it('throws for empty string', () => {
    expect(() => toSessionId('')).toThrow('Session ID must be non-empty');
  });

  it('works with arbitrary non-empty strings', () => {
    expect(toSessionId('my-session')).toBe('my-session');
  });
});

// ---------------------------------------------------------------------------
// toMilliseconds
// ---------------------------------------------------------------------------

describe('toMilliseconds', () => {
  it('returns branded number for positive integer', () => {
    expect(toMilliseconds(1000)).toBe(1000);
  });

  it('throws for 0', () => {
    expect(() => toMilliseconds(0)).toThrow('Milliseconds must be a positive integer');
  });

  it('throws for negative numbers', () => {
    expect(() => toMilliseconds(-1)).toThrow('Milliseconds must be a positive integer');
  });

  it('throws for floating point', () => {
    expect(() => toMilliseconds(1.5)).toThrow('Milliseconds must be a positive integer');
  });

  it('throws for NaN', () => {
    expect(() => toMilliseconds(NaN)).toThrow('Milliseconds must be a positive integer');
  });

  it('throws for Infinity', () => {
    expect(() => toMilliseconds(Infinity)).toThrow('Milliseconds must be a positive integer');
  });
});

// ---------------------------------------------------------------------------
// ExitCode
// ---------------------------------------------------------------------------

describe('ExitCode', () => {
  it('has all 7 expected codes with correct values', () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.GeneralError).toBe(1);
    expect(ExitCode.AuthError).toBe(2);
    expect(ExitCode.ConnectionError).toBe(3);
    expect(ExitCode.TimeoutError).toBe(4);
    expect(ExitCode.PromptError).toBe(5);
    expect(ExitCode.SessionError).toBe(6);
  });

  it('has exactly 7 keys', () => {
    expect(Object.keys(ExitCode)).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// LogLevel
// ---------------------------------------------------------------------------

describe('LogLevel', () => {
  it('has all 4 levels with correct string values', () => {
    expect(LogLevel.Debug).toBe('debug');
    expect(LogLevel.Info).toBe('info');
    expect(LogLevel.Warn).toBe('warn');
    expect(LogLevel.Error).toBe('error');
  });

  it('has exactly 4 keys', () => {
    expect(Object.keys(LogLevel)).toHaveLength(4);
  });
});
