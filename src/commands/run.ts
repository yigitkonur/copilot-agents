/**
 * The `run` command — send a prompt to GitHub Copilot and display the response.
 *
 * Supports streaming and blocking modes, prompt from file / inline / stdin,
 * file attachments, session persistence (resume), read-only mode,
 * agent mode control (interactive / plan / autopilot), steering, and compaction.
 *
 * Event handlers are registered BEFORE `session.send()` to avoid race conditions.
 * @module
 */

import { Command } from 'commander';

import type {
  CopilotSession,
  AssistantMessageEvent,
  Tool,
  MessageOptions,
  SystemMessageConfig,
  SystemMessageAppendConfig,
  SystemMessageReplaceConfig,
} from '@github/copilot-sdk';

import { ExitCode, isReasoningEffort } from '../types.js';
import type { ReasoningEffort } from '../types.js';
import type { MCPServerConfig as SDKMCPServerConfig } from '@github/copilot-sdk';
import { toAppError } from '../errors.js';
import { clientManager } from '../core/client-manager.js';
import { createInteractivePermissionHandler, createReadOnlyPermissionHandler } from '../handlers/permission.js';
import { createStreamingEventHandler, createQuietEventHandler } from '../handlers/events.js';
import { createSessionHooks, createAutoUserInputHandler } from '../handlers/hooks.js';
import { detectPromptSource, loadPrompt } from '../utils/prompt-loader.js';
import { loadToolDefinitions, createPassthroughTool } from '../utils/tool-builder.js';
import { createLogger, LogSeverity } from '../utils/logger.js';

import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// CLI option shape
// ---------------------------------------------------------------------------

/** Valid agent mode values for --mode. */
type AgentMode = 'interactive' | 'plan' | 'autopilot';

/** Valid steering modes for --steering. */
type SteeringMode = 'enqueue' | 'immediate';

/** Valid system message modes for --system-message-mode. */
type SystemMessageMode = 'append' | 'replace';

interface RunOptions {
  readonly prompt?: string;
  readonly file?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly stream: boolean;
  readonly timeout: string;
  readonly sessionId?: string;
  readonly resume?: boolean;
  readonly agent?: string;
  readonly reasoningEffort?: string;
  readonly systemMessage?: string;
  readonly systemMessageMode?: string;
  readonly attach?: readonly string[];
  readonly readOnly?: boolean;
  readonly verbose?: boolean;
  // SDK features:
  readonly mcpServer?: readonly string[];
  readonly toolFile?: readonly string[];
  readonly availableTool?: readonly string[];
  readonly excludeTool?: readonly string[];
  readonly skillDir?: readonly string[];
  readonly disableSkill?: readonly string[];
  readonly configDir?: string;
  readonly infiniteSessions?: boolean;
  readonly provider?: string;
  // New features:
  readonly mode?: string;
  readonly plan?: boolean;
  readonly steering?: string;
  readonly compact?: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isAgentMode(value: string): value is AgentMode {
  return value === 'interactive' || value === 'plan' || value === 'autopilot';
}

function isSteeringMode(value: string): value is SteeringMode {
  return value === 'enqueue' || value === 'immediate';
}

function isSystemMessageMode(value: string): value is SystemMessageMode {
  return value === 'append' || value === 'replace';
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
): Record<string, SDKMCPServerConfig> | undefined {
  if (!rawSpecs || rawSpecs.length === 0) return undefined;

  const servers: Record<string, SDKMCPServerConfig> = {};

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
// System message builder
// ---------------------------------------------------------------------------

function buildSystemMessageConfig(
  content: string | undefined,
  mode: SystemMessageMode,
): SystemMessageConfig | undefined {
  if (!content) return undefined;

  if (mode === 'replace') {
    return { mode: 'replace', content } satisfies SystemMessageReplaceConfig;
  }
  return { mode: 'append', content } satisfies SystemMessageAppendConfig;
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createRunCommand(): Command {
  const cmd = new Command('run')
    .description('Send a prompt to GitHub Copilot')
    .option('-p, --prompt <text>', 'Prompt text (inline)')
    .option('-f, --file <path>', 'Load prompt from file (.txt, .md)')
    .option('-m, --model <model>', 'Model to use (e.g., gpt-4.1, gpt-5, claude-sonnet-4.5)')
    .option('-d, --cwd <dir>', 'Working directory for the session', process.cwd())
    .option('-s, --stream', 'Enable streaming output', true)
    .option('--no-stream', 'Disable streaming (wait for full response)')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '120000')
    .option('--session-id <id>', 'Session ID for persistence/resume')
    .option('--resume', 'Resume an existing session')
    .option('--agent <name>', 'Activate a custom agent')
    .option('--reasoning-effort <level>', 'Reasoning effort: low, medium, high, xhigh')
    .option('--system-message <text>', 'Additional system message to append')
    .option('--system-message-mode <mode>', 'System message mode: append (default) or replace', 'append')
    .option('--attach <files...>', 'Attach files to the prompt')
    .option('--read-only', 'Read-only mode (deny write/shell permissions)')
    .option('-v, --verbose', 'Verbose output (show tool execution, debug info)')
    .option('--mcp-server <name:command...>', 'MCP server in name:command:arg1:arg2 format (repeatable)')
    .option('--tool-file <path...>', 'Load tool definitions from JSON file (repeatable)')
    .option('--available-tool <name...>', 'Allowlist specific tools (repeatable)')
    .option('--exclude-tool <name...>', 'Exclude specific tools (repeatable)')
    .option('--skill-dir <path...>', 'Load skills from directory (repeatable)')
    .option('--disable-skill <name...>', 'Disable specific skills (repeatable)')
    .option('--config-dir <path>', 'Custom config directory')
    .option('--infinite-sessions', 'Enable infinite sessions (auto-compaction)')
    .option('--provider <url>', 'BYOK provider base URL')
    .option('--mode <mode>', 'Agent mode: interactive, plan, or autopilot')
    .option('--plan', 'Plan-then-execute: plan first, then switch to autopilot on confirmation')
    .option('--steering <mode>', 'Message steering mode: enqueue (default) or immediate')
    .option('--compact', 'Compact session history before sending')
    .action(async (options: RunOptions) => {
      await executeRun(options);
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

async function executeRun(options: RunOptions): Promise<void> {
  const logger = createLogger(
    options.verbose ? LogSeverity.Debug : LogSeverity.Info,
  );

  // 1. Detect and load prompt source
  const prompt = resolvePrompt(options, logger);
  const promptText = await prompt;
  const timeout = parseTimeout(options.timeout, logger);

  // 2. Get client (race-condition safe via ClientManager)
  const client = await getClient(options, logger);

  // 3. Resolve system message config
  const sysMsgMode: SystemMessageMode =
    options.systemMessageMode && isSystemMessageMode(options.systemMessageMode)
      ? options.systemMessageMode
      : 'append';
  const systemMessage = buildSystemMessageConfig(options.systemMessage, sysMsgMode);

  // 4. Create or resume session
  const session = await openSession(options, client, systemMessage, logger);

  // 5. CRITICAL: Register event handlers BEFORE sending (race-condition safe)
  const eventHandler = options.stream
    ? createStreamingEventHandler(logger)
    : createQuietEventHandler(logger);

  session.on(eventHandler);

  // 6. Pre-send RPC calls (mode, compact)
  await applyPreSendRpc(session, options, logger);

  // 7. Build attachments and message options
  const attachments = buildAttachments(options.attach);
  const steeringMode: SteeringMode | undefined =
    options.steering && isSteeringMode(options.steering) ? options.steering : undefined;

  const messageOptions: MessageOptions = {
    prompt: promptText,
    attachments: attachments ?? undefined,
    mode: steeringMode,
  };

  // 8. Send and wait
  try {
    if (options.plan) {
      await runPlanThenExecute(session, messageOptions, timeout, logger);
    } else if (options.stream) {
      await runStreaming(session, messageOptions, timeout, logger);
    } else {
      await runBlocking(session, messageOptions, timeout, logger);
    }
  } catch (error: unknown) {
    const appErr = toAppError(error);
    logger.error(`Error: ${appErr.message}`);
    process.exit(appErr.exitCode);
  } finally {
    // 9. Always cleanup
    try {
      await session.disconnect();
    } catch {
      // Ignore disconnect errors during cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-send RPC calls
// ---------------------------------------------------------------------------

async function applyPreSendRpc(
  session: CopilotSession,
  options: RunOptions,
  logger: Logger,
): Promise<void> {
  // Set agent mode via RPC if requested
  if (options.mode && isAgentMode(options.mode)) {
    try {
      const result = await session.rpc.mode.set({ mode: options.mode });
      logger.debug(`Agent mode set to: ${result.mode}`);
    } catch (err: unknown) {
      logger.warn(`Failed to set agent mode: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Compact session history before sending
  if (options.compact) {
    try {
      const result = await session.rpc.compaction.compact();
      logger.debug(
        `Compaction: freed ${String(result.tokensRemoved)} tokens, removed ${String(result.messagesRemoved)} messages`,
      );
    } catch (err: unknown) {
      logger.warn(`Failed to compact session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt resolution
// ---------------------------------------------------------------------------

async function resolvePrompt(
  options: RunOptions,
  logger: Logger,
): Promise<string> {
  const sourceResult = detectPromptSource({
    prompt: options.prompt,
    file: options.file,
  });

  if (!sourceResult.success) {
    logger.error(sourceResult.error.message);
    process.exit(ExitCode.PromptError);
  }

  const promptResult = await loadPrompt(sourceResult.data);

  if (!promptResult.success) {
    logger.error(promptResult.error.message);
    process.exit(ExitCode.PromptError);
  }

  return promptResult.data;
}

// ---------------------------------------------------------------------------
// Timeout parsing
// ---------------------------------------------------------------------------

function parseTimeout(raw: string, logger: Logger): number {
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.error(`Invalid timeout value: ${raw}`);
    process.exit(ExitCode.GeneralError);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Client acquisition
// ---------------------------------------------------------------------------

async function getClient(
  options: RunOptions,
  logger: Logger,
): ReturnType<typeof clientManager.getClient> {
  try {
    return await clientManager.getClient({ cwd: options.cwd });
  } catch (error: unknown) {
    const appErr = toAppError(error);
    logger.error(`Failed to connect: ${appErr.message}`);
    process.exit(appErr.exitCode);
  }
}

// ---------------------------------------------------------------------------
// Session open / resume
// ---------------------------------------------------------------------------

async function openSession(
  options: RunOptions,
  client: Awaited<ReturnType<typeof clientManager.getClient>>,
  systemMessage: SystemMessageConfig | undefined,
  logger: Logger,
): Promise<CopilotSession> {
  const permissionHandler = options.readOnly
    ? createReadOnlyPermissionHandler(logger)
    : createInteractivePermissionHandler(logger);

  const hooks = createSessionHooks({
    logger,
    verbose: options.verbose ?? false,
  });

  const userInputHandler = createAutoUserInputHandler();

  const reasoningEffort: ReasoningEffort | undefined =
    options.reasoningEffort && isReasoningEffort(options.reasoningEffort)
      ? options.reasoningEffort
      : undefined;

  const mcpServers = parseMcpServers(options.mcpServer);
  const provider = options.provider ? { baseUrl: options.provider } : undefined;

  // Load custom tools from files
  let tools: Tool<unknown>[] | undefined;
  if (options.toolFile && options.toolFile.length > 0) {
    tools = [];
    for (const filePath of options.toolFile) {
      const result = await loadToolDefinitions(filePath);
      if (!result.success) {
        logger.error(`Failed to load tools from ${filePath}: ${result.error.message}`);
        process.exit(ExitCode.PromptError);
      }
      for (const def of result.data) {
        tools.push(createPassthroughTool(def));
      }
    }
    if (tools.length === 0) tools = undefined;
  }

  try {
    if (options.resume && options.sessionId) {
      const session = await client.resumeSession(options.sessionId, {
        onPermissionRequest: permissionHandler,
        onUserInputRequest: userInputHandler,
        hooks,
        streaming: options.stream,
        model: options.model,
        workingDirectory: options.cwd,
        reasoningEffort,
        mcpServers,
        tools,
        availableTools: options.availableTool ? [...options.availableTool] : undefined,
        excludedTools: options.excludeTool ? [...options.excludeTool] : undefined,
        skillDirectories: options.skillDir ? [...options.skillDir] : undefined,
        disabledSkills: options.disableSkill ? [...options.disableSkill] : undefined,
        configDir: options.configDir,
        infiniteSessions: options.infiniteSessions !== undefined ? { enabled: options.infiniteSessions } : undefined,
        provider,
        systemMessage,
      });
      logger.info(`Resumed session: ${options.sessionId}`);
      return session;
    }

    const session = await client.createSession({
      sessionId: options.sessionId,
      model: options.model,
      reasoningEffort,
      workingDirectory: options.cwd ?? process.cwd(),
      onPermissionRequest: permissionHandler,
      onUserInputRequest: userInputHandler,
      hooks,
      streaming: options.stream,
      systemMessage,
      mcpServers,
      tools,
      availableTools: options.availableTool ? [...options.availableTool] : undefined,
      excludedTools: options.excludeTool ? [...options.excludeTool] : undefined,
      skillDirectories: options.skillDir ? [...options.skillDir] : undefined,
      disabledSkills: options.disableSkill ? [...options.disableSkill] : undefined,
      configDir: options.configDir,
      infiniteSessions: options.infiniteSessions !== undefined ? { enabled: options.infiniteSessions } : undefined,
      provider,
    });

    logger.debug(`Created session: ${session.sessionId}`);
    return session;
  } catch (error: unknown) {
    const appErr = toAppError(error);
    logger.error(`Session creation failed: ${appErr.message}`);
    process.exit(appErr.exitCode);
  }
}

// ---------------------------------------------------------------------------
// Attachment builder
// ---------------------------------------------------------------------------

function buildAttachments(
  paths: readonly string[] | undefined,
): Array<{ type: 'file'; path: string }> | undefined {
  if (!paths || paths.length === 0) return undefined;
  return paths.map((filePath) => ({ type: 'file' as const, path: filePath }));
}

// ---------------------------------------------------------------------------
// Abort helper — aborts in-flight work then disconnects
// ---------------------------------------------------------------------------

async function abortSession(session: CopilotSession, logger: Logger): Promise<void> {
  try {
    await session.abort();
    logger.debug('Session aborted');
  } catch (err: unknown) {
    logger.warn(`Abort failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Streaming mode
// ---------------------------------------------------------------------------

async function runStreaming(
  session: CopilotSession,
  messageOptions: MessageOptions,
  timeout: number,
  logger: Logger,
): Promise<void> {
  const idlePromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      // Abort on timeout rather than just rejecting
      void abortSession(session, logger).finally(() => {
        reject(new Error(`Timeout after ${String(timeout)}ms waiting for response`));
      });
    }, timeout);

    session.on('session.idle', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    session.on('session.error', (event) => {
      clearTimeout(timeoutId);
      reject(new Error(String(event.data.message ?? 'Session error')));
    });
  });

  await session.send(messageOptions);
  logger.debug('Message sent, waiting for completion...');
  await idlePromise;
}

// ---------------------------------------------------------------------------
// Blocking (non-streaming) mode
// ---------------------------------------------------------------------------

async function runBlocking(
  session: CopilotSession,
  messageOptions: MessageOptions,
  timeout: number,
  _logger: Logger,
): Promise<void> {
  const response: AssistantMessageEvent | undefined =
    await session.sendAndWait(messageOptions, timeout);

  if (response) {
    process.stdout.write(`${response.data.content}\n`);
  }
}

// ---------------------------------------------------------------------------
// Plan-then-execute mode
// ---------------------------------------------------------------------------

async function runPlanThenExecute(
  session: CopilotSession,
  messageOptions: MessageOptions,
  timeout: number,
  logger: Logger,
): Promise<void> {
  // Step 1: Set plan mode
  try {
    await session.rpc.mode.set({ mode: 'plan' });
    logger.debug('Agent mode set to: plan');
  } catch (err: unknown) {
    logger.warn(`Failed to set plan mode: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: Send the prompt and wait for plan to be ready (exit_plan_mode.requested)
  const planPhasePromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      void abortSession(session, logger).finally(() => {
        reject(new Error(`Timeout after ${String(timeout)}ms waiting for plan`));
      });
    }, timeout);

    session.on('exit_plan_mode.requested', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    session.on('session.error', (event) => {
      clearTimeout(timeoutId);
      reject(new Error(String(event.data.message ?? 'Session error during planning')));
    });

    // Also resolve on idle in case the model finishes planning without the event
    session.on('session.idle', () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });

  await session.send(messageOptions);
  logger.debug('Plan-mode message sent, waiting for plan...');
  await planPhasePromise;

  // Step 3: Switch to autopilot and let the agent execute
  try {
    await session.rpc.mode.set({ mode: 'autopilot' });
    logger.debug('Agent mode switched to: autopilot');
  } catch (err: unknown) {
    logger.warn(`Failed to switch to autopilot: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Wait for execution to complete
  const executePromise = new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      void abortSession(session, logger).finally(() => {
        reject(new Error(`Timeout after ${String(timeout)}ms waiting for execution`));
      });
    }, timeout);

    session.on('session.idle', () => {
      clearTimeout(timeoutId);
      resolve();
    });

    session.on('session.error', (event) => {
      clearTimeout(timeoutId);
      reject(new Error(String(event.data.message ?? 'Session error during execution')));
    });
  });

  await executePromise;
  logger.debug('Plan execution completed');
}
