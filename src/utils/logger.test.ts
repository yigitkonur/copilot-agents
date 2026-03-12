import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, LogSeverity } from './logger.js';

// ---------------------------------------------------------------------------
// Helpers — spy on process streams
// ---------------------------------------------------------------------------

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

// =========================================================================
// createLogger
// =========================================================================

describe('createLogger', () => {
  it('returns object with all expected methods', () => {
    const logger = createLogger();
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.success).toBe('function');
    expect(typeof logger.setLevel).toBe('function');
  });

  it('defaults to Info level', () => {
    const logger = createLogger();
    logger.info('hello');
    expect(stdoutSpy).toHaveBeenCalled();
    logger.debug('hidden');
    // debug should not have caused a second call
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// Severity filtering
// =========================================================================

describe('severity filtering', () => {
  it('at Info level: info/warn/error write output, debug does NOT', () => {
    const logger = createLogger(LogSeverity.Info);

    logger.info('i');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);

    logger.warn('w');
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(2);

    logger.debug('d');
    // stdout should still be 1 (debug not written)
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it('at Debug level: all methods write output', () => {
    const logger = createLogger(LogSeverity.Debug);

    logger.debug('d');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);

    logger.info('i');
    expect(stdoutSpy).toHaveBeenCalledTimes(2);

    logger.warn('w');
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('at Error level: only error writes', () => {
    const logger = createLogger(LogSeverity.Error);

    logger.info('i');
    logger.warn('w');
    logger.debug('d');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.error('e');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('at Silent level: nothing writes', () => {
    const logger = createLogger(LogSeverity.Silent);

    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    logger.success('s');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Output streams
// =========================================================================

describe('output streams', () => {
  it('error() and warn() write to stderr', () => {
    const logger = createLogger(LogSeverity.Debug);

    logger.error('err');
    logger.warn('wrn');

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('info() and debug() write to stdout', () => {
    const logger = createLogger(LogSeverity.Debug);

    logger.info('inf');
    logger.debug('dbg');

    expect(stdoutSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('success() writes to stdout', () => {
    const logger = createLogger(LogSeverity.Info);

    logger.success('done');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// setLevel
// =========================================================================

describe('setLevel', () => {
  it('changing level affects subsequent calls', () => {
    const logger = createLogger(LogSeverity.Error);

    // debug should not write at Error level
    logger.debug('hidden');
    expect(stdoutSpy).not.toHaveBeenCalled();

    // raise to Debug
    logger.setLevel(LogSeverity.Debug);
    logger.debug('visible');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });
});
