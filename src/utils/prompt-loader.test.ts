import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';

import {
  validatePromptContent,
  detectPromptSource,
  loadPrompt,
  loadPromptFiles,
} from './prompt-loader.js';
import type { PromptSource } from '../types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);
const mockedStat = vi.mocked(stat);
const mockedExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.resetAllMocks();
});

// =========================================================================
// validatePromptContent
// =========================================================================

describe('validatePromptContent', () => {
  it('returns success for non-empty string', () => {
    const result = validatePromptContent('hello');
    expect(result).toEqual({ success: true, data: 'hello' });
  });

  it('returns success for string with whitespace (trimmed result)', () => {
    const result = validatePromptContent('  hello  ');
    expect(result).toEqual({ success: true, data: 'hello' });
  });

  it('returns failure for empty string', () => {
    const result = validatePromptContent('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/empty/i);
    }
  });

  it('returns failure for whitespace-only string', () => {
    const result = validatePromptContent('   \n\t  ');
    expect(result.success).toBe(false);
  });
});

// =========================================================================
// detectPromptSource
// =========================================================================

describe('detectPromptSource', () => {
  it('returns file source when --file provided', () => {
    const result = detectPromptSource({ file: 'test.txt' });
    expect(result).toEqual({
      success: true,
      data: { kind: 'file', path: 'test.txt' },
    });
  });

  it('returns inline source when --prompt provided', () => {
    const result = detectPromptSource({ prompt: 'do something' });
    expect(result).toEqual({
      success: true,
      data: { kind: 'inline', content: 'do something' },
    });
  });

  it('file takes priority over prompt when both provided', () => {
    const result = detectPromptSource({
      file: 'test.txt',
      prompt: 'inline text',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('file');
    }
  });

  it('returns stdin source when neither provided and stdin is not TTY', () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    try {
      const result = detectPromptSource({});
      expect(result).toEqual({ success: true, data: { kind: 'stdin' } });
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: original,
        configurable: true,
      });
    }
  });

  it('returns error when neither provided and stdin IS TTY', () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    try {
      const result = detectPromptSource({});
      expect(result.success).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: original,
        configurable: true,
      });
    }
  });

  it('handles empty strings for options', () => {
    // empty string is still !== undefined so file wins
    const result = detectPromptSource({ file: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('file');
    }
  });
});

// =========================================================================
// loadPrompt
// =========================================================================

describe('loadPrompt', () => {
  it('inline kind: returns trimmed content', async () => {
    const source: PromptSource = { kind: 'inline', content: '  hello world  ' };
    const result = await loadPrompt(source);
    expect(result).toEqual({ success: true, data: 'hello world' });
  });

  it('inline kind: fails for empty content', async () => {
    const source: PromptSource = { kind: 'inline', content: '' };
    const result = await loadPrompt(source);
    expect(result.success).toBe(false);
  });

  it('file kind: reads file and returns content', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFile.mockResolvedValue('file content here');

    const source: PromptSource = { kind: 'file', path: 'test.txt' };
    const result = await loadPrompt(source);
    expect(result).toEqual({ success: true, data: 'file content here' });
  });

  it('file kind: fails for non-existent file', async () => {
    mockedExistsSync.mockReturnValue(false);

    const source: PromptSource = { kind: 'file', path: 'missing.txt' };
    const result = await loadPrompt(source);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/not found/i);
    }
  });

  it('file kind: fails for unsupported extension', async () => {
    mockedExistsSync.mockReturnValue(true);

    const source: PromptSource = { kind: 'file', path: 'data.json' };
    const result = await loadPrompt(source);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/unsupported/i);
    }
  });
});

// =========================================================================
// loadPromptFiles
// =========================================================================

describe('loadPromptFiles', () => {
  it('resolves single file path', async () => {
    const absPath = resolve('prompt.txt');
    mockedExistsSync.mockReturnValue(true);
    // partial fs.Stats mock — `as never` bypasses the 50+ required Stats properties
    mockedStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as never);

    const result = await loadPromptFiles(['prompt.txt']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([absPath]);
    }
  });

  it('scans directory for .txt/.md files', async () => {
    const dirPath = resolve('prompts');
    mockedExistsSync.mockReturnValue(true);
    // partial fs.Stats mock — `as never` bypasses the 50+ required Stats properties
    mockedStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as never);
    // readdir overload returns Dirent[] | string[]; `as never` bypasses overload resolution
    mockedReaddir.mockResolvedValue(['b.txt', 'a.md', 'skip.json'] as never);

    const result = await loadPromptFiles(['prompts']);
    expect(result.success).toBe(true);
    if (result.success) {
      // Should have the .txt and .md files, sorted
      expect(result.data.length).toBe(2);
      // sorted lexicographically
      const names = result.data.map((p) => p.split('/').pop());
      expect(names).toEqual(['a.md', 'b.txt']);
    }
  });

  it('returns error for non-existent path', async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await loadPromptFiles(['no-such-dir']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/does not exist/i);
    }
  });

  it('returns error for unsupported extension', async () => {
    mockedExistsSync.mockReturnValue(true);
    // partial fs.Stats mock — `as never` bypasses the 50+ required Stats properties
    mockedStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true } as never);

    const result = await loadPromptFiles(['data.csv']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/unsupported/i);
    }
  });

  it('returns error when no files found in empty directory', async () => {
    mockedExistsSync.mockReturnValue(true);
    // partial fs.Stats mock — `as never` bypasses the 50+ required Stats properties
    mockedStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as never);
    // readdir overload returns Dirent[] | string[]; `as never` bypasses overload resolution
    mockedReaddir.mockResolvedValue([] as never);

    const result = await loadPromptFiles(['empty-dir']);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/no prompt files/i);
    }
  });

  it('sorts results lexicographically', async () => {
    mockedExistsSync.mockReturnValue(true);
    // partial fs.Stats mock — `as never` bypasses the 50+ required Stats properties
    mockedStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false } as never);
    // readdir overload returns Dirent[] | string[]; `as never` bypasses overload resolution
    mockedReaddir.mockResolvedValue(['c.txt', 'a.txt', 'b.md'] as never);

    const result = await loadPromptFiles(['dir']);
    expect(result.success).toBe(true);
    if (result.success) {
      const names = result.data.map((p) => p.split('/').pop());
      expect(names).toEqual(['a.txt', 'b.md', 'c.txt']);
    }
  });
});
