#!/usr/bin/env node
/**
 * Copilot CLI — production-grade, type-safe CLI for the GitHub Copilot SDK.
 *
 * Race-condition safe, parallelizable (fleet mode), with streaming support,
 * session management, and comprehensive error handling.
 * @module
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Command } from 'commander';

import { ExitCode } from './types.js';
import { toAppError } from './errors.js';
import { clientManager } from './core/client-manager.js';
import { createRunCommand } from './commands/run.js';
import { createWhoamiCommand } from './commands/whoami.js';
import { createModelsCommand } from './commands/models.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createFleetCommand } from './commands/fleet.js';
import { createChatCommand } from './commands/chat.js';
import { createLogger, LogSeverity } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Version from package.json
// ---------------------------------------------------------------------------

/** Minimal shape of package.json for version extraction. */
interface PackageJson {
  readonly version: string;
}

/** Runtime type guard for PackageJson. */
function isPackageJson(value: unknown): value is PackageJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof (value as Record<string, unknown>)['version'] === 'string'
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const parsedPkg: unknown = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
);
if (!isPackageJson(parsedPkg)) {
  throw new Error('Invalid package.json: missing "version" field');
}
const pkg: PackageJson = parsedPkg;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLI_NAME = 'copilot-agents';
const CLI_DESCRIPTION =
  'Production-grade CLI for GitHub Copilot SDK — type-safe, parallelizable, race-condition free';

const LOG_LEVEL_CHOICES = ['debug', 'info', 'warn', 'error'] as const;

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

function createProgram(): Command {
  const program = new Command(CLI_NAME)
    .version(pkg.version)
    .description(CLI_DESCRIPTION)
    .option('-v, --verbose', 'Enable verbose/debug output')
    .option(
      '--log-level <level>',
      `Set log level (${LOG_LEVEL_CHOICES.join(', ')})`,
    )
    .option('--no-color', 'Disable ANSI colour output')
    .configureOutput({
      writeErr: (str: string) => process.stderr.write(str),
      writeOut: (str: string) => process.stdout.write(str),
    });

  // Register commands
  program.addCommand(createRunCommand());
  program.addCommand(createWhoamiCommand());
  program.addCommand(createModelsCommand());
  program.addCommand(createSessionsCommand());
  program.addCommand(createFleetCommand());
  program.addCommand(createChatCommand());

  // Health-check command
  program
    .command('ping')
    .description('Check connectivity to the Copilot CLI server')
    .action(async () => {
      const logger = createLogger(LogSeverity.Info);
      try {
        const result = await clientManager.ping();
        const ts = new Date(result.timestamp).toISOString();
        logger.success(`Copilot CLI server is reachable`);
        console.log(`  Response: ${result.message}`);
        console.log(`  Time:     ${ts}`);
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(`Cannot reach Copilot CLI server: ${appErr.message}`);
        process.exit(ExitCode.ConnectionError);
      } finally {
        await clientManager.stop();
      }
    });

  return program;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    const logger = createLogger(LogSeverity.Error);
    const appErr = toAppError(error);
    logger.error(appErr.message);

    // Ensure cleanup
    try {
      await clientManager.stop();
    } catch (_cleanupError: unknown) {
      // Ignore cleanup errors during fatal exit
    }

    process.exit(appErr.exitCode);
  }
}

void main();
