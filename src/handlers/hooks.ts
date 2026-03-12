/**
 * Session lifecycle hooks for error recovery, logging, and prompt
 * augmentation.
 *
 * Hooks are wired into the SDK session via {@link SessionConfig.hooks}
 * and fire at well-defined points in the session lifecycle.
 * @module
 */

import type { SessionConfig } from '@github/copilot-sdk';
import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Derived types — the SDK does not re-export hook input/output interfaces
// from its barrel, so we extract them from SessionConfig.
// ---------------------------------------------------------------------------

/** The hooks object accepted by {@link SessionConfig}. */
type SessionHooks = NonNullable<SessionConfig['hooks']>;

// Individual hook handler types derived from SessionHooks
type PreToolUseHook = NonNullable<SessionHooks['onPreToolUse']>;
type PostToolUseHook = NonNullable<SessionHooks['onPostToolUse']>;
type UserPromptSubmittedHook = NonNullable<SessionHooks['onUserPromptSubmitted']>;
type SessionStartHook = NonNullable<SessionHooks['onSessionStart']>;
type SessionEndHook = NonNullable<SessionHooks['onSessionEnd']>;
type ErrorOccurredHook = NonNullable<SessionHooks['onErrorOccurred']>;

/** Handler for user-input requests from the agent. */
type UserInputHandler = NonNullable<SessionConfig['onUserInputRequest']>;

/** First parameter of the user-input handler. */
type UserInputRequest = Parameters<UserInputHandler>[0];

/** Return type of the user-input handler (unwrapped from Promise). */
type UserInputResponse = Awaited<ReturnType<UserInputHandler>>;

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

/** Error handling strategy for the error hook. */
export type ErrorStrategy = 'retry' | 'skip' | 'abort';

/** Options accepted by {@link createSessionHooks}. */
export interface HookOptions {
  readonly logger: Logger;
  readonly verbose?: boolean;
  readonly blockedTools?: readonly string[];
  readonly errorStrategy?: ErrorStrategy;
  readonly promptTransform?: (prompt: string) => string;
}

// ---------------------------------------------------------------------------
// Individual hook factories
// ---------------------------------------------------------------------------

/**
 * Create a pre-tool-use hook that logs invocations and optionally blocks
 * specific tools.
 */
export function createPreToolUseHook(
  logger: Logger,
  verbose: boolean,
  blockedTools?: readonly string[],
): PreToolUseHook {
  const blocked = blockedTools ? new Set(blockedTools) : undefined;

  return async (input) => {
    if (blocked?.has(input.toolName)) {
      logger.warn(`Blocked tool: ${input.toolName}`);
      return { permissionDecision: 'deny' };
    }

    if (verbose) {
      const argsSummary = summariseArgs(input.toolArgs);
      logger.debug(`Pre-tool: ${input.toolName}${argsSummary ? ` (${argsSummary})` : ''}`);
    }

    return { permissionDecision: 'allow' };
  };
}

/**
 * Create a post-tool-use hook that logs tool result status and errors.
 */
export function createPostToolUseHook(
  logger: Logger,
  verbose: boolean,
): PostToolUseHook {
  return async (input) => {
    const { resultType } = input.toolResult;

    if (verbose) {
      const icon = resultType === 'success' ? '✓' : '✗';
      logger.debug(`Post-tool: ${input.toolName} → ${icon} (${resultType})`);
    }

    if (resultType === 'failure') {
      const errorMsg = input.toolResult.error ?? 'unknown error';
      logger.error(`Tool ${input.toolName} failed: ${errorMsg}`);
    }

    if (resultType === 'rejected' || resultType === 'denied') {
      logger.warn(`Tool ${input.toolName} was ${resultType}`);
    }

    return undefined;
  };
}

/**
 * Create a user-prompt-submitted hook that logs prompt info and optionally
 * transforms the prompt.
 */
export function createUserPromptSubmittedHook(
  logger: Logger,
  verbose: boolean,
  promptTransform?: (prompt: string) => string,
): UserPromptSubmittedHook {
  return async (input) => {
    if (verbose) {
      const truncated = input.prompt.slice(0, 100);
      const ellipsis = input.prompt.length > 100 ? '…' : '';
      logger.debug(`Prompt submitted (${input.prompt.length} chars): ${truncated}${ellipsis}`);
    }

    if (promptTransform) {
      const transformed = promptTransform(input.prompt);
      return { modifiedPrompt: transformed };
    }

    return undefined;
  };
}

/**
 * Create a session-start hook that logs session source and ID.
 */
export function createSessionStartHook(
  logger: Logger,
): SessionStartHook {
  return async (input, invocation) => {
    logger.debug(`Session started (source: ${input.source}, id: ${invocation.sessionId})`);
    return undefined;
  };
}

/**
 * Create a session-end hook that logs end reason, errors, and message summary.
 */
export function createSessionEndHook(
  logger: Logger,
): SessionEndHook {
  return async (input) => {
    if (input.reason === 'error') {
      logger.error(`Session ended with error: ${input.error ?? 'unknown'}`);
    } else {
      logger.debug(`Session ended: ${input.reason}`);
    }

    if (input.finalMessage) {
      const summary = input.finalMessage.slice(0, 200);
      const ellipsis = input.finalMessage.length > 200 ? '…' : '';
      logger.debug(`Final message: ${summary}${ellipsis}`);
    }

    return {
      sessionSummary: input.finalMessage ?? 'Session completed',
    };
  };
}

/**
 * Create an error-occurred hook with configurable error strategy.
 *
 * Default behaviour:
 * - Recoverable model errors → retry (up to 2 times)
 * - Tool execution errors → skip (let the model handle it)
 * - All other errors → abort with user notification
 *
 * When `errorStrategy` is provided it overrides the default logic.
 */
export function createErrorOccurredHook(
  logger: Logger,
  errorStrategy?: ErrorStrategy,
): ErrorOccurredHook {
  return async (input) => {
    logger.error(`Error [${input.errorContext}]: ${input.error}`);
    logger.debug(`Recoverable: ${String(input.recoverable)}`);

    // If a blanket strategy is configured, use it directly.
    if (errorStrategy) {
      return buildErrorResponse(errorStrategy, input.error);
    }

    // Auto-retry recoverable model errors
    if (input.recoverable && input.errorContext === 'model_call') {
      logger.info('Retrying model call...');
      return { errorHandling: 'retry', retryCount: 2 };
    }

    // Skip tool execution errors (let the model handle it)
    if (input.errorContext === 'tool_execution') {
      return { errorHandling: 'skip' };
    }

    // Abort on system errors
    return {
      errorHandling: 'abort',
      userNotification: `Fatal error: ${input.error}`,
    };
  };
}

// ---------------------------------------------------------------------------
// Hook builder — composes all hooks
// ---------------------------------------------------------------------------

/**
 * Create session hooks with error recovery and diagnostic logging.
 *
 * - **Pre-tool**: logs tool invocations; blocks tools in `blockedTools`.
 * - **Post-tool**: logs result type; reports failures and rejections.
 * - **Prompt submitted**: logs prompt length; applies `promptTransform`.
 * - **Session start / end**: logs lifecycle transitions with IDs.
 * - **Error**: uses `errorStrategy` or smart defaults (retry/skip/abort).
 */
export function createSessionHooks(options: HookOptions): SessionHooks {
  const {
    logger,
    verbose = false,
    blockedTools,
    errorStrategy,
    promptTransform,
  } = options;

  return {
    onPreToolUse: createPreToolUseHook(logger, verbose, blockedTools),
    onPostToolUse: createPostToolUseHook(logger, verbose),
    onUserPromptSubmitted: createUserPromptSubmittedHook(logger, verbose, promptTransform),
    onSessionStart: createSessionStartHook(logger),
    onSessionEnd: createSessionEndHook(logger),
    onErrorOccurred: createErrorOccurredHook(logger, errorStrategy),
  };
}

// ---------------------------------------------------------------------------
// Auto user-input handler
// ---------------------------------------------------------------------------

/**
 * Create a user-input handler that auto-responds to agent questions.
 *
 * If the agent provides choices, the first choice is selected.
 * Otherwise it responds with a generic affirmative.
 */
export function createAutoUserInputHandler(): UserInputHandler {
  return async (
    request: UserInputRequest,
  ): Promise<UserInputResponse> => {
    if (request.choices?.length) {
      return { answer: request.choices[0] ?? '', wasFreeform: false };
    }
    return { answer: 'Yes, proceed', wasFreeform: true };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a short summary of tool arguments for logging. */
function summariseArgs(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return args.slice(0, 80);
  try {
    const json = JSON.stringify(args);
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return '[unserializable]';
  }
}

/** Build a uniform error response for a given strategy. */
function buildErrorResponse(
  strategy: ErrorStrategy,
  error: string,
): { errorHandling: ErrorStrategy; retryCount?: number; userNotification?: string } {
  switch (strategy) {
    case 'retry':
      return { errorHandling: 'retry', retryCount: 2 };
    case 'skip':
      return { errorHandling: 'skip' };
    case 'abort':
      return { errorHandling: 'abort', userNotification: `Fatal error: ${error}` };
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}
