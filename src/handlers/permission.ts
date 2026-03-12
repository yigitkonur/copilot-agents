/**
 * Permission handling strategies for the Copilot SDK.
 *
 * Provides four strategies: auto-approve (CI/unattended), interactive
 * (logs requests for visibility), read-only (denies writes/shell),
 * and policy-based (configurable per-kind allow/deny with allowlists).
 * @module
 */

import { approveAll } from '@github/copilot-sdk';
import type {
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
} from '@github/copilot-sdk';
import type { Logger } from '../utils/logger.js';

// ── Result constants ────────────────────────────────────────────────

/** Pre-built "approved" result. */
export const APPROVED: PermissionRequestResult = { kind: 'approved' } as const;

/** Pre-built "denied-by-rules" result for policy-based denials. */
export const DENIED_BY_RULES: PermissionRequestResult = {
  kind: 'denied-by-rules',
  rules: [],
} as const;

// ── Re-export ───────────────────────────────────────────────────────

/** Auto-approve all permissions (for unattended / CI mode). */
export { approveAll };

// ── Helpers ─────────────────────────────────────────────────────────

/** Safely stringify an unknown value from the PermissionRequest index signature. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

// ── Interactive handler ─────────────────────────────────────────────

/**
 * Create an interactive permission handler that logs each request for
 * visibility before approving it.
 *
 * Useful during development or when you want an audit trail without
 * blocking execution.
 */
export function createInteractivePermissionHandler(logger: Logger): PermissionHandler {
  return async (
    request: PermissionRequest,
    invocation: { sessionId: string },
  ): Promise<PermissionRequestResult> => {
    logger.debug(`Permission: ${request.kind} [session: ${invocation.sessionId}]`);

    switch (request.kind) {
      case 'shell':
        logger.debug(`  Command: ${str(request['fullCommandText'])}`);
        logger.debug(`  Intention: ${str(request['intention'])}`);
        if (request['warning']) {
          logger.warn(`  Warning: ${str(request['warning'])}`);
        }
        break;
      case 'write':
        logger.debug(`  File: ${str(request['fileName'])}`);
        logger.debug(`  Intention: ${str(request['intention'])}`);
        break;
      case 'read':
        logger.debug(`  Path: ${str(request['path'])}`);
        logger.debug(`  Intention: ${str(request['intention'])}`);
        break;
      case 'mcp':
        logger.debug(`  Server: ${str(request['serverName'])}`);
        logger.debug(`  Tool: ${str(request['toolName'])} (${str(request['toolTitle'])})`);
        break;
      case 'url':
        logger.debug(`  URL: ${str(request['url'])}`);
        logger.debug(`  Intention: ${str(request['intention'])}`);
        break;
      case 'custom-tool':
        logger.debug(`  Tool: ${str(request['toolName'])}`);
        logger.debug(`  Description: ${str(request['toolDescription'])}`);
        break;
      default: {
        const _exhaustive: never = request.kind;
        logger.debug(`  Unknown permission kind: ${String(_exhaustive)}`);
        break;
      }
    }

    return APPROVED;
  };
}

// ── Read-only handler ───────────────────────────────────────────────

/**
 * Create a read-only permission handler that approves reads but denies
 * all write and shell operations.
 *
 * Ideal for inspection-only sessions where mutations must be prevented.
 */
export function createReadOnlyPermissionHandler(logger: Logger): PermissionHandler {
  return async (
    request: PermissionRequest,
  ): Promise<PermissionRequestResult> => {
    switch (request.kind) {
      case 'read':
        return APPROVED;
      case 'shell':
      case 'write':
      case 'mcp':
      case 'url':
      case 'custom-tool':
        logger.warn(`Denied ${request.kind} permission (read-only mode)`);
        return DENIED_BY_RULES;
      default: {
        const _exhaustive: never = request.kind;
        logger.warn(`Denied unknown permission kind: ${String(_exhaustive)} (read-only mode)`);
        return DENIED_BY_RULES;
      }
    }
  };
}

// ── Policy-based handler ────────────────────────────────────────────

/** Declarative policy for the configurable permission handler. */
export interface PermissionPolicy {
  readonly allowShell?: boolean;
  readonly allowWrite?: boolean;
  readonly allowRead?: boolean;
  readonly allowMcp?: boolean;
  readonly allowUrl?: boolean;
  readonly allowCustomTool?: boolean;
  /** Shell commands that are always permitted (matched against fullCommandText start). */
  readonly shellAllowList?: readonly string[];
  /** File-path prefixes that are always permitted for writes. */
  readonly writeAllowList?: readonly string[];
}

/**
 * Create a policy-based permission handler that approves or denies
 * requests according to a {@link PermissionPolicy} object.
 *
 * When a top-level flag (e.g. `allowShell`) is `false` or omitted, the
 * handler still checks the corresponding allowlist before denying.
 */
export function createPolicyPermissionHandler(
  logger: Logger,
  policy: PermissionPolicy,
): PermissionHandler {
  return async (
    request: PermissionRequest,
  ): Promise<PermissionRequestResult> => {
    switch (request.kind) {
      case 'shell': {
        if (policy.allowShell) return APPROVED;
        const cmd = str(request['fullCommandText']);
        if (
          policy.shellAllowList?.some((allowed) => cmd.startsWith(allowed))
        ) {
          logger.debug(`Shell command matched allowlist: ${cmd}`);
          return APPROVED;
        }
        logger.warn(`Denied shell permission by policy: ${cmd}`);
        return DENIED_BY_RULES;
      }
      case 'write': {
        if (policy.allowWrite) return APPROVED;
        const file = str(request['fileName']);
        if (
          policy.writeAllowList?.some((prefix) => file.startsWith(prefix))
        ) {
          logger.debug(`Write path matched allowlist: ${file}`);
          return APPROVED;
        }
        logger.warn(`Denied write permission by policy: ${file}`);
        return DENIED_BY_RULES;
      }
      case 'read':
        if (policy.allowRead) return APPROVED;
        logger.warn(`Denied read permission by policy`);
        return DENIED_BY_RULES;
      case 'mcp':
        if (policy.allowMcp) return APPROVED;
        logger.warn(`Denied mcp permission by policy: ${str(request['toolName'])}`);
        return DENIED_BY_RULES;
      case 'url':
        if (policy.allowUrl) return APPROVED;
        logger.warn(`Denied url permission by policy: ${str(request['url'])}`);
        return DENIED_BY_RULES;
      case 'custom-tool':
        if (policy.allowCustomTool) return APPROVED;
        logger.warn(`Denied custom-tool permission by policy: ${str(request['toolName'])}`);
        return DENIED_BY_RULES;
      default: {
        const _exhaustive: never = request.kind;
        logger.warn(`Denied unknown permission kind: ${String(_exhaustive)} by policy`);
        return DENIED_BY_RULES;
      }
    }
  };
}
