/**
 * Core type definitions for the Copilot CLI.
 *
 * SDK types are re-exported from `@github/copilot-sdk`.
 * CLI-specific types (branded types, config, fleet, etc.) are defined here.
 *
 * Strict TypeScript — no `any`, branded types where useful,
 * `as const` objects instead of enums, discriminated unions.
 * @module
 */

// ===================================================================
// SDK Value Re-exports (classes + functions)
// Import these directly from '@github/copilot-sdk' in consumer files.
// They are NOT re-exported here to avoid triggering SDK runtime load
// in modules that only need type definitions.
// ===================================================================

// Usage in consumer files:
//   import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
//   import { defineTool, approveAll } from '@github/copilot-sdk';

// ===================================================================
// SDK Type Re-exports
// ===================================================================

export type {
  AssistantMessageEvent,
  ConnectionState,
  CopilotClientOptions,
  CustomAgentConfig,
  ForegroundSessionInfo,
  GetAuthStatusResponse,
  GetStatusResponse,
  InfiniteSessionConfig,
  MCPLocalServerConfig,
  MCPRemoteServerConfig,
  MCPServerConfig,
  MessageOptions,
  ModelBilling,
  ModelCapabilities,
  ModelInfo,
  ModelPolicy,
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
  ResumeSessionConfig,
  SessionConfig,
  SessionContext,
  SessionEvent,
  SessionEventHandler,
  SessionEventPayload,
  SessionEventType,
  SessionLifecycleEvent,
  SessionLifecycleEventType,
  SessionLifecycleHandler,
  SessionListFilter,
  SessionMetadata,
  SystemMessageAppendConfig,
  SystemMessageConfig,
  SystemMessageReplaceConfig,
  Tool,
  ToolHandler,
  ToolInvocation,
  ToolResultObject,
  TypedSessionEventHandler,
  TypedSessionLifecycleHandler,
  ZodSchema,
} from '@github/copilot-sdk';

// ===================================================================
// CLI-Specific Types
// ===================================================================

// ---------------------------------------------------------------------------
// Branded-type helper
// ---------------------------------------------------------------------------

/** Create a nominal ("branded") type from a base type. */
type Brand<T, B extends string> = T & { readonly __brand: B };

/** Remove `readonly` from all properties — for internal mutable bookkeeping. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A non-empty string that has been validated at runtime. */
export type NonEmptyString = Brand<string, 'NonEmptyString'>;

/** An opaque session identifier. */
export type SessionId = Brand<string, 'SessionId'>;

/** Milliseconds (positive integer). */
export type Milliseconds = Brand<number, 'Milliseconds'>;

// ---------------------------------------------------------------------------
// Result type — used everywhere instead of thrown errors
// ---------------------------------------------------------------------------

/** Discriminated success / failure union for error handling without exceptions. */
export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// ---------------------------------------------------------------------------
// Const-object "enums"
// ---------------------------------------------------------------------------

/** Severity levels for structured logging. */
export const LogLevel = {
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const;

/** @see {@link LogLevel} */
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/** Process exit codes with semantic meaning. */
export const ExitCode = {
  Success: 0,
  GeneralError: 1,
  AuthError: 2,
  ConnectionError: 3,
  TimeoutError: 4,
  PromptError: 5,
  SessionError: 6,
} as const;

/** @see {@link ExitCode} */
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

// ---------------------------------------------------------------------------
// CLI command configuration
// ---------------------------------------------------------------------------

/** Configuration for a single `run` invocation. */
export interface RunConfig {
  /** The user prompt to send. */
  readonly prompt: string;
  /** Model identifier (e.g. `"gpt-5.4"`). Falls back to server default. */
  readonly model?: string;
  /** Working directory for tool execution. */
  readonly cwd: string;
  /** Whether to stream tokens as they arrive. */
  readonly stream: boolean;
  /** Maximum wall-clock milliseconds before aborting. */
  readonly timeout: number;
  /** Resume or attach to an existing session. */
  readonly sessionId?: SessionId;
  /** Agent slug to use (e.g. `"copilot-chat"`). */
  readonly agent?: string;
  /** Controls how much "thinking" the model does. */
  readonly reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Optional system-level instruction prepended to the conversation. */
  readonly systemMessage?: string;
  /** File paths to attach as context. */
  readonly attachments?: readonly string[];
}

/** Configuration for a parallelised `fleet` run. */
export interface FleetConfig {
  /** Glob-resolved list of prompt files. */
  readonly promptFiles: readonly string[];
  /** Model identifier shared across all tasks. */
  readonly model?: string;
  /** Working directory for tool execution. */
  readonly cwd: string;
  /** Maximum number of tasks running at the same time. */
  readonly concurrency: number;
  /** Per-task timeout in milliseconds. */
  readonly timeout: number;
  /** Whether to stream individual task output. */
  readonly stream: boolean;
}

// ---------------------------------------------------------------------------
// Fleet result types
// ---------------------------------------------------------------------------

/** Lifecycle status of a single fleet task. */
export type FleetTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Represents one task inside a fleet run. */
export interface FleetTask {
  /** Unique task identifier. */
  readonly id: string;
  /** Path to the prompt file that produced this task. */
  readonly promptFile: string;
  /** Current lifecycle status. */
  readonly status: FleetTaskStatus;
  /** Model output on success. */
  readonly result?: string;
  /** Error message on failure. */
  readonly error?: string;
  /** When the task started executing. */
  readonly startedAt?: Date;
  /** When the task finished (success or failure). */
  readonly completedAt?: Date;
}

/** Aggregate result of a fleet run. */
export interface FleetResult {
  /** Ordered list of all tasks. */
  readonly tasks: readonly FleetTask[];
  /** Total wall-clock duration in milliseconds. */
  readonly totalDuration: number;
  /** Number of tasks that completed successfully. */
  readonly succeeded: number;
  /** Number of tasks that failed. */
  readonly failed: number;
}

// ---------------------------------------------------------------------------
// Prompt source — discriminated union
// ---------------------------------------------------------------------------

/** Where a prompt originates from, discriminated on `kind`. */
export type PromptSource =
  | { readonly kind: 'inline'; readonly content: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'stdin' };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Authentication status returned by `gh auth status`. */
export interface AuthInfo {
  /** Whether the user is currently authenticated. */
  readonly isAuthenticated: boolean;
  /** e.g. `"token"`, `"oauth"`, `"ssh"` */
  readonly authType?: string;
  /** GitHub hostname (usually `github.com`). */
  readonly host?: string;
  /** GitHub username. */
  readonly login?: string;
  /** Human-readable status summary. */
  readonly statusMessage?: string;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Metadata about a persisted Copilot session (for listing). */
export interface SessionInfo {
  /** Unique session identifier. */
  readonly sessionId: SessionId;
  /** When the session was created. */
  readonly startTime: Date;
  /** When the session was last modified. */
  readonly modifiedTime: Date;
  /** One-line summary generated from conversation. */
  readonly summary?: string;
  /** Whether this session lives on the server side. */
  readonly isRemote: boolean;
  /** Working directory at session start. */
  readonly cwd?: string;
  /** Repository slug (e.g. `owner/repo`). */
  readonly repository?: string;
  /** Git branch that was active. */
  readonly branch?: string;
}

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

/** Display information for a single model. */
export interface ModelDisplay {
  /** Model identifier used in API calls. */
  readonly id: string;
  /** Human-friendly display name. */
  readonly name: string;
  /** Whether the model can process images. */
  readonly vision: boolean;
  /** Maximum context window in tokens. */
  readonly contextWindow: number;
  /** Policy state (e.g. `"enabled"`, `"limited"`). */
  readonly policyState?: string;
  /** Cost multiplier relative to the base model. */
  readonly billingMultiplier?: number;
  /** Supported reasoning-effort levels. */
  readonly reasoningEfforts?: readonly string[];
}

// ---------------------------------------------------------------------------
// Provider Configuration (BYOK) — not exported by SDK
// ---------------------------------------------------------------------------

/** Configuration for a custom API provider (BYOK). */
export interface ProviderConfig {
  readonly type?: 'openai' | 'azure' | 'anthropic';
  readonly wireApi?: 'completions' | 'responses';
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly bearerToken?: string;
  readonly azure?: {
    readonly apiVersion?: string;
  };
}

// ---------------------------------------------------------------------------
// Attachment types — not exported by SDK
// ---------------------------------------------------------------------------

/** File attachment for a message. */
export interface FileAttachment {
  readonly type: 'file';
  readonly path: string;
  readonly displayName?: string;
}

/** Directory attachment for a message. */
export interface DirectoryAttachment {
  readonly type: 'directory';
  readonly path: string;
  readonly displayName?: string;
}

/** Selection attachment for a message. */
export interface SelectionAttachment {
  readonly type: 'selection';
  readonly filePath: string;
  readonly displayName: string;
  readonly selection?: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
  readonly text?: string;
}

/** All attachment types supported by the SDK. */
export type Attachment = FileAttachment | DirectoryAttachment | SelectionAttachment;

// ---------------------------------------------------------------------------
// Chat (interactive REPL) configuration — not in SDK
// ---------------------------------------------------------------------------

/** Configuration for the interactive chat command. */
export interface ChatConfig {
  readonly model?: string;
  readonly cwd: string;
  readonly sessionId?: string;
  readonly resume?: boolean;
  readonly systemMessage?: string;
  readonly mcpServers?: Readonly<Record<string, import('@github/copilot-sdk').MCPServerConfig>>;
  readonly skillDirectories?: readonly string[];
  readonly stream: boolean;
  readonly timeout: number;
}

// ---------------------------------------------------------------------------
// Reasoning effort — not exported by SDK
// ---------------------------------------------------------------------------

/** Valid reasoning effort levels. */
export const ReasoningEffortValues = ['low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof ReasoningEffortValues)[number];

/** Type guard for reasoning effort values. */
export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (ReasoningEffortValues as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Branded-type constructors (runtime validation)
// ---------------------------------------------------------------------------

/** Assert a string is non-empty at runtime and brand it. */
export function toNonEmptyString(value: string): NonEmptyString {
  if (value.length === 0) {
    throw new Error('Expected a non-empty string');
  }
  return value as NonEmptyString;
}

/** Brand an arbitrary string as a {@link SessionId}. */
export function toSessionId(value: string): SessionId {
  if (value.length === 0) {
    throw new Error('Session ID must be non-empty');
  }
  return value as SessionId;
}

/** Brand a number as {@link Milliseconds} (must be positive integer). */
export function toMilliseconds(value: number): Milliseconds {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Milliseconds must be a positive integer');
  }
  return value as Milliseconds;
}
