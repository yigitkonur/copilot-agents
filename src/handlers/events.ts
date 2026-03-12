/**
 * Event rendering handlers for streaming and non-streaming modes.
 *
 * Each factory returns a {@link SessionEventHandler} that can be passed
 * directly to `session.on('event', handler)`.
 * @module
 */

import type { SessionEventHandler } from '../types.js';
import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Streaming handler — run --stream / chat
// ---------------------------------------------------------------------------

/**
 * Create an event handler for streaming mode that renders assistant deltas
 * directly to stdout and shows tool activity via the logger.
 */
export function createStreamingEventHandler(logger: Logger): SessionEventHandler {
  let currentContent = '';

  const handler: SessionEventHandler = (event): void => {
    switch (event.type) {
      // --- assistant events ---
      case 'assistant.message_delta': {
        const delta = event.data.deltaContent;
        if (delta) {
          process.stdout.write(delta);
          currentContent += delta;
        }
        break;
      }

      case 'assistant.reasoning_delta':
        logger.debug(`[thinking] ${event.data.deltaContent}`);
        break;

      case 'assistant.turn_start':
        logger.debug('↳ Turn started');
        break;

      case 'assistant.turn_end':
        logger.debug('↲ Turn ended');
        break;

      case 'assistant.message':
        logger.debug(`✉ Message complete (${event.data.messageId})`);
        break;

      // --- tool events ---
      case 'tool.execution_start':
        logger.info(`⚙ Running: ${event.data.toolName}`);
        break;

      case 'tool.execution_complete': {
        if (!event.data.success) {
          logger.warn(`⚠ Tool failed: ${event.data.toolCallId}`);
        } else {
          logger.debug(`✓ Tool done: ${event.data.toolCallId}`);
        }
        break;
      }

      // --- subagent events ---
      case 'subagent.started':
        logger.info(
          `🤖 Agent started: ${event.data.agentDisplayName || event.data.agentName}`,
        );
        break;

      case 'subagent.completed':
        logger.info(`✓ Agent completed: ${event.data.agentDisplayName}`);
        break;

      case 'subagent.failed':
        logger.error(
          `✗ Agent failed: ${event.data.agentName} - ${event.data.error}`,
        );
        break;

      // --- permission events ---
      case 'permission.requested':
        logger.info(`🔐 Permission requested: ${event.data.permissionRequest.kind} (${event.data.requestId})`);
        break;

      case 'permission.completed':
        logger.info(`🔐 Permission ${event.data.result.kind}: ${event.data.requestId}`);
        break;

      // --- session events ---
      case 'session.compaction_start':
        logger.debug('Compacting session context...');
        break;

      case 'session.compaction_complete':
        logger.debug(
          `Compaction done: ${event.data.success ? 'success' : 'failed'}` +
          (event.data.preCompactionTokens != null && event.data.postCompactionTokens != null
            ? ` (${event.data.preCompactionTokens - event.data.postCompactionTokens} tokens removed)`
            : ''),
        );
        break;

      case 'session.error':
        logger.error(`Session error: ${event.data.message}`);
        break;

      case 'session.idle':
        if (currentContent) {
          process.stdout.write('\n');
          currentContent = '';
        }
        break;

      // --- plan mode ---
      case 'exit_plan_mode.requested':
        logger.info(`📋 Plan mode exit: ${event.data.summary}`);
        break;

      // --- pending messages ---
      case 'pending_messages.modified':
        logger.debug('📨 Pending messages changed');
        break;

      default:
        // Silently ignore unknown events for forward compatibility
        break;
    }
  };

  return handler;
}

// ---------------------------------------------------------------------------
// Quiet handler — run (non-streaming)
// ---------------------------------------------------------------------------

/**
 * Create an event handler for quiet / non-streaming mode that only
 * surfaces session-level errors, final messages, and idle state.
 */
export function createQuietEventHandler(logger: Logger): SessionEventHandler {
  const handler: SessionEventHandler = (event): void => {
    switch (event.type) {
      case 'session.error':
        logger.error(`Session error: ${event.data.message}`);
        break;

      case 'session.idle':
        // Signal completion — no action needed
        break;

      case 'assistant.message':
        logger.debug(`Message received (${event.data.messageId})`);
        break;

      default:
        break;
    }
  };

  return handler;
}

// ---------------------------------------------------------------------------
// Progress handler — fleet mode
// ---------------------------------------------------------------------------

/**
 * Create a progress event handler (for fleet mode) that reports tool
 * activity, subagent tracking, and errors tagged with a task identifier.
 */
export function createProgressEventHandler(
  taskId: string,
  logger: Logger,
): SessionEventHandler {
  let toolCount = 0;

  const handler: SessionEventHandler = (event): void => {
    switch (event.type) {
      // --- tool tracking ---
      case 'tool.execution_start':
        toolCount++;
        logger.debug(`[${taskId}] ⚙ ${event.data.toolName} (#${toolCount})`);
        break;

      case 'tool.execution_complete': {
        if (!event.data.success) {
          logger.warn(`[${taskId}] ⚠ Tool failed: ${event.data.toolCallId}`);
        }
        break;
      }

      // --- subagent tracking ---
      case 'subagent.started':
        logger.debug(
          `[${taskId}] 🤖 ${event.data.agentDisplayName || event.data.agentName}`,
        );
        break;

      case 'subagent.completed':
        logger.debug(`[${taskId}] ✓ Agent done`);
        break;

      case 'subagent.failed':
        logger.error(
          `[${taskId}] ✗ Agent failed: ${event.data.error}`,
        );
        break;

      // --- errors ---
      case 'session.error':
        logger.error(`[${taskId}] Error: ${event.data.message}`);
        break;

      case 'session.idle':
        logger.debug(`[${taskId}] Idle (${toolCount} tool calls)`);
        break;

      default:
        break;
    }
  };

  return handler;
}
