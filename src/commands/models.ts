/**
 * `models` command — list available Copilot models.
 * @module
 */

import { Command } from 'commander';

import type { ModelInfo } from '../types.js';
import { clientManager } from '../core/client-manager.js';
import { toAppError } from '../errors.js';
import { createLogger, LogSeverity } from '../utils/logger.js';
import { formatTable, formatBytes } from '../utils/format.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface ModelsOptions {
  readonly json?: boolean;
  readonly detailed?: boolean;
  readonly filter?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BYTES_PER_TOKEN_ESTIMATE = 4;

/** Check whether a model matches a capability filter keyword. */
function matchesFilter(model: ModelInfo, filter: string): boolean {
  const keyword = filter.toLowerCase();
  switch (keyword) {
    case 'vision':
      return model.capabilities.supports.vision;
    case 'reasoning':
      return model.capabilities.supports.reasoningEffort;
    default:
      return (
        model.id.toLowerCase().includes(keyword) ||
        model.name.toLowerCase().includes(keyword)
      );
  }
}

/** Render a concise table row for standard output. */
function toTableRow(m: ModelInfo): readonly string[] {
  const deprecated = m.policy?.state === 'disabled';
  const nameCol = deprecated ? `⚠ ${m.name}` : m.name;
  return [
    m.id,
    nameCol,
    m.capabilities.supports.vision ? '✓' : '✗',
    m.capabilities.supports.reasoningEffort ? '✓' : '✗',
    formatBytes(
      m.capabilities.limits.max_context_window_tokens * BYTES_PER_TOKEN_ESTIMATE,
    ),
    m.policy?.state ?? 'n/a',
    m.billing ? `${String(m.billing.multiplier)}x` : 'n/a',
  ];
}

/** Print detailed information for a single model. */
function printDetailed(m: ModelInfo): void {
  console.log(`\n── ${m.name} (${m.id}) ──`);
  console.log(`  Vision:           ${m.capabilities.supports.vision ? '✓' : '✗'}`);
  console.log(`  Reasoning effort: ${m.capabilities.supports.reasoningEffort ? '✓' : '✗'}`);
  console.log(
    `  Context window:   ${String(m.capabilities.limits.max_context_window_tokens)} tokens`,
  );
  if (m.capabilities.limits.max_prompt_tokens !== undefined) {
    console.log(
      `  Max prompt:       ${String(m.capabilities.limits.max_prompt_tokens)} tokens`,
    );
  }
  if (m.supportedReasoningEfforts && m.supportedReasoningEfforts.length > 0) {
    console.log(`  Reasoning levels: ${m.supportedReasoningEfforts.join(', ')}`);
  }
  if (m.defaultReasoningEffort) {
    console.log(`  Default effort:   ${m.defaultReasoningEffort}`);
  }
  console.log(`  Policy state:     ${m.policy?.state ?? 'n/a'}`);
  if (m.policy?.terms) {
    console.log(`  Policy terms:     ${m.policy.terms}`);
  }
  console.log(`  Billing:          ${m.billing ? `${String(m.billing.multiplier)}x` : 'n/a'}`);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function createModelsCommand(): Command {
  return new Command('models')
    .description('List available Copilot models')
    .option('--json', 'Output as JSON')
    .option('--detailed', 'Show expanded model details')
    .option('--filter <capability>', 'Filter by capability (vision, reasoning) or keyword')
    .action(async (options: ModelsOptions) => {
      const logger = createLogger(LogSeverity.Info);

      try {
        const client = await clientManager.getClient();
        const allModels: readonly ModelInfo[] = await client.listModels();

        const filterKeyword = options.filter;
        const models: readonly ModelInfo[] = filterKeyword
          ? allModels.filter((m) => matchesFilter(m, filterKeyword))
          : allModels;

        if (options.json) {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0) {
          logger.warn(
            options.filter
              ? `No models matching "${options.filter}"`
              : 'No models available',
          );
          return;
        }

        if (options.detailed) {
          for (const m of models) {
            printDetailed(m);
          }
        } else {
          const headers = ['ID', 'Name', 'Vision', 'Reasoning', 'Context', 'Status', 'Billing'];
          const rows: (readonly string[])[] = models.map(toTableRow);
          console.log(formatTable(headers, rows));
        }

        const deprecatedCount = models.filter(
          (m: ModelInfo) => m.policy?.state === 'disabled',
        ).length;
        logger.info(`${String(models.length)} model(s) available`);
        if (deprecatedCount > 0) {
          logger.warn(`${String(deprecatedCount)} model(s) disabled/deprecated`);
        }
      } catch (error: unknown) {
        const appErr = toAppError(error);
        logger.error(appErr.message);
        process.exit(appErr.exitCode);
      } finally {
        await clientManager.stop();
      }
    });
}
