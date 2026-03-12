/**
 * Structured CLI logger with ANSI colour output.
 *
 * Uses numeric severity levels for ordering; maps to the string-based
 * {@link LogLevel} exported from `../types.js` when needed.
 * @module
 */

// ---------------------------------------------------------------------------
// Numeric log-level constants (higher = more verbose)
// ---------------------------------------------------------------------------

export const LogSeverity = {
  Silent: 0,
  Error: 1,
  Warn: 2,
  Info: 3,
  Debug: 4,
} as const;

export type LogSeverity = (typeof LogSeverity)[keyof typeof LogSeverity];

// ---------------------------------------------------------------------------
// ANSI helpers (no deps)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function coloured(colour: string, text: string): string {
  return `${colour}${text}${RESET}`;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

// ---------------------------------------------------------------------------
// Logger interface & factory
// ---------------------------------------------------------------------------

export interface Logger {
  error(message: string, ...args: readonly unknown[]): void;
  warn(message: string, ...args: readonly unknown[]): void;
  info(message: string, ...args: readonly unknown[]): void;
  debug(message: string, ...args: readonly unknown[]): void;
  success(message: string): void;
  setLevel(level: LogSeverity): void;
}

export function createLogger(level: LogSeverity = LogSeverity.Info): Logger {
  let currentLevel: LogSeverity = level;

  function shouldLog(severity: LogSeverity): boolean {
    return severity <= currentLevel;
  }

  function formatPrefix(severity: LogSeverity): string {
    const ts = currentLevel >= LogSeverity.Debug
      ? `${coloured(DIM, timestamp())} `
      : '';

    switch (severity) {
      case LogSeverity.Error:
        return `${ts}${coloured(RED, '✗')}`;
      case LogSeverity.Warn:
        return `${ts}${coloured(YELLOW, '⚠')}`;
      case LogSeverity.Info:
        return `${ts}${coloured(CYAN, 'ℹ')}`;
      case LogSeverity.Debug:
        return `${ts}${coloured(DIM, '●')}`;
      default:
        return ts;
    }
  }

  function write(
    severity: LogSeverity,
    stream: NodeJS.WriteStream,
    message: string,
    args: readonly unknown[],
  ): void {
    if (!shouldLog(severity)) return;
    const prefix = formatPrefix(severity);
    const parts: string[] = [prefix, message];
    for (const arg of args) {
      parts.push(typeof arg === 'string' ? arg : JSON.stringify(arg));
    }
    stream.write(`${parts.join(' ')}\n`);
  }

  return {
    error(message: string, ...args: readonly unknown[]): void {
      write(LogSeverity.Error, process.stderr, message, args);
    },

    warn(message: string, ...args: readonly unknown[]): void {
      write(LogSeverity.Warn, process.stderr, message, args);
    },

    info(message: string, ...args: readonly unknown[]): void {
      write(LogSeverity.Info, process.stdout, message, args);
    },

    debug(message: string, ...args: readonly unknown[]): void {
      write(LogSeverity.Debug, process.stdout, message, args);
    },

    success(message: string): void {
      if (!shouldLog(LogSeverity.Info)) return;
      const ts = currentLevel >= LogSeverity.Debug
        ? `${coloured(DIM, timestamp())} `
        : '';
      process.stdout.write(`${ts}${coloured(GREEN, '✓')} ${message}\n`);
    },

    setLevel(newLevel: LogSeverity): void {
      currentLevel = newLevel;
    },
  };
}
