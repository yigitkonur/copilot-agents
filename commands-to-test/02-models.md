# 02 — `models`: Discover Available Models

> **🛡️ Safety:** All commands in this guide are **read-only** and have **no side effects**. Nothing is written, deleted, or modified — the `models` command only queries the API and displays results.

## What This Command Does

Lists all AI models available through your Copilot subscription. Shows each model's capabilities (vision, reasoning), context window size, billing multiplier, and availability status. Use this to pick the right model for your calculator project before writing any code.

## Test Cases

### Test 1: List All Models

```bash
npx copilot-agents models
```

**What to expect:**
A formatted table with columns: **ID | Name | Vision | Reasoning | Context | Status | Billing**. You should see multiple models (GPT-5.4, Claude Sonnet, Gemini, etc.) with their capabilities at a glance.

**✅ Success looks like:**

```
ID                   Name               Vision  Reasoning  Context   Status   Billing
───────────────────────────────────────────────────────────────────────────────────────
gpt-5.4              GPT-5.4            ✓       ✓          1.0 MB    enabled  1x
claude-sonnet-4.6    Claude Sonnet 4.6  ✓       ✓          781.3 KB  enabled  1x
gpt-4.1              GPT-4.1            ✓       ✗          4.0 MB    enabled  0.5x
```

> **Note:** The Context column displays a human-readable byte estimate (tokens × 4 bytes/token, via `formatBytes`), not raw token counts. Billing shows the raw multiplier (e.g. `1x`, `0.5x`) — no zero-padding. A `─` separator line appears between the header and data rows. Models with `policy.state === 'disabled'` get a `⚠ ` prefix on their Name (e.g. `⚠ GPT-3.5`).

After the table, the command prints a summary line via `logger.info` (e.g. `4 model(s) available`) and, if any models have a disabled policy state, an additional warning via `logger.warn` (e.g. `1 model(s) disabled/deprecated`).

### Test 2: JSON Output

```bash
npx copilot-agents models --json
```

**What to expect:**
A valid JSON array of model objects. Each object contains `id`, `name`, `capabilities` (nested: `supports.vision`, `supports.reasoningEffort`, `limits.max_context_window_tokens`, `limits.max_prompt_tokens`), `policy` (nested: `state`, `terms`), `billing` (nested: `multiplier`), and optionally `supportedReasoningEfforts` and `defaultReasoningEffort`. Pipe through `jq` to verify it parses cleanly.

> **Note:** The `--json` flag is checked **before** the empty-results check. If `--json` is used with a filter that matches nothing, the output is an empty JSON array `[]` with no warning message — the command still exits `0`.

**Pro tip:** `copilot-agents models --json | jq '.[].id'` to get just model IDs.

> **⚠️ `jq` dependency:** `jq` must be installed separately — if not available, use `python3 -m json.tool` as alternative (e.g. `copilot-agents models --json | python3 -m json.tool`).

> **⚠️ Pipe safety:** If `copilot-agents models --json` fails (e.g. auth/network error), it prints an error to stderr and exits non-zero, but the pipe may still send partial or empty output to `jq`, which will also error. To catch failures properly, use `set -o pipefail` in your shell or check the exit code separately:
> ```bash
> npx copilot-agents models --json > /tmp/models.json && jq '.[].id' /tmp/models.json
> ```

### Test 3: Detailed View

```bash
npx copilot-agents models --detailed
```

**What to expect:**
An expanded per-model block instead of a table. Each model begins with a header line in the format `── Name (id) ──` and then shows these fields (in this order, with exact labels):
- `Vision:` — ✓ or ✗
- `Reasoning effort:` — ✓ or ✗
- `Context window:` — raw token count (e.g. `200000 tokens`)
- `Max prompt:` — raw token count (only printed if `max_prompt_tokens` is defined)
- `Reasoning levels:` — comma-separated list (e.g. `low, medium, high`) — only printed if `supportedReasoningEfforts` array is non-empty
- `Default effort:` — e.g. `medium` — only printed if `defaultReasoningEffort` is set
- `Policy state:` — e.g. `enabled`, `disabled`, `unconfigured`, or `n/a`
- `Policy terms:` — only printed if `policy.terms` is set
- `Billing:` — e.g. `1x`, `0.5x`, or `n/a`

> **💡 Large output:** If many models are available (50+), `--detailed` can flood the terminal. Pipe to a pager for comfortable reading: `copilot-agents models --detailed | less -R` (the `-R` flag preserves any ANSI color codes).

### Test 4: Filter by Capability

```bash
npx copilot-agents models --filter reasoning
npx copilot-agents models --filter vision
npx copilot-agents models --filter gpt
```

**What to expect:**
- `--filter reasoning` → only models where `capabilities.supports.reasoningEffort` is true (e.g., GPT-5.4, Claude Sonnet 4.6)
- `--filter vision` → only models where `capabilities.supports.vision` is true (e.g., GPT-5.4, Claude Sonnet 4.6)
- `--filter gpt` → case-insensitive substring match on model `id` or `name`, returns all GPT-family models (GPT-5.4, GPT-5.1, GPT-4.1, etc.)

Each should return a smaller subset of the full table.

### Test 5: Filter with No Matches

```bash
npx copilot-agents models --filter nonexistent-model-xyz
```

**What to expect:**
A warning message: `No models matching "nonexistent-model-xyz"` (the filter value is quoted in the output). Results are empty but the command exits with code **0** (not an error). Verify: `echo $?` should print `0`.

> **Note (source-verified):** The exit code is `0` because the empty-results path calls `logger.warn()` and returns without calling `process.exit()` — the process terminates naturally with the default exit code of `0`. When `--json` is combined with a no-match filter, the output is an empty array `[]` (also exit `0`).

## Offline / Network Error Behavior

If you are offline or the API is unreachable, the command will print an error message to stderr and exit with a **non-zero exit code**. Specifically:
- **No network / API unreachable:** exits with code **3** (`ConnectionError`)
- **Auth failure (bad/expired token):** exits with code **2** (`AuthError`)
- **Timeout:** exits with code **4** (`TimeoutError`)
- **Other unexpected errors:** exit with code **1** (`GeneralError`)

Example:
```
✗ connect ECONNREFUSED 127.0.0.1:443
$ echo $?
3
```

## Red Flags to Watch For

- **Zero models returned** (without a filter) — auth or API issue
- **All models show "disabled" status** — policy restrictions on your subscription
- **Billing multipliers unexpectedly high** (>2x) — double-check before using in long sessions
- **Missing context window info** — API schema may have changed
- **Vision/reasoning columns all blank** — capabilities data not being parsed correctly
- **JSON output fails to parse** — malformed response, try `copilot-agents models --json | python3 -m json.tool`

## What This Proves Before Moving On

You now know which models are available, which ones support vision (useful if you want to screenshot-test the calculator UI later), which support reasoning (useful for complex logic), and what each costs relative to the base rate. Pick your model for the calculator task and move on.
