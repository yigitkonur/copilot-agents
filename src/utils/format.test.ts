import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTable, formatDuration, formatBytes, truncate, Spinner } from './format.js';

// =========================================================================
// formatTable
// =========================================================================

describe('formatTable', () => {
  it('formats headers and rows with padding', () => {
    const output = formatTable(['Name', 'Age'], [['Alice', '30'], ['Bob', '7']]);
    const lines = output.split('\n');
    expect(lines.length).toBe(4); // header + separator + 2 rows
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Age');
  });

  it('handles empty rows', () => {
    const output = formatTable(['A', 'B'], []);
    const lines = output.split('\n');
    expect(lines.length).toBe(2); // header + separator
  });

  it('handles single column', () => {
    const output = formatTable(['Only'], [['val']]);
    const lines = output.split('\n');
    expect(lines.length).toBe(3);
  });

  it('handles cells of varying lengths', () => {
    const output = formatTable(
      ['Short', 'Header'],
      [['x', 'a very long cell value'], ['medium val', 'y']],
    );
    const lines = output.split('\n');
    // all body lines should be same visual width
    expect(lines.length).toBe(4);
  });

  it('includes separator line', () => {
    const output = formatTable(['H'], [['r']]);
    const lines = output.split('\n');
    // separator is line index 1 and contains '─'
    expect(lines[1]).toMatch(/─/);
  });
});

// =========================================================================
// formatDuration
// =========================================================================

describe('formatDuration', () => {
  it('0ms → "0ms"', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('500 → "500ms"', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('1000 → "1.0s"', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  it('1500 → "1.5s"', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });

  it('60000 → "1m 0s"', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });

  it('90000 → "1m 30s"', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('3600000 → "1h 0m"', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
  });

  it('negative → "0ms"', () => {
    expect(formatDuration(-100)).toBe('0ms');
  });
});

// =========================================================================
// formatBytes
// =========================================================================

describe('formatBytes', () => {
  it('0 → "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('1023 → "1023 B"', () => {
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('1024 → "1.0 KB"', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('1048576 → "1.0 MB"', () => {
    expect(formatBytes(1_048_576)).toBe('1.0 MB');
  });

  it('negative → "0 B"', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});

// =========================================================================
// truncate
// =========================================================================

describe('truncate', () => {
  it('short string unchanged', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('string at exact maxLen unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('string over maxLen gets "…"', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
  });

  it('maxLen 0 → ""', () => {
    expect(truncate('anything', 0)).toBe('');
  });

  it('maxLen 1 → "…" for long string', () => {
    expect(truncate('hello', 1)).toBe('…');
  });

  it('maxLen 1 → single char for single-char string', () => {
    expect(truncate('a', 1)).toBe('a');
  });
});

// =========================================================================
// Spinner
// =========================================================================

describe('Spinner', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('start() begins interval', () => {
    const spinner = new Spinner('loading');
    spinner.start();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    spinner.stop(); // cleanup
  });

  it('stop() clears interval', () => {
    const spinner = new Spinner('loading');
    spinner.start();
    spinner.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('stop(message) writes final message to stderr', () => {
    const spinner = new Spinner('loading');
    spinner.start();
    stderrSpy.mockClear();
    spinner.stop('done!');
    // Should have written the final message
    const calls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes('done!'))).toBe(true);
  });

  it('update() changes message', () => {
    const spinner = new Spinner('old');
    spinner.update('new');
    // Just verify it doesn't throw — the message is private
    spinner.start();
    spinner.stop();
  });

  it('double start() is a no-op', () => {
    const spinner = new Spinner('loading');
    spinner.start();
    spinner.start(); // should not create a second interval
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    spinner.stop();
  });
});
