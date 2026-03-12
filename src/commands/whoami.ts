/**
 * `whoami` command — show authenticated user and auth status.
 * @module
 */

import { Command } from 'commander';

import type {
  GetAuthStatusResponse,
  GetStatusResponse,
  ConnectionState,
} from '../types.js';
import { ExitCode } from '../types.js';
import { toAppError } from '../errors.js';
import { clientManager } from '../core/client-manager.js';
import { createLogger, LogSeverity } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  disconnected: '⚫ disconnected',
  connecting: '🟡 connecting',
  connected: '🟢 connected',
  error: '🔴 error',
};

function printAuthDetails(auth: GetAuthStatusResponse): void {
  console.log('\nAuth details:');
  console.log(`  Authenticated: ${String(auth.isAuthenticated)}`);
  console.log(`  Login:         ${auth.login ?? 'n/a'}`);
  console.log(`  Host:          ${auth.host ?? 'github.com'}`);
  console.log(`  Auth type:     ${auth.authType ?? 'unknown'}`);
  if (auth.statusMessage) {
    console.log(`  Status:        ${auth.statusMessage}`);
  }
}

function printServerStatus(status: GetStatusResponse): void {
  console.log('\nServer status:');
  console.log(`  Version:  ${status.version}`);
  console.log(`  Protocol: v${String(status.protocolVersion)}`);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function createWhoamiCommand(): Command {
  return new Command('whoami')
    .description('Show authenticated user and auth status')
    .option('-v, --verbose', 'Show detailed auth info including quota')
    .action(async (options: { verbose?: boolean }) => {
      const logger = createLogger(
        options.verbose ? LogSeverity.Debug : LogSeverity.Info,
      );

      try {
        // Show connection state first
        const connState: ConnectionState = clientManager.getState();
        logger.debug(`Connection state: ${STATE_LABELS[connState]}`);

        const client = await clientManager.getClient();
        const auth: GetAuthStatusResponse = await client.getAuthStatus();

        if (!auth.isAuthenticated) {
          logger.error(
            'Not authenticated. Run `copilot auth login` to sign in.',
          );
          process.exit(ExitCode.AuthError);
        }

        logger.success(`Logged in as: ${auth.login ?? 'unknown'}`);
        console.log(`  Host: ${auth.host ?? 'github.com'}`);
        console.log(`  Auth type: ${auth.authType ?? 'unknown'}`);
        if (auth.statusMessage) {
          console.log(`  Status: ${auth.statusMessage}`);
        }

        if (options.verbose) {
          // Full auth details
          printAuthDetails(auth);

          // Connection state (after getClient, should be connected)
          const currentState: ConnectionState = clientManager.getState();
          console.log(`\nConnection: ${STATE_LABELS[currentState]}`);

          // Client health via ping
          try {
            const pingResult = await clientManager.ping();
            console.log(
              `  Ping:      ${pingResult.message} (${new Date(pingResult.timestamp).toISOString()})`,
            );
          } catch {
            logger.debug('Ping not available');
          }

          // Quota info
          try {
            const quota = await client.rpc.account.getQuota();
            console.log('\nQuota:');
            for (const [key, snapshot] of Object.entries(
              quota.quotaSnapshots,
            )) {
              const pct = String(snapshot.remainingPercentage);
              const used = String(snapshot.usedRequests);
              const total = String(snapshot.entitlementRequests);
              console.log(
                `  ${key}: ${pct}% remaining (${used}/${total} used)`,
              );
              if (snapshot.resetDate) {
                console.log(`    Resets: ${snapshot.resetDate}`);
              }
            }
          } catch {
            logger.debug('Quota info not available');
          }
        }

        const status: GetStatusResponse = await client.getStatus();
        printServerStatus(status);
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });
}
