/**
 * Custom error hierarchy for the Copilot CLI.
 *
 * Every domain error extends {@link AppError} which carries a machine-readable
 * `code` and a process {@link ExitCode}.  Two helpers — {@link toAppError} and
 * {@link wrapAsync} — bridge the gap between `unknown` catches and typed errors.
 * @module
 */

import type { ExitCode as ExitCodeType, Result } from './types.js';
import { ExitCode } from './types.js';

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/** Base application error with a machine-readable code and process exit code. */
export class AppError extends Error {
  /** Machine-readable error code (e.g. `"AUTH_FAILED"`). */
  readonly code: string;
  /** Suggested process exit code. */
  readonly exitCode: ExitCodeType;

  constructor(message: string, code: string, exitCode: ExitCodeType) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.exitCode = exitCode;
    // Restore prototype chain broken by `extends Error` in TS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/** Raised when authentication with GitHub fails or is missing. */
export class AuthError extends AppError {
  constructor(message: string, code = 'AUTH_FAILED') {
    super(message, code, ExitCode.AuthError);
    this.name = 'AuthError';
  }
}

/** Raised when a network / API connection cannot be established. */
export class ConnectionError extends AppError {
  constructor(message: string, code = 'CONNECTION_FAILED') {
    super(message, code, ExitCode.ConnectionError);
    this.name = 'ConnectionError';
  }
}

/** Raised when an operation exceeds its configured timeout. */
export class TimeoutError extends AppError {
  constructor(message: string, code = 'TIMEOUT') {
    super(message, code, ExitCode.TimeoutError);
    this.name = 'TimeoutError';
  }
}

/** Raised when the user-supplied prompt is invalid or unreadable. */
export class PromptError extends AppError {
  constructor(message: string, code = 'PROMPT_INVALID') {
    super(message, code, ExitCode.PromptError);
    this.name = 'PromptError';
  }
}

/** Raised when session creation, lookup, or resumption fails. */
export class SessionError extends AppError {
  constructor(message: string, code = 'SESSION_FAILED') {
    super(message, code, ExitCode.SessionError);
    this.name = 'SessionError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise an `unknown` caught value into an {@link AppError}.
 *
 * - If the value is already an `AppError`, it is returned as-is.
 * - If it is a standard `Error`, it is wrapped with a general exit code.
 * - Anything else is stringified.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const wrapped = new AppError(error.message, 'UNKNOWN_ERROR', ExitCode.GeneralError);
    wrapped.stack = error.stack;
    return wrapped;
  }

  return new AppError(String(error), 'UNKNOWN_ERROR', ExitCode.GeneralError);
}

/**
 * Execute an async function and return a {@link Result} instead of throwing.
 *
 * ```ts
 * const result = await wrapAsync(() => fetchModels());
 * if (!result.success) {
 *   console.error(result.error.message);
 * }
 * ```
 */
export async function wrapAsync<T>(fn: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error: unknown) {
    return { success: false, error: toAppError(error) };
  }
}
