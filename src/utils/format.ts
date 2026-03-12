/**
 * Terminal output-formatting utilities.
 *
 * Pure functions (except {@link Spinner}) — no side-effects, no dependencies.
 * @module
 */

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

/**
 * Format tabular data for the terminal.
 *
 * Each column is right-padded to the widest cell in that column.
 * A thin separator line is inserted below the header row.
 */
export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const columnCount = headers.length;
  const widths: number[] = headers.map((h) => h.length);

  for (const row of rows) {
    for (let i = 0; i < columnCount; i++) {
      const cell = row[i] ?? '';
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    }
  }

  function padRow(cells: readonly string[]): string {
    return cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ');
  }

  const headerLine = padRow(headers);
  const separator = widths.map((w) => '─'.repeat(w)).join('──');
  const bodyLines = rows.map((r) => padRow(r));

  return [headerLine, separator, ...bodyLines].join('\n');
}

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Format milliseconds into a concise human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0ms';

  if (ms < MS_PER_SECOND) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < MS_PER_MINUTE) {
    return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  }
  if (ms < MS_PER_HOUR) {
    const minutes = Math.floor(ms / MS_PER_MINUTE);
    const seconds = Math.round((ms % MS_PER_MINUTE) / MS_PER_SECOND);
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.round((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  return `${hours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// Byte formatting
// ---------------------------------------------------------------------------

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Format a byte count into a human-readable string with appropriate units. */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return '0 B';

  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const unit = UNITS[unitIndex] ?? 'B';
  return unitIndex === 0
    ? `${value} ${unit}`
    : `${value.toFixed(1)} ${unit}`;
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/** Truncate a string to `maxLen`, appending `…` when truncated. */
export function truncate(str: string, maxLen: number): string {
  if (maxLen < 1) return '';
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_INTERVAL_MS = 80;

/** A simple CLI spinner for long-running operations. */
export class Spinner {
  private message: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private frameIndex = 0;

  constructor(message: string) {
    this.message = message;
  }

  /** Begin rendering the spinner to stderr. */
  start(): void {
    if (this.timer !== undefined) return;
    process.stderr.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => {
      this.render();
    }, SPINNER_INTERVAL_MS);
  }

  /** Stop the spinner and print an optional final message. */
  stop(finalMessage?: string): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.clearLine();
    process.stderr.write(SHOW_CURSOR);
    if (finalMessage !== undefined) {
      process.stderr.write(`${finalMessage}\n`);
    }
  }

  /** Update the spinner message without restarting it. */
  update(message: string): void {
    this.message = message;
  }

  // -- private ---------------------------------------------------------------

  private render(): void {
    const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length] ?? '⠋';
    this.clearLine();
    process.stderr.write(`${DIM}${frame}${RESET} ${this.message}`);
    this.frameIndex++;
  }

  private clearLine(): void {
    process.stderr.write('\r\x1b[K');
  }
}
