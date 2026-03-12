import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Mock the SDK so command modules can be imported without side-effects
// ---------------------------------------------------------------------------

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue([]),
  })),
  approveAll: vi.fn(),
  defineTool: vi.fn((name: string, config: Record<string, unknown>) => ({ name, ...config })),
}));

vi.mock('../core/client-manager.js', () => ({
  clientManager: {
    getClient: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue(undefined),
  },
  approveAll: vi.fn(),
}));

import { createRunCommand } from './run.js';
import { createWhoamiCommand } from './whoami.js';
import { createModelsCommand } from './models.js';
import { createSessionsCommand } from './sessions.js';
import { createFleetCommand } from './fleet.js';
import { createChatCommand } from './chat.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract long option names from a Commander Command. */
function optionLongs(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? '');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRunCommand()', () => {
  const cmd = createRunCommand();

  it('returns a Command instance', () => {
    expect(cmd).toBeInstanceOf(Command);
  });

  it("has name 'run'", () => {
    expect(cmd.name()).toBe('run');
  });

  it('has all expected options', () => {
    const names = optionLongs(cmd);

    expect(names).toContain('--prompt');
    expect(names).toContain('--file');
    expect(names).toContain('--model');
    expect(names).toContain('--cwd');
    expect(names).toContain('--stream');
    expect(names).toContain('--no-stream');
    expect(names).toContain('--timeout');
    expect(names).toContain('--session-id');
    expect(names).toContain('--resume');
    expect(names).toContain('--agent');
    expect(names).toContain('--reasoning-effort');
    expect(names).toContain('--system-message');
    expect(names).toContain('--attach');
    expect(names).toContain('--read-only');
    expect(names).toContain('--verbose');
  });

  it('has new SDK feature options', () => {
    const names = optionLongs(cmd);

    expect(names).toContain('--mcp-server');
    expect(names).toContain('--tool-file');
    expect(names).toContain('--available-tool');
    expect(names).toContain('--exclude-tool');
    expect(names).toContain('--skill-dir');
    expect(names).toContain('--disable-skill');
    expect(names).toContain('--config-dir');
    expect(names).toContain('--infinite-sessions');
    expect(names).toContain('--provider');
  });
});

describe('createWhoamiCommand()', () => {
  const cmd = createWhoamiCommand();

  it('returns a Command instance', () => {
    expect(cmd).toBeInstanceOf(Command);
  });

  it("has name 'whoami'", () => {
    expect(cmd.name()).toBe('whoami');
  });

  it('has --verbose option', () => {
    const names = optionLongs(cmd);
    expect(names).toContain('--verbose');
  });
});

describe('createModelsCommand()', () => {
  const cmd = createModelsCommand();

  it('returns a Command instance', () => {
    expect(cmd).toBeInstanceOf(Command);
  });

  it("has name 'models'", () => {
    expect(cmd.name()).toBe('models');
  });

  it('has --json option', () => {
    const names = optionLongs(cmd);
    expect(names).toContain('--json');
  });
});

describe('createSessionsCommand()', () => {
  const cmd = createSessionsCommand();

  it('returns a Command instance', () => {
    expect(cmd).toBeInstanceOf(Command);
  });

  it("has name 'sessions'", () => {
    expect(cmd.name()).toBe('sessions');
  });

  it("has 'list' subcommand", () => {
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
  });

  it("has 'delete' subcommand", () => {
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('delete');
  });

  it("has 'last' subcommand", () => {
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('last');
  });

  it("has 'history' subcommand", () => {
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('history');
  });

  it("has 'abort' subcommand", () => {
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('abort');
  });

  it("'list' subcommand has expected options", () => {
    const listCmd = cmd.commands.find((c) => c.name() === 'list');
    expect(listCmd).toBeDefined();

    const names = optionLongs(listCmd!);
    expect(names).toContain('--cwd');
    expect(names).toContain('--repo');
    expect(names).toContain('--branch');
    expect(names).toContain('--json');
  });

  it("'history' subcommand has --json option", () => {
    const historyCmd = cmd.commands.find((c) => c.name() === 'history');
    expect(historyCmd).toBeDefined();
    const names = optionLongs(historyCmd!);
    expect(names).toContain('--json');
  });

  it("'history' subcommand requires sessionId argument", () => {
    const historyCmd = cmd.commands.find((c) => c.name() === 'history');
    expect(historyCmd).toBeDefined();
    // `as unknown as` — accessing Commander's internal registeredArguments, not in public types
    const args = (historyCmd as unknown as { registeredArguments: Array<{ _name: string; required: boolean }> }).registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!._name).toBe('sessionId');
    expect(args[0]!.required).toBe(true);
  });

  it("'abort' subcommand requires sessionId argument", () => {
    const abortCmd = cmd.commands.find((c) => c.name() === 'abort');
    expect(abortCmd).toBeDefined();
    // `as unknown as` — accessing Commander's internal registeredArguments, not in public types
    const args = (abortCmd as unknown as { registeredArguments: Array<{ _name: string; required: boolean }> }).registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]!._name).toBe('sessionId');
    expect(args[0]!.required).toBe(true);
  });
});

describe('createFleetCommand()', () => {
  const cmd = createFleetCommand();

  it('returns a Command instance', () => {
    expect(cmd).toBeInstanceOf(Command);
  });

  it("has name 'fleet'", () => {
    expect(cmd.name()).toBe('fleet');
  });

  it('has expected options', () => {
    const names = optionLongs(cmd);
    expect(names).toContain('--model');
    expect(names).toContain('--cwd');
    expect(names).toContain('--concurrency');
    expect(names).toContain('--timeout');
    expect(names).toContain('--verbose');
  });

  it('has new SDK feature options', () => {
    const names = optionLongs(cmd);
    expect(names).toContain('--mcp-server');
    expect(names).toContain('--skill-dir');
    expect(names).toContain('--agent');
  });

  it('has a required <files...> argument', () => {
    // `as unknown as` — accessing Commander's internal registeredArguments, not in public types
    const args = (cmd as unknown as { registeredArguments: Array<{ _name: string; required: boolean; variadic: boolean }> }).registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    const filesArg = args[0]!;
    expect(filesArg._name).toBe('files');
    expect(filesArg.variadic).toBe(true);
    expect(filesArg.required).toBe(true);
  });
});

describe('createChatCommand()', () => {
  const cmd = createChatCommand();

  it('returns a Command instance', () => {
    expect(cmd).toBeInstanceOf(Command);
  });

  it("has name 'chat'", () => {
    expect(cmd.name()).toBe('chat');
  });

  it('has expected options', () => {
    const names = optionLongs(cmd);
    expect(names).toContain('--model');
    expect(names).toContain('--cwd');
    expect(names).toContain('--session-id');
    expect(names).toContain('--resume');
    expect(names).toContain('--system-message');
    expect(names).toContain('--read-only');
    expect(names).toContain('--verbose');
    expect(names).toContain('--timeout');
  });
});
