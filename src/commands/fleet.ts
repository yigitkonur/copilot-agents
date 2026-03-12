/**
 * Fleet command — run multiple prompts in parallel across separate sessions.
 *
 * Uses a concurrency-limited Promise pool so we don't overwhelm the CLI
 * server, with full error isolation per task. Supports fleet RPC mode
 * and agent management.
 * @module
 */

import { Command } from 'commander';
import { basename } from 'node:path';

import type {
  CopilotSession,
  MCPLocalServerConfig as SDKMCPLocalServerConfig,
  MessageOptions,
} from '@github/copilot-sdk';

import type { FleetTask, FleetResult } from '../types.js';
import type { FleetTaskStatus } from '../types.js';
import { ExitCode } from '../types.js';
import { toAppError } from '../errors.js';
import { clientManager, approveAll } from '../core/client-manager.js';
import { createProgressEventHandler } from '../handlers/events.js';
import { createSessionHooks, createAutoUserInputHandler } from '../handlers/hooks.js';
import { loadPromptFiles, loadPrompt } from '../utils/prompt-loader.js';
import { createLogger, LogSeverity } from '../utils/logger.js';
import { formatTable, formatDuration, truncate } from '../utils/format.js';

// ---------------------------------------------------------------------------
// CLI option shape (commander passes everything as strings)
// ---------------------------------------------------------------------------

interface FleetCommandOptions {
  readonly model?: string;
  readonly cwd: string;
  readonly concurrency: string;
  readonly timeout: string;
  readonly verbose?: boolean;
  readonly mcpServer?: readonly string[];
  readonly skillDir?: readonly string[];
  readonly agent?: string;
  readonly useFleetRpc?: boolean;
  readonly listAgents?: boolean;
}

// ---------------------------------------------------------------------------
// MCP server spec parser
// ---------------------------------------------------------------------------

/**
 * Parse MCP server string format: "name:command:arg1:arg2:..."
 * Returns a record of server name → MCPLocalServerConfig.
 */
function parseMcpServers(
  rawSpecs: readonly string[] | undefined,
): Record<string, SDKMCPLocalServerConfig> | undefined {
  if (!rawSpecs || rawSpecs.length === 0) return undefined;

  const servers: Record<string, SDKMCPLocalServerConfig> = {};

  for (const spec of rawSpecs) {
    const parts = spec.split(':');
    const name = parts[0];
    const command = parts[1];
    const args = parts.slice(2);

    if (!name || !command) {
      throw new Error(`Invalid MCP server spec: "${spec}" — expected name:command[:arg1:arg2:...]`);
    }

    servers[name] = {
      type: 'local',
      command,
      args,
      tools: ['*'],
    };
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Mutable task state — internal only.
// FleetTask is readonly; we track mutable progress here and snapshot at the end.
// ---------------------------------------------------------------------------

interface MutableFleetTask {
  readonly id: string;
  readonly promptFile: string;
  status: FleetTaskStatus;
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createFleetCommand(): Command {
  return new Command('fleet')
    .description('Run multiple prompts in parallel across separate sessions')
    .argument('<files...>', 'Prompt files or directories to run (.txt, .md)')
    .option('-m, --model <model>', 'Model to use for all sessions')
    .option('-d, --cwd <dir>', 'Working directory', process.cwd())
    .option('-c, --concurrency <n>', 'Max concurrent sessions', '5')
    .option('-t, --timeout <ms>', 'Timeout per session in ms', '300000')
    .option('-v, --verbose', 'Verbose output')
    .option('--mcp-server <name:command...>', 'MCP server in name:command:arg1:arg2 format')
    .option('--skill-dir <path...>', 'Load skills from directory')
    .option('--agent <name>', 'Activate a custom agent for all tasks')
    .option('--use-fleet-rpc', 'Use session.rpc.fleet.start() instead of manual parallel execution')
    .option('--list-agents', 'List available agents and exit')
    .action(async (files: string[], options: FleetCommandOptions) => {
      await executeFleet(files, options);
    });
}

// ---------------------------------------------------------------------------
// Abort helper — aborts in-flight session work
// ---------------------------------------------------------------------------

async function abortSession(session: CopilotSession, logger: ReturnType<typeof createLogger>): Promise<void> {
  try {
    await session.abort();
    logger.debug('Session aborted');
  } catch (err: unknown) {
    logger.warn(`Abort failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

async function executeFleet(
  files: readonly string[],
  options: FleetCommandOptions,
): Promise<void> {
  const verbose = options.verbose ?? false;
  const logger = createLogger(verbose ? LogSeverity.Debug : LogSeverity.Info);
  const concurrency = Math.max(1, parseInt(options.concurrency, 10) || 5);
  const timeout = parseInt(options.timeout, 10) || 300_000;
  const startTime = Date.now();

  // -- Connect to Copilot CLI server ----------------------------------------

  const client = await (async () => {
    try {
      return await clientManager.getClient({ cwd: options.cwd });
    } catch (error: unknown) {
      const appErr = toAppError(error);
      logger.error(`Failed to connect: ${appErr.message}`);
      return process.exit(appErr.exitCode);
    }
  })();

  // -- Handle --list-agents: list agents and exit ---------------------------

  if (options.listAgents) {
    await listAgentsAndExit(client, options, logger);
    return;
  }

  // -- Resolve and validate prompt files ------------------------------------

  const filesResult = await loadPromptFiles(files);
  if (!filesResult.success) {
    logger.error(filesResult.error.message);
    process.exit(ExitCode.PromptError);
  }

  const resolvedFiles = filesResult.data;
  logger.info(`Fleet: ${String(resolvedFiles.length)} task(s), concurrency: ${String(concurrency)}`);

  // -- Build task list ------------------------------------------------------

  const tasks: MutableFleetTask[] = resolvedFiles.map((file, i) => ({
    id: `task-${String(i + 1)}`,
    promptFile: file,
    status: 'pending' as const,
  }));

  // -- Per-task runner -------------------------------------------------------

  const runTask = async (task: MutableFleetTask): Promise<void> => {
    task.status = 'running';
    task.startedAt = new Date();
    logger.info(`[${task.id}] Starting: ${basename(task.promptFile)}`);

    let session: CopilotSession | undefined;
    try {
      // Load prompt content
      const promptResult = await loadPrompt({ kind: 'file', path: task.promptFile });
      if (!promptResult.success) {
        throw promptResult.error;
      }

      // Create an isolated session for this task
      const mcpServers = parseMcpServers(options.mcpServer);

      session = await client.createSession({
        model: options.model,
        workingDirectory: options.cwd,
        onPermissionRequest: approveAll,
        onUserInputRequest: createAutoUserInputHandler(),
        hooks: createSessionHooks({ logger, verbose }),
        mcpServers,
        skillDirectories: options.skillDir ? [...options.skillDir] : undefined,
        customAgents: options.agent
          ? [{ name: options.agent, prompt: '', infer: true }]
          : undefined,
      });

      // Select agent via RPC if specified
      if (options.agent) {
        try {
          await session.rpc.agent.select({ name: options.agent });
          logger.debug(`[${task.id}] Agent selected: ${options.agent}`);
        } catch (err: unknown) {
          logger.debug(`[${task.id}] Agent selection via RPC skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Register progress handler BEFORE sending (race-condition safe)
      const unsubscribe = session.on(createProgressEventHandler(task.id, logger));

      // Build MessageOptions for task sending
      const messageOptions: MessageOptions = { prompt: promptResult.data };

      if (options.useFleetRpc) {
        // Use fleet RPC: start fleet mode, then wait for idle
        await runFleetRpcTask(session, messageOptions, timeout, task, logger);
      } else {
        // Standard: sendAndWait with abort on timeout
        await runStandardTask(session, messageOptions, timeout, task, logger);
      }

      unsubscribe();
    } catch (error: unknown) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = new Date();
      logger.error(`[${task.id}] Failed: ${task.error}`);
    } finally {
      if (session) {
        try {
          await session.disconnect();
        } catch (_disconnectError: unknown) {
        }
      }
    }
  };

  // -- Standard task execution (sendAndWait with abort on timeout) ----------

  async function runStandardTask(
    session: CopilotSession,
    messageOptions: MessageOptions,
    taskTimeout: number,
    task: MutableFleetTask,
    taskLogger: ReturnType<typeof createLogger>,
  ): Promise<void> {
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      void abortSession(session, taskLogger);
    }, taskTimeout);

    try {
      const response = await session.sendAndWait(messageOptions, taskTimeout);

      clearTimeout(timeoutId);

      if (timedOut) {
        throw new Error(`Task timed out after ${String(taskTimeout)}ms`);
      }

      task.status = 'completed';
      task.result = response?.data.content ?? '(no response)';
      task.completedAt = new Date();
      taskLogger.success(`[${task.id}] Completed: ${basename(task.promptFile)}`);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // -- Fleet RPC task execution ---------------------------------------------

  async function runFleetRpcTask(
    session: CopilotSession,
    messageOptions: MessageOptions,
    taskTimeout: number,
    task: MutableFleetTask,
    taskLogger: ReturnType<typeof createLogger>,
  ): Promise<void> {
    try {
      const fleetResult = await session.rpc.fleet.start({ prompt: messageOptions.prompt });
      if (!fleetResult.started) {
        throw new Error('Fleet RPC start returned started=false');
      }
      taskLogger.debug(`[${task.id}] Fleet RPC started`);
    } catch (err: unknown) {
      throw new Error(`Fleet RPC start failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Wait for session.idle with abort on timeout
    const idlePromise = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        void abortSession(session, taskLogger).finally(() => {
          reject(new Error(`Fleet task timed out after ${String(taskTimeout)}ms`));
        });
      }, taskTimeout);

      session.on('session.idle', () => {
        clearTimeout(timeoutId);
        resolve();
      });

      session.on('session.error', (event) => {
        clearTimeout(timeoutId);
        reject(new Error(String(event.data.message ?? 'Session error')));
      });
    });

    await idlePromise;

    // Get final messages to extract result
    try {
      const messages = await session.getMessages();
      const lastAssistant = messages
        .filter((m): m is Extract<typeof m, { type: 'assistant.message' }> => m.type === 'assistant.message')
        .at(-1);
      task.result = lastAssistant?.data.content ?? '(no response)';
    } catch (_msgError: unknown) {
    }

    task.status = 'completed';
    task.completedAt = new Date();
    taskLogger.success(`[${task.id}] Completed (fleet RPC): ${basename(task.promptFile)}`);
  }

  // -- Concurrency-limited pool execution (error-isolated) ------------------

  const pool: Promise<void>[] = [];
  let taskIndex = 0;

  const scheduleNext = (): Promise<void> | undefined => {
    if (taskIndex >= tasks.length) return undefined;
    const task = tasks[taskIndex];
    if (!task) return undefined;
    taskIndex++;
    // Each task is wrapped to never reject — errors are captured on the task object
    const promise = runTask(task).catch((err: unknown) => {
      // Safety net: should not happen since runTask catches internally
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = new Date();
    }).then(() => {
      const idx = pool.indexOf(promise);
      if (idx >= 0) pool.splice(idx, 1);
      const next = scheduleNext();
      if (next) pool.push(next);
    });
    return promise;
  };

  // Start the initial batch up to the concurrency limit
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    const p = scheduleNext();
    if (p) pool.push(p);
  }

  // Wait for every task to settle
  await Promise.all(pool);

  // -- Summary --------------------------------------------------------------

  const totalDuration = Date.now() - startTime;
  const succeeded = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;

  const result: FleetResult = {
    tasks: tasks.map((t) => ({ ...t })),
    totalDuration,
    succeeded,
    failed,
  };

  console.log(`\n${'─'.repeat(60)}`);
  logger.info(`Fleet completed in ${formatDuration(result.totalDuration)}`);
  logger.info(`  ✓ Succeeded: ${String(result.succeeded)}/${String(tasks.length)}`);
  if (result.failed > 0) {
    logger.warn(`  ✗ Failed: ${String(result.failed)}/${String(tasks.length)}`);
  }

  // Results table
  const headers = ['Task', 'File', 'Status', 'Duration', 'Result'];
  const rows: (readonly string[])[] = tasks.map((t) => [
    t.id,
    basename(t.promptFile),
    t.status,
    t.startedAt && t.completedAt
      ? formatDuration(t.completedAt.getTime() - t.startedAt.getTime())
      : '-',
    t.status === 'completed'
      ? truncate(t.result ?? '', 40)
      : truncate(t.error ?? '', 40),
  ]);
  console.log(formatTable(headers, rows));

  // -- Cleanup --------------------------------------------------------------

  await clientManager.stop();

  if (result.failed > 0) {
    process.exit(ExitCode.GeneralError);
  }
}

// ---------------------------------------------------------------------------
// List agents helper
// ---------------------------------------------------------------------------

async function listAgentsAndExit(
  client: Awaited<ReturnType<typeof clientManager.getClient>>,
  options: FleetCommandOptions,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  let session: CopilotSession | undefined;
  try {
    session = await client.createSession({
      model: options.model,
      workingDirectory: options.cwd,
      onPermissionRequest: approveAll,
      onUserInputRequest: createAutoUserInputHandler(),
    });

    const result = await session.rpc.agent.list();

    if (result.agents.length === 0) {
      logger.info('No custom agents available.');
    } else {
      logger.info(`Available agents (${String(result.agents.length)}):`);
      const headers = ['Name', 'Display Name', 'Description'];
      const rows: string[][] = result.agents.map((a) => [
        a.name,
        a.displayName,
        truncate(a.description ?? '', 60),
      ]);
      console.log(formatTable(headers, rows));
    }
  } catch (err: unknown) {
    logger.error(`Failed to list agents: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(ExitCode.GeneralError);
  } finally {
    if (session) {
      try {
        await session.disconnect();
      } catch (_cleanupErr: unknown) {
        // Ignore cleanup errors
      }
    }
    await clientManager.stop();
  }
}
