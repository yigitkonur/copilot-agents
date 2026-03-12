/**
 * Prompt loading — resolve prompts from files, inline strings, or stdin.
 *
 * Every public function returns a {@link Result} instead of throwing.
 * @module
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

import type { PromptSource, Result } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.prompt']);
const STDIN_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve a {@link PromptSource} and load its textual content. */
export async function loadPrompt(source: PromptSource): Promise<Result<string>> {
  switch (source.kind) {
    case 'inline':
      return validatePromptContent(source.content);
    case 'file':
      return loadPromptFromFile(source.path);
    case 'stdin':
      return loadPromptFromStdin();
  }
}

/**
 * Detect the prompt source from parsed CLI flags.
 *
 * Priority: `--file` → `--prompt` → piped stdin → error.
 */
export function detectPromptSource(
  options: { readonly prompt?: string; readonly file?: string },
): Result<PromptSource> {
  if (options.file !== undefined) {
    return { success: true, data: { kind: 'file', path: options.file } };
  }

  if (options.prompt !== undefined) {
    return { success: true, data: { kind: 'inline', content: options.prompt } };
  }

  if (!process.stdin.isTTY) {
    return { success: true, data: { kind: 'stdin' } };
  }

  return {
    success: false,
    error: new Error(
      'No prompt provided. Use --prompt, --file, or pipe text to stdin.',
    ),
  };
}

/**
 * Resolve an array of file paths / directory paths to individual prompt files.
 *
 * Directories are scanned for files with supported extensions.
 * When `options.recursive` is true, subdirectories are traversed.
 * Results are sorted lexicographically.
 */
export async function loadPromptFiles(
  patterns: readonly string[],
  options?: { recursive?: boolean },
): Promise<Result<readonly string[]>> {
  try {
    const resolved: string[] = [];

    for (const pattern of patterns) {
      const absolutePath = resolve(pattern);

      if (!existsSync(absolutePath)) {
        return {
          success: false,
          error: new Error(`Path does not exist: ${absolutePath}`),
        };
      }

      const stat = await import('node:fs/promises').then((fs) =>
        fs.stat(absolutePath),
      );

      if (stat.isDirectory()) {
        if (options?.recursive) {
          // Recursive: use readdir with recursive option (Node 18.17+)
          const entries = await readdir(absolutePath, { recursive: true });
          for (const entry of entries) {
            if (isSupportedExtension(extname(entry))) {
              resolved.push(resolve(absolutePath, entry));
            }
          }
        } else {
          const entries = await readdir(absolutePath);
          for (const entry of entries) {
            if (isSupportedExtension(extname(entry))) {
              resolved.push(resolve(absolutePath, entry));
            }
          }
        }
      } else if (stat.isFile()) {
        if (!isSupportedExtension(extname(absolutePath))) {
          return {
            success: false,
            error: new Error(
              `Unsupported file extension: ${extname(absolutePath)}. ` +
                `Allowed: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
            ),
          };
        }
        resolved.push(absolutePath);
      }
    }

    if (resolved.length === 0) {
      return {
        success: false,
        error: new Error('No prompt files found in the provided paths.'),
      };
    }

    resolved.sort();
    return { success: true, data: resolved };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load a prompt from a file path, validating existence and extension. */
async function loadPromptFromFile(filePath: string): Promise<Result<string>> {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    return {
      success: false,
      error: new Error(`Prompt file not found: ${absolutePath}`),
    };
  }

  const ext = extname(absolutePath);
  if (!isSupportedExtension(ext)) {
    return {
      success: false,
      error: new Error(
        `Unsupported file extension "${ext}". ` +
          `Allowed: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
      ),
    };
  }

  try {
    const content = await readFile(absolutePath, 'utf-8');
    return validatePromptContent(content);
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/** Read all of stdin with a timeout. */
async function loadPromptFromStdin(): Promise<Result<string>> {
  try {
    const content = await readStdinWithTimeout(STDIN_TIMEOUT_MS);
    return validatePromptContent(content);
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/** Validate that prompt content is non-empty after trimming. */
export function validatePromptContent(content: string): Result<string> {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { success: false, error: new Error('Prompt content is empty.') };
  }
  return { success: true, data: trimmed };
}

function isSupportedExtension(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

/** Consume stdin into a string, aborting after `timeoutMs`. */
function readStdinWithTimeout(timeoutMs: number): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];

    const timer = setTimeout(() => {
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      reject(new Error(`Timed out reading from stdin after ${timeoutMs}ms`));
    }, timeoutMs);

    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks).toString('utf-8'));
    });

    process.stdin.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    // If stdin is already ended (e.g. empty pipe), force end
    if (process.stdin.readableEnded) {
      clearTimeout(timer);
      resolvePromise(Buffer.concat(chunks).toString('utf-8'));
    }
  });
}
