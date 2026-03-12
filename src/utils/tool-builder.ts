/**
 * Tool builder utilities wrapping the SDK's defineTool with Zod schemas.
 *
 * Supports loading tool definitions from JSON/TypeScript files and
 * constructing tools programmatically.
 * @module
 */

import { defineTool } from '@github/copilot-sdk';
import type {
  Tool,
  ToolHandler,
  ToolInvocation,
  ToolResultObject,
  ZodSchema,
} from '@github/copilot-sdk';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';

import type { Result } from '../types.js';

// ---------------------------------------------------------------------------
// Zod-to-JSON-Schema helper
// ---------------------------------------------------------------------------

/**
 * Convert a Zod object schema to a JSON Schema record suitable for the SDK's
 * `defineTool` parameters. The SDK expects either its own `ZodSchema` interface
 * (with `toJSONSchema()`) or a plain `Record<string, unknown>`. Standard Zod v3
 * does not implement `toJSONSchema()`, so we convert via Zod's `.shape` metadata.
 */
function zodToParameters(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const field: z.ZodTypeAny = value;
    const prop: Record<string, unknown> = { type: 'string' };
    if (field.description) {
      prop['description'] = field.description;
    }
    properties[key] = prop;
    if (!field.isOptional()) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) {
    result['required'] = required;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Re-export SDK primitives
// ---------------------------------------------------------------------------

export { defineTool };
export type { Tool, ToolHandler, ToolInvocation, ToolResultObject, ZodSchema };

// ---------------------------------------------------------------------------
// Tool result helper
// ---------------------------------------------------------------------------

/**
 * Create a typed {@link ToolResultObject} with sensible defaults.
 *
 * - `resultType` defaults to `'success'` unless `error` is provided (then `'error'`).
 * - `text` maps to `textResultForLlm`.
 */
export function createToolResult(opts: {
  text?: string;
  error?: string;
  resultType?: 'success' | 'failure' | 'rejected' | 'denied';
  sessionLog?: string;
}): ToolResultObject {
  const resultType =
    opts.resultType ?? (opts.error !== undefined ? 'failure' : 'success');

  return {
    textResultForLlm: opts.error ?? opts.text ?? '',
    resultType,
    ...(opts.error !== undefined && { error: opts.error }),
    ...(opts.sessionLog !== undefined && { sessionLog: opts.sessionLog }),
  };
}

// ---------------------------------------------------------------------------
// Tool definition schema (for JSON tool files)
// ---------------------------------------------------------------------------

/** Schema for a tool parameter defined in JSON. */
const toolParameterSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  required: z.array(z.string()).optional(),
});

/** Schema for a tool definition in a JSON file. */
const toolFileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: toolParameterSchema.optional(),
  overridesBuiltInTool: z.boolean().optional(),
});

/** Parsed tool definition from a JSON file (no handler — handler is injected). */
export type ToolFileDefinition = z.infer<typeof toolFileSchema>;

// ---------------------------------------------------------------------------
// Load tool definitions from JSON files
// ---------------------------------------------------------------------------

/**
 * Load tool definitions from a JSON file.
 *
 * The file should contain a JSON object or array of objects with:
 * - `name` (required): Tool name
 * - `description` (optional): Tool description
 * - `parameters` (optional): JSON Schema for parameters
 *
 * Returns tool skeletons without handlers — callers must attach handlers.
 */
export async function loadToolDefinitions(
  filePath: string,
): Promise<Result<readonly ToolFileDefinition[]>> {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    return {
      success: false,
      error: new Error(`Tool definition file not found: ${absolutePath}`),
    };
  }

  const ext = extname(absolutePath).toLowerCase();
  if (ext !== '.json') {
    return {
      success: false,
      error: new Error(`Tool definitions must be JSON files, got: ${ext}`),
    };
  }

  try {
    const raw = await readFile(absolutePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    const items = Array.isArray(parsed) ? parsed : [parsed];
    const definitions: ToolFileDefinition[] = [];

    for (const item of items) {
      const result = toolFileSchema.safeParse(item);
      if (!result.success) {
        return {
          success: false,
          error: new Error(
            `Invalid tool definition in ${absolutePath}: ${result.error.message}`,
          ),
        };
      }
      definitions.push(result.data);
    }

    return { success: true, data: definitions };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: create a simple echo tool (useful for testing)
// ---------------------------------------------------------------------------

/** Type guard for echo tool arguments. */
function isEchoArgs(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as Record<string, unknown>)['message'] === 'string'
  );
}

/**
 * Create a simple echo tool that returns its input as a string.
 * Useful for testing tool integration without side-effects.
 */
export function createEchoTool(name = 'echo'): Tool {
  return defineTool(name, {
    description: 'Echo back the provided message',
    parameters: zodToParameters(
      z.object({
        message: z.string().describe('The message to echo back'),
      }),
    ),
    handler: (args: unknown, _invocation: ToolInvocation): ToolResultObject => ({
      textResultForLlm: isEchoArgs(args) ? args.message : String(args),
      resultType: 'success',
    }),
  });
}

/**
 * Create a tool from a JSON definition with a passthrough handler.
 * The handler returns the tool arguments as JSON (useful for logging/testing).
 */
export function createPassthroughTool(definition: ToolFileDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters
      ? { ...definition.parameters }
      : undefined,
    ...(definition.overridesBuiltInTool !== undefined && {
      overridesBuiltInTool: definition.overridesBuiltInTool,
    }),
    handler: (args: unknown, _invocation: ToolInvocation): ToolResultObject => ({
      textResultForLlm: JSON.stringify(args, null, 2),
      resultType: 'success',
    }),
  };
}
