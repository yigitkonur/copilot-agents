import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

vi.mock('@github/copilot-sdk', () => ({
  defineTool: vi.fn((name: string, config: Record<string, unknown>) => ({
    name,
    ...config,
  })),
}));

import {
  loadToolDefinitions,
  createPassthroughTool,
  createEchoTool,
} from './tool-builder.js';

import type { ToolFileDefinition } from './tool-builder.js';

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `tool-builder-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadToolDefinitions
// ---------------------------------------------------------------------------

describe('loadToolDefinitions', () => {
  it('loads a single tool definition from JSON', async () => {
    const filePath = join(tempDir, 'tool.json');
    await writeFile(
      filePath,
      JSON.stringify({ name: 'my-tool', description: 'A test tool' }),
    );

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe('my-tool');
      expect(result.data[0]!.description).toBe('A test tool');
    }
  });

  it('loads multiple tool definitions from a JSON array', async () => {
    const filePath = join(tempDir, 'tools.json');
    await writeFile(
      filePath,
      JSON.stringify([
        { name: 'tool-a', description: 'First' },
        { name: 'tool-b', description: 'Second' },
      ]),
    );

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.name).toBe('tool-a');
      expect(result.data[1]!.name).toBe('tool-b');
    }
  });

  it('returns error for non-existent file', async () => {
    const result = await loadToolDefinitions('/does/not/exist.json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error for non-JSON file', async () => {
    const filePath = join(tempDir, 'tool.yaml');
    await writeFile(filePath, 'name: test');

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('JSON files');
    }
  });

  it('returns error for invalid tool definition (missing name)', async () => {
    const filePath = join(tempDir, 'bad.json');
    await writeFile(filePath, JSON.stringify({ description: 'no name' }));

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(false);
  });

  it('returns error for empty-name tool', async () => {
    const filePath = join(tempDir, 'empty-name.json');
    await writeFile(filePath, JSON.stringify({ name: '' }));

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(false);
  });

  it('returns error for invalid JSON', async () => {
    const filePath = join(tempDir, 'bad.json');
    await writeFile(filePath, 'not valid json {{{');

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(false);
  });

  it('accepts tool with parameters', async () => {
    const filePath = join(tempDir, 'params.json');
    await writeFile(
      filePath,
      JSON.stringify({
        name: 'param-tool',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      }),
    );

    const result = await loadToolDefinitions(filePath);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]!.parameters).toBeDefined();
      expect(result.data[0]!.parameters!.type).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// createPassthroughTool
// ---------------------------------------------------------------------------

describe('createPassthroughTool', () => {
  it('creates a tool with the correct name', () => {
    const def: ToolFileDefinition = { name: 'test-pass' };
    const tool = createPassthroughTool(def);
    expect(tool.name).toBe('test-pass');
  });

  it('handler returns args as JSON', () => {
    const def: ToolFileDefinition = { name: 'echo' };
    const tool = createPassthroughTool(def);
    const result = tool.handler({ foo: 'bar' }, {
      sessionId: 's1',
      toolCallId: 'tc1',
      toolName: 'echo',
      arguments: { foo: 'bar' },
    });
    expect(result).toEqual({
      textResultForLlm: JSON.stringify({ foo: 'bar' }, null, 2),
      resultType: 'success',
    });
  });

  it('preserves description from definition', () => {
    const def: ToolFileDefinition = { name: 't', description: 'A tool' };
    const tool = createPassthroughTool(def);
    expect(tool.description).toBe('A tool');
  });
});

// ---------------------------------------------------------------------------
// createEchoTool
// ---------------------------------------------------------------------------

describe('createEchoTool', () => {
  it('creates a tool with default name "echo"', () => {
    const tool = createEchoTool();
    expect(tool.name).toBe('echo');
  });

  it('creates a tool with custom name', () => {
    const tool = createEchoTool('my-echo');
    expect(tool.name).toBe('my-echo');
  });
});
