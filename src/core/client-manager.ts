/**
 * Singleton client manager wrapping {@link CopilotClient} with lifecycle
 * management, race-condition safety, and graceful shutdown.
 * @module
 */

import { CopilotClient, approveAll } from '@github/copilot-sdk';
import type {
  ConnectionState,
  CopilotClientOptions,
  GetAuthStatusResponse,
  GetStatusResponse,
  ModelInfo,
  SessionLifecycleHandler,
  SessionListFilter,
  SessionMetadata,
} from '@github/copilot-sdk';

import type { Result } from '../types.js';
import { ConnectionError } from '../errors.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for initialising the underlying {@link CopilotClient}. */
interface ClientManagerOptions {
  readonly cliPath?: string;
  readonly cliArgs?: string[];
  readonly cliUrl?: string;
  readonly githubToken?: string;
  readonly logLevel?: CopilotClientOptions['logLevel'];
  readonly cwd?: string;
  readonly port?: number;
  readonly useStdio?: boolean;
  readonly isChildProcess?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly useLoggedInUser?: boolean;
  readonly autoStart?: boolean;
  readonly autoRestart?: boolean;
}

// ---------------------------------------------------------------------------
// Shutdown helpers
// ---------------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Module-level reference to the client that shutdown handlers should act on.
 * Updated each time a new client is created so the (once-registered) handlers
 * always target the most recent client.
 */
let shutdownClient: { stop(): Promise<unknown>; forceStop(): Promise<void> } | null = null;

/** Module-level flag — signal handlers are registered at most once per process. */
let shutdownHandlersRegistered = false;

// ---------------------------------------------------------------------------
// ClientManager
// ---------------------------------------------------------------------------

class ClientManager {
  private client: CopilotClient | null = null;

  /** Prevents multiple concurrent `start()` calls. */
  private connectPromise: Promise<CopilotClient> | null = null;

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /** Get or create a connected client (race-condition safe). */
  async getClient(options?: ClientManagerOptions): Promise<CopilotClient> {
    // Already connected — fast path.
    if (this.client) return this.client;

    // Another caller is already connecting — join the same promise.
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.createClient(options);
    try {
      this.client = await this.connectPromise;
      return this.client;
    } finally {
      this.connectPromise = null;
    }
  }

  /** Instantiate, start, and wire up the client. */
  private async createClient(
    options?: ClientManagerOptions,
  ): Promise<CopilotClient> {
    const client = new CopilotClient({
      cwd: options?.cwd,
      cliPath: options?.cliPath,
      cliArgs: options?.cliArgs,
      cliUrl: options?.cliUrl,
      githubToken: options?.githubToken,
      logLevel: options?.logLevel ?? 'error',
      port: options?.port,
      useStdio: options?.useStdio,
      isChildProcess: options?.isChildProcess,
      env: options?.env,
      useLoggedInUser: options?.useLoggedInUser,
      autoStart: options?.autoStart ?? true,
      autoRestart: options?.autoRestart ?? true,
    });

    await client.start();
    this.registerShutdownHandlers(client);
    return client;
  }

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------

  /** Register process signal handlers exactly once per process. */
  private registerShutdownHandlers(client: CopilotClient): void {
    // Always update the reference so handlers target the latest client.
    shutdownClient = client;

    if (shutdownHandlersRegistered) return;
    shutdownHandlersRegistered = true;

    const shutdown = async (signal: string): Promise<void> => {
      const c = shutdownClient;
      if (!c) return;

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Shutdown timed out (${signal})`)),
          SHUTDOWN_TIMEOUT_MS,
        ),
      );

      try {
        await Promise.race([c.stop(), timeout]);
      } catch {
        await c.forceStop();
      }

      process.exit(0);
    };

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  }

  /** Gracefully stop the managed client with a configurable timeout. */
  async stop(timeoutMs: number = SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (!this.client) return;

    try {
      await Promise.race([
        this.client.stop(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('stop timeout')),
            timeoutMs,
          ),
        ),
      ]);
    } catch {
      await this.client.forceStop();
    }

    // Clear the shutdown reference so stale handlers become no-ops
    if (shutdownClient === this.client) {
      shutdownClient = null;
    }

    this.client = null;
  }

  // -----------------------------------------------------------------------
  // Connection state & health
  // -----------------------------------------------------------------------

  /** Return the current connection state of the underlying client. */
  getState(): ConnectionState {
    if (!this.client) return 'disconnected';
    return this.client.getState();
  }

  /** Ping the backend and return the response payload. */
  async ping(message?: string): Promise<{ message: string; timestamp: number }> {
    const client = await this.getClient();
    return client.ping(message);
  }

  /** Get CLI status including version and protocol information. */
  async getStatus(): Promise<Result<GetStatusResponse>> {
    try {
      const client = await this.getClient();
      const status = await client.getStatus();
      return { success: true, data: status };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error
          ? error
          : new ConnectionError(String(error)),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Foreground session (TUI+server mode)
  // -----------------------------------------------------------------------

  /** Get the foreground session id (TUI+server mode only). */
  async getForegroundSessionId(): Promise<string | undefined> {
    const client = await this.getClient();
    return client.getForegroundSessionId();
  }

  /** Set the foreground session id (TUI+server mode only). */
  async setForegroundSessionId(id: string): Promise<void> {
    const client = await this.getClient();
    await client.setForegroundSessionId(id);
  }

  // -----------------------------------------------------------------------
  // Session lifecycle events
  // -----------------------------------------------------------------------

  /** Subscribe to all session lifecycle events. Returns an unsubscribe function. */
  onSessionLifecycle(handler: SessionLifecycleHandler): () => void {
    if (!this.client) {
      throw new ConnectionError('Client not connected — call getClient() first');
    }
    return this.client.on(handler);
  }

  // -----------------------------------------------------------------------
  // Health monitoring
  // -----------------------------------------------------------------------

  /**
   * Start a periodic health monitor that pings the backend.
   * Returns a cleanup function that stops the monitor.
   */
  startHealthMonitor(intervalMs: number = 30_000): () => void {
    let timer: ReturnType<typeof setInterval> | null = null;

    timer = setInterval(() => {
      void this.checkHealth().then((ok) => {
        if (!ok) {
          process.stderr.write('[client-manager] health check failed\n');
        }
      });
    }, intervalMs);

    return (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  // -----------------------------------------------------------------------
  // Convenience wrappers
  // -----------------------------------------------------------------------

  /** Return auth status from the connected client. */
  async getAuthStatus(): Promise<Result<GetAuthStatusResponse>> {
    try {
      const client = await this.getClient();
      const status = await client.getAuthStatus();
      return { success: true, data: status };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error
          ? error
          : new ConnectionError(String(error)),
      };
    }
  }

  /** List available models. */
  async listModels(): Promise<Result<ModelInfo[]>> {
    try {
      const client = await this.getClient();
      const models = await client.listModels();
      return { success: true, data: models };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error
          ? error
          : new ConnectionError(String(error)),
      };
    }
  }

  /** List sessions, optionally filtered. */
  async listSessions(
    filter?: SessionListFilter,
  ): Promise<Result<SessionMetadata[]>> {
    try {
      const client = await this.getClient();
      const sessions = await client.listSessions(filter);
      return { success: true, data: sessions };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error
          ? error
          : new ConnectionError(String(error)),
      };
    }
  }

  /** Delete a session by id. */
  async deleteSession(sessionId: string): Promise<Result<void>> {
    try {
      const client = await this.getClient();
      await client.deleteSession(sessionId);
      return { success: true, data: undefined };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error
          ? error
          : new ConnectionError(String(error)),
      };
    }
  }

  /** Get the most recently updated session id, if any. */
  async getLastSessionId(): Promise<Result<string | undefined>> {
    try {
      const client = await this.getClient();
      const id = await client.getLastSessionId();
      return { success: true, data: id };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error
          ? error
          : new ConnectionError(String(error)),
      };
    }
  }

  /** Ping the backend to verify connectivity. */
  async checkHealth(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.ping();
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

const clientManager = new ClientManager();

export { clientManager, ClientManager, approveAll };
export type { ClientManagerOptions };
