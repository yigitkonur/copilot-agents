/**
 * `sessions` command — list, delete, and manage Copilot sessions.
 * @module
 */

import { Command } from 'commander';
import type { SessionListFilter } from '@github/copilot-sdk';

import { clientManager, approveAll } from '../core/client-manager.js';
import { toAppError } from '../errors.js';
import { createLogger, LogSeverity } from '../utils/logger.js';
import { formatTable, truncate } from '../utils/format.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resume a session briefly, run an async callback, then disconnect. */
async function withResumedSession<T>(
  sessionId: string,
  fn: (session: import('@github/copilot-sdk').CopilotSession) => Promise<T>,
): Promise<T> {
  const client = await clientManager.getClient();
  const session = await client.resumeSession(sessionId, {
    onPermissionRequest: approveAll,
    disableResume: true,
  });
  try {
    return await fn(session);
  } finally {
    await session.disconnect();
  }
}

export function createSessionsCommand(): Command {
  const cmd = new Command('sessions').description('Manage Copilot sessions');

  // Sub-command: list
  cmd
    .command('list')
    .description('List saved sessions')
    .option('--cwd <dir>', 'Filter by working directory')
    .option('--repo <owner/repo>', 'Filter by repository')
    .option('--branch <branch>', 'Filter by branch')
    .option('--json', 'Output as JSON')
    .action(
      async (options: {
        cwd?: string;
        repo?: string;
        branch?: string;
        json?: boolean;
      }) => {
        const logger = createLogger(LogSeverity.Info);

        try {
          const client = await clientManager.getClient();

          const filter: SessionListFilter = {};
          if (options.cwd) filter.cwd = options.cwd;
          if (options.repo) filter.repository = options.repo;
          if (options.branch) filter.branch = options.branch;

          const hasFilter = Object.keys(filter).length > 0;
          const sessions = await client.listSessions(
            hasFilter ? filter : undefined,
          );

          if (options.json) {
            console.log(JSON.stringify(sessions, null, 2));
            return;
          }

          if (sessions.length === 0) {
            logger.info('No sessions found');
            return;
          }

          const headers = ['Session ID', 'Summary', 'Modified', 'CWD'];
          const rows = sessions.map((s) => [
            truncate(s.sessionId, 36),
            truncate(s.summary ?? '(no summary)', 40),
            s.modifiedTime.toLocaleString(),
            truncate(s.context?.cwd ?? '', 30),
          ]);

          console.log(formatTable(headers, rows));
          logger.info(`${String(sessions.length)} session(s)`);
        } catch (error: unknown) {
          const appErr = toAppError(error);
          logger.error(appErr.message);
          process.exit(appErr.exitCode);
        } finally {
          await clientManager.stop();
        }
      },
    );

  // Sub-command: delete
  cmd
    .command('delete <sessionId>')
    .description('Delete a saved session')
    .action(async (sessionId: string) => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const client = await clientManager.getClient();
        await client.deleteSession(sessionId);
        logger.success(`Deleted session: ${sessionId}`);
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  // Sub-command: last
  cmd
    .command('last')
    .description('Show the last session ID')
    .action(async () => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const client = await clientManager.getClient();
        const lastId = await client.getLastSessionId();
        if (lastId) {
          console.log(lastId);
        } else {
          logger.info('No previous session found');
        }
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  // Sub-command: history
  cmd
    .command('history <sessionId>')
    .description('Show conversation history for a session')
    .option('--json', 'Output as JSON')
    .option('--format <format>', 'Output format (text or json)', 'text')
    .action(async (sessionId: string, options: { json?: boolean; format?: string }) => {
      const logger = createLogger(LogSeverity.Info);
      const useJson = options.json === true || options.format === 'json';

      try {
        const messages = await withResumedSession(sessionId, async (session) =>
          session.getMessages(),
        );

        if (useJson) {
          console.log(JSON.stringify(messages, null, 2));
        } else {
          if (messages.length === 0) {
            logger.info('No messages in this session');
          } else {
            for (const msg of messages) {
              const { type, data } = msg;
              if (type === 'assistant.message') {
                const content = 'content' in data ? String(data.content) : '';
                console.log(`\x1b[32m[assistant]\x1b[0m ${content}`);
              } else if (type === 'user.message') {
                const prompt = 'prompt' in data ? String(data.prompt) : '';
                console.log(`\x1b[36m[user]\x1b[0m ${prompt}`);
              } else {
                console.log(`\x1b[90m[${type}]\x1b[0m`);
              }
            }
            logger.info(`\n${String(messages.length)} event(s)`);
          }
        }
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  // Sub-command: abort
  cmd
    .command('abort <sessionId>')
    .description('Abort a running session')
    .action(async (sessionId: string) => {
      const logger = createLogger(LogSeverity.Info);
      try {
        await withResumedSession(sessionId, async (session) => {
          await session.abort();
        });
        logger.success(`Aborted session: ${sessionId}`);
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  // Sub-command: plan
  cmd
    .command('plan <sessionId>')
    .description('Show the current plan for a session')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const plan = await withResumedSession(sessionId, async (session) =>
          session.rpc.plan.read(),
        );

        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
          return;
        }

        if (!plan.exists || plan.content == null) {
          logger.info('No plan exists for this session');
        } else {
          console.log(plan.content);
          if (plan.path) {
            logger.debug(`Plan file: ${plan.path}`);
          }
        }
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  // Sub-command: agents
  cmd
    .command('agents <sessionId>')
    .description('List available agents for a session')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const result = await withResumedSession(sessionId, async (session) =>
          session.rpc.agent.list(),
        );

        if (options.json) {
          console.log(JSON.stringify(result.agents, null, 2));
          return;
        }

        if (result.agents.length === 0) {
          logger.info('No agents available');
        } else {
          const headers = ['Name', 'Display Name', 'Description'];
          const rows = result.agents.map((a) => [
            a.name,
            a.displayName,
            truncate(a.description, 50),
          ]);
          console.log(formatTable(headers, rows));
          logger.info(`${String(result.agents.length)} agent(s)`);
        }
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  // Sub-command group: workspace
  const workspaceCmd = new Command('workspace').description('Manage session workspace files');

  workspaceCmd
    .command('list <sessionId>')
    .description('List files in the session workspace')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, options: { json?: boolean }) => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const result = await withResumedSession(sessionId, async (session) =>
          session.rpc.workspace.listFiles(),
        );

        if (options.json) {
          console.log(JSON.stringify(result.files, null, 2));
          return;
        }

        if (result.files.length === 0) {
          logger.info('No files in workspace');
        } else {
          for (const file of result.files) {
            console.log(file);
          }
          logger.info(`${String(result.files.length)} file(s)`);
        }
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  workspaceCmd
    .command('read <sessionId> <path>')
    .description('Read a file from the session workspace')
    .action(async (sessionId: string, path: string) => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const result = await withResumedSession(sessionId, async (session) =>
          session.rpc.workspace.readFile({ path }),
        );
        console.log(result.content);
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });

  cmd.addCommand(workspaceCmd);

  return cmd;
}
