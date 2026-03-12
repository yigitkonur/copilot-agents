/**
 * Interactive chat REPL command — multi-turn conversation with Copilot.
 *
 * Maintains a single session across turns, with streaming output,
 * slash commands, and proper cleanup on exit.
 * @module
 */

import { Command } from 'commander';
import { createInterface } from 'node:readline';

import type { CopilotSession } from '@github/copilot-sdk';

import type { MessageOptions } from '../types.js';
import { ExitCode } from '../types.js';
import { toAppError } from '../errors.js';
import { clientManager } from '../core/client-manager.js';
import { createInteractivePermissionHandler, createReadOnlyPermissionHandler } from '../handlers/permission.js';
import { createStreamingEventHandler } from '../handlers/events.js';
import { createSessionHooks, createAutoUserInputHandler } from '../handlers/hooks.js';
import { createLogger, LogSeverity } from '../utils/logger.js';

import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// CLI option shape
// ---------------------------------------------------------------------------

interface ChatOptions {
  readonly model?: string;
  readonly cwd: string;
  readonly sessionId?: string;
  readonly resume?: boolean;
  readonly systemMessage?: string;
  readonly readOnly?: boolean;
  readonly verbose?: boolean;
  readonly timeout: string;
}

// ---------------------------------------------------------------------------
// Exit commands
// ---------------------------------------------------------------------------

const EXIT_COMMANDS = new Set(['exit', 'quit', '/quit', '/exit', '/q']);

// ---------------------------------------------------------------------------
// Slash command help text
// ---------------------------------------------------------------------------

const SLASH_HELP = `
Available commands:
  /model <name>                Switch model mid-conversation
  /mode <interactive|plan|autopilot>  Switch session mode
  /plan                        Show current plan
  /compact                     Trigger manual context compaction
  /abort                       Abort current operation
  /agents                      List available agents
  /agent <name>                Select an agent
  /help                        Show this help
  /quit, /exit                 Exit the REPL
`.trim();

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createChatCommand(): Command {
  return new Command('chat')
    .description('Interactive multi-turn conversation with Copilot')
    .option('-m, --model <model>', 'Model to use')
    .option('-d, --cwd <dir>', 'Working directory', process.cwd())
    .option('--session-id <id>', 'Session ID for persistence')
    .option('--resume', 'Resume an existing session')
    .option('--system-message <text>', 'System message')
    .option('--read-only', 'Read-only mode')
    .option('-v, --verbose', 'Verbose output')
    .option('-t, --timeout <ms>', 'Timeout per message in ms', '120000')
    .action(async (options: ChatOptions) => {
      await executeChat(options);
    });
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

async function executeChat(options: ChatOptions): Promise<void> {
  const logger = createLogger(
    options.verbose ? LogSeverity.Debug : LogSeverity.Info,
  );
  const timeout = parseInt(options.timeout, 10) || 120_000;

  let session: CopilotSession | undefined;

  try {
    const client = await clientManager.getClient({ cwd: options.cwd });

    const permissionHandler = options.readOnly
      ? createReadOnlyPermissionHandler(logger)
      : createInteractivePermissionHandler(logger);

    const hooks = createSessionHooks({
      logger,
      verbose: options.verbose ?? false,
    });

    const userInputHandler = createAutoUserInputHandler();

    if (options.resume && options.sessionId) {
      session = await client.resumeSession(options.sessionId, {
        onPermissionRequest: permissionHandler,
        onUserInputRequest: userInputHandler,
        hooks,
        streaming: true,
        model: options.model,
        workingDirectory: options.cwd,
      });
      logger.success(`Resumed session: ${session.sessionId}`);
    } else {
      session = await client.createSession({
        sessionId: options.sessionId,
        model: options.model,
        workingDirectory: options.cwd,
        onPermissionRequest: permissionHandler,
        onUserInputRequest: userInputHandler,
        hooks,
        streaming: true,
        systemMessage: options.systemMessage
          ? { mode: 'append' as const, content: options.systemMessage }
          : undefined,
      });
      logger.success(`Session started: ${session.sessionId}`);
    }

    // Register streaming event handler BEFORE any sends (race-condition safe)
    session.on(createStreamingEventHandler(logger));

    // Listen for compaction events and log token savings
    session.on('session.compaction_complete', (event) => {
      const data: Record<string, unknown> = isRecord(event.data) ? event.data : {};
      const removed = typeof data['tokensRemoved'] === 'number' ? data['tokensRemoved'] : 0;
      logger.info(`🗜 Compaction saved ${String(removed)} tokens`);
    });

    // Show history when resuming
    if (options.resume && options.sessionId) {
      await showSessionHistory(session, logger);
    }

    logger.info('Type your message (/help for commands, /quit to exit)\n');
    await chatLoop(session, timeout, logger);

  } catch (error: unknown) {
    const appErr = toAppError(error);
    logger.error(appErr.message);
    process.exit(appErr.exitCode);
  } finally {
    if (session) {
      try {
        await session.disconnect();
        logger.debug('Session disconnected');
      } catch {
        // Ignore cleanup errors
      }
    }
    await clientManager.stop();
  }
}

// ---------------------------------------------------------------------------
// Session history (on resume)
// ---------------------------------------------------------------------------

async function showSessionHistory(
  session: CopilotSession,
  logger: Logger,
): Promise<void> {
  try {
    const messages = await session.getMessages();
    if (messages.length === 0) return;

    logger.info('── Session history ──');
    for (const msg of messages) {
      if (msg.type === 'user.message') {
        logger.info(`\x1b[33mYou:\x1b[0m ${String(msg.data.content ?? '')}`);
      } else if (msg.type === 'assistant.message') {
        logger.info(`\x1b[36mCopilot:\x1b[0m ${String(msg.data.content ?? '')}`);
      }
    }
    logger.info('── End history ──\n');
  } catch {
    logger.debug('Could not retrieve session history');
  }
}

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

async function handleSlashCommand(
  session: CopilotSession,
  input: string,
  logger: Logger,
): Promise<boolean> {
  const parts = input.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  switch (cmd) {
    case '/help':
      logger.info(SLASH_HELP);
      return true;

    case '/model': {
      if (!arg) {
        try {
          const current = await session.rpc.model.getCurrent();
          logger.info(`Current model: ${current.modelId ?? '(default)'}`);
        } catch {
          logger.warn('Could not retrieve current model');
        }
        return true;
      }
      try {
        await session.rpc.model.switchTo({ modelId: arg });
        logger.success(`Switched model to: ${arg}`);
      } catch (error: unknown) {
        logger.warn(`Failed to switch model: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    }

    case '/mode': {
      if (!arg) {
        try {
          const current = await session.rpc.mode.get();
          logger.info(`Current mode: ${current.mode}`);
        } catch {
          logger.warn('Could not retrieve current mode');
        }
        return true;
      }
      const validModes = ['interactive', 'plan', 'autopilot'] as const;
      type ValidMode = typeof validModes[number];
      const isValidMode = (v: string): v is ValidMode =>
        (validModes as readonly string[]).includes(v);
      if (!isValidMode(arg)) {
        logger.warn(`Invalid mode: ${arg}. Use: ${validModes.join(', ')}`);
        return true;
      }
      try {
        const result = await session.rpc.mode.set({ mode: arg });
        logger.success(`Mode switched to: ${result.mode}`);
      } catch (error: unknown) {
        logger.warn(`Failed to switch mode: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    }

    case '/plan': {
      try {
        const plan = await session.rpc.plan.read();
        if (!plan.exists || plan.content == null) {
          logger.info('No plan exists for this session');
        } else {
          logger.info('── Plan ──');
          console.log(plan.content);
          if (plan.path) logger.debug(`Plan file: ${plan.path}`);
          logger.info('── End plan ──');
        }
      } catch {
        logger.warn('Plan RPC not available');
      }
      return true;
    }

    case '/compact': {
      try {
        logger.info('Compacting session context...');
        const result = await session.rpc.compaction.compact();
        if (result.success) {
          logger.success(`Compaction complete: ${String(result.tokensRemoved)} tokens removed, ${String(result.messagesRemoved)} messages removed`);
        } else {
          logger.warn('Compaction did not succeed');
        }
      } catch {
        logger.warn('Compaction RPC not available');
      }
      return true;
    }

    case '/abort': {
      try {
        await session.abort();
        logger.success('Operation aborted');
      } catch {
        logger.warn('Nothing to abort');
      }
      return true;
    }

    case '/agents': {
      try {
        const result = await session.rpc.agent.list();
        if (result.agents.length === 0) {
          logger.info('No agents available');
        } else {
          logger.info('Available agents:');
          for (const agent of result.agents) {
            const display = agent.displayName ? `${agent.name} (${agent.displayName})` : agent.name;
            logger.info(`  • ${display} — ${agent.description}`);
          }
        }
      } catch {
        logger.warn('Agent list RPC not available');
      }
      return true;
    }

    case '/agent': {
      if (!arg) {
        try {
          const current = await session.rpc.agent.getCurrent();
          logger.info(`Current agent: ${current.agent?.displayName ?? current.agent?.name ?? '(default)'}`);
        } catch {
          logger.warn('Could not retrieve current agent');
        }
        return true;
      }
      try {
        const result = await session.rpc.agent.select({ name: arg });
        logger.success(`Selected agent: ${result.agent.displayName || result.agent.name}`);
      } catch (error: unknown) {
        logger.warn(`Failed to select agent: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// REPL loop
// ---------------------------------------------------------------------------

async function chatLoop(
  session: CopilotSession,
  timeout: number,
  logger: Logger,
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: '\n\x1b[36m❯\x1b[0m ',
  });

  /** Track whether the session is currently processing a message. */
  let isProcessing = false;

  return new Promise<void>((resolveLoop) => {
    const askQuestion = (): void => {
      rl.prompt();
    };

    rl.on('line', (input: string) => {
      const trimmed = input.trim();

      if (EXIT_COMMANDS.has(trimmed.toLowerCase())) {
        rl.close();
        return;
      }

      if (trimmed.length === 0) {
        askQuestion();
        return;
      }

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        void handleSlashCommand(session, trimmed, logger)
          .then((handled) => {
            if (!handled) {
              logger.warn(`Unknown command: ${trimmed.split(/\s+/)[0] ?? trimmed}. Type /help for available commands.`);
            }
            askQuestion();
          })
          .catch((error: unknown) => {
            const appErr = toAppError(error);
            logger.error(appErr.message);
            askQuestion();
          });
        return;
      }

      isProcessing = true;
      const messageOptions: MessageOptions = { prompt: trimmed };

      void sendAndWaitForIdle(session, messageOptions, timeout, logger)
        .then(() => {
          isProcessing = false;
          askQuestion();
        })
        .catch((error: unknown) => {
          isProcessing = false;
          const appErr = toAppError(error);
          logger.error(appErr.message);
          askQuestion();
        });
    });

    rl.on('close', () => {
      logger.info('\nGoodbye!');
      resolveLoop();
    });

    rl.on('SIGINT', () => {
      if (isProcessing) {
        logger.info('\nAborting current operation...');
        void session.abort().catch(() => {
          // Abort failed — close the REPL instead
          rl.close();
        });
      } else {
        rl.close();
      }
    });

    askQuestion();
  });
}

// ---------------------------------------------------------------------------
// Send and wait for session idle (streaming pattern)
// ---------------------------------------------------------------------------

async function sendAndWaitForIdle(
  session: CopilotSession,
  options: MessageOptions,
  timeout: number,
  _logger: Logger,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubIdle();
      unsubError();
      reject(new Error(`Timeout after ${timeout}ms`));
    }, timeout);

    const unsubIdle = session.on('session.idle', () => {
      clearTimeout(timeoutId);
      unsubIdle();
      unsubError();
      resolve();
    });

    const unsubError = session.on('session.error', (event) => {
      clearTimeout(timeoutId);
      unsubIdle();
      unsubError();
      reject(new Error(String(event.data.message ?? 'Session error')));
    });

    // Send AFTER registering handlers (race-condition safe)
    void session.send(options);
  });
}
