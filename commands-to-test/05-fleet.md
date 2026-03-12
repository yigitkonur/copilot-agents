# 05 — `fleet`: Parallel Batch Execution

> **⚠️ SAFETY WARNING — Auto-Approval Mode (Default)**
>
> By default, fleet mode uses `approveAll`, which **auto-approves every agent permission request**: file writes, file deletes, shell command execution, network access, and MCP tool calls. Each task runs with full, unrestricted access to your system.
>
> Use `--read-only` to restrict agents to read-only operations, or **always run fleet in a safe, isolated directory**:
> ```bash
> mkdir /tmp/fleet-test && cd /tmp/fleet-test && npx copilot-agents fleet ...
> ```

## What This Command Does

The `fleet` command runs multiple prompt files in parallel across fully isolated sessions. Each prompt gets its own session — no shared state, no cross-contamination — with configurable concurrency limits. It aggregates results into a summary table showing per-task status and duration, exiting with code 1 if any task fails.

## Complete Flag Reference

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--model <model>` | `-m` | string | (server default) | Model for all sessions |
| `--cwd <dir>` | `-d` | string | `process.cwd()` | Working directory |
| `--concurrency <n>` | `-c` | string→int | `5` | Max concurrent sessions |
| `--timeout <ms>` | `-t` | string→int | `300000` | Per-task timeout (ms) |
| `--verbose` | `-v` | boolean | `false` | Debug output with timestamps |
| `--recursive` | `-r` | boolean | `false` | Recursively scan directories |
| `--dedupe` | — | boolean | `false` | Deduplicate resolved files |
| `--reasoning-effort <level>` | — | string | — | `low`, `medium`, `high`, `xhigh` |
| `--system-message <text>` | — | string | — | System message for all tasks |
| `--system-message-mode <mode>` | — | string | `append` | `append` or `replace` |
| `--mcp-server <spec>` | — | string[] | — | MCP server (`name:command:arg1`) |
| `--skill-dir <path>` | — | string[] | — | Load skills from directory |
| `--agent <name>` | — | string | — | Custom agent for all tasks |
| `--use-fleet-rpc` | — | boolean | `false` | Server-side fleet execution |
| `--read-only` | — | boolean | `false` | Deny writes/deletes/shell |
| `--json` | — | boolean | `false` | Output as JSON |
| `--list-agents` | — | boolean | `false` | List agents and exit |

## Setup: Create Prompt Files

Create a directory with four calculator-related prompt files:

> **Note:** The `cat >` commands below **overwrite** files if they already exist. The `mkdir -p` is safe (no-op if the directory exists). Re-running setup is fine but be aware of this if you've modified files manually.

```bash
mkdir -p /tmp/calc-fleet

cat > /tmp/calc-fleet/01-layout.md << 'EOF'
Create the HTML structure for a calculator:
- A display area showing current input and result
- Number buttons 0-9
- Operation buttons: +, -, ×, ÷, =
- Clear (C) and decimal (.) buttons
- Use semantic HTML. Output ONLY the HTML, no CSS or JS.
EOF

cat > /tmp/calc-fleet/02-styles.md << 'EOF'
Create CSS for a calculator with these specs:
- Dark theme (background #1a1a2e)
- Grid layout for buttons (4 columns)
- Rounded buttons with hover effects
- Large display with right-aligned monospace text
- Responsive: works on mobile
- Output ONLY the CSS, no HTML or JS.
EOF

cat > /tmp/calc-fleet/03-logic.md << 'EOF'
Create JavaScript for a calculator:
- Handle click events on number/operation buttons
- Implement +, -, ×, ÷ with proper order of operations
- Display updates in real-time
- Clear button resets state
- Handle decimal points (prevent multiple dots)
- Handle edge cases: division by zero, overflow
- Output ONLY the JavaScript, no HTML or CSS.
EOF

cat > /tmp/calc-fleet/04-tests.md << 'EOF'
Create a simple test script (plain JS, no frameworks) for a calculator:
- Test addition: 2 + 3 = 5
- Test subtraction: 10 - 4 = 6
- Test multiplication: 6 × 7 = 42
- Test division: 15 ÷ 3 = 5
- Test division by zero handling
- Test decimal operations: 0.1 + 0.2
- Output as a self-contained HTML file with test results displayed.
EOF
```

## Test Cases

### Test 1: Run All Prompts in a Directory

```bash
npx copilot-agents fleet /tmp/calc-fleet/
```

**What to expect:**

- 4 tasks created (one per `.md` file)
- Progress logs tagged with sequential task IDs like `[task-1]`, `[task-2]`, `[task-3]`, `[task-4]`
- Up to 5 concurrent sessions (default concurrency)
- Summary table at end with per-task status and duration

**✅ Success looks like:**

```
────────────────────────────────────────────────────────────
Fleet completed in 1m 3s
  ✓ Succeeded: 4/4
Task    File          Status     Duration  Result
──────  ────────────  ─────────  ────────  ────────────────────────────────────────
task-1  01-layout.md  completed  12.3s     <!DOCTYPE html><html lang="en"><head>…
task-2  02-styles.md  completed  15.1s     /* Calculator CSS — Dark theme with g…
task-3  03-logic.md   completed  18.7s     // Calculator JS — Event handling and…
task-4  04-tests.md   completed  14.2s     <!DOCTYPE html><html lang="en"><head>…
```

Exit code should be `0`.

Note: The table uses padded columns with box-drawing separator lines (`─`) below the header row. Results are truncated to 40 characters with a single `…` (Unicode ellipsis) appended when truncated.

---

### Test 2: Run Specific Files Only

```bash
npx copilot-agents fleet /tmp/calc-fleet/01-layout.md /tmp/calc-fleet/02-styles.md
```

**What to expect:**

- Only 2 tasks created (layout and styles)
- Both run in parallel (default concurrency of 5 easily accommodates 2)
- Summary table shows exactly 2 rows
- No trace of `03-logic` or `04-tests` in output

---

### Test 3: Concurrency Control

Run sequentially (one at a time):

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -c 1
```

**What to expect:**

- Tasks run **one at a time** (sequential execution)
- Progress logs show tasks starting only after the previous one finishes
- Total duration ≈ sum of all individual durations

Then compare with full parallelism:

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -c 4
```

**What to expect:**

- All 4 tasks start nearly simultaneously
- Total duration ≈ max(individual durations), significantly faster than `-c 1`
- Same results, just faster

> **Resource note:** High concurrency values create multiple SDK sessions simultaneously. On resource-constrained machines this may cause high memory usage or slowdowns. The default concurrency of `5` is reasonable for most systems. Monitor with `top` or `htop` if using larger values.

---

### Test 4: With Specific Model

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -m gpt-5.4
```

**What to expect:**

- All 4 tasks use the `gpt-5.4` model
- Verbose mode (`-v`) should confirm model selection per session
- Output quality may differ from default model
- Summary table should still show all tasks succeeded

---

### Test 5: Aggressive Timeout (Trigger Failures)

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -t 3000
```

**What to expect:**

- 3-second timeout is extremely aggressive — most or all tasks should timeout
- Failed tasks appear in the summary table with status `failed` and a truncated error message
- **Exit code is `1`** (at least one failure — `ExitCode.GeneralError`)
- Tasks that happen to complete fast enough still show as `completed`
- Critically: one task's timeout does **not** crash other tasks (error isolation)
- Timed-out sessions are cleaned up automatically — each task's `finally` block calls `session.disconnect()` regardless of success or failure, so there are no orphaned sessions

Verify exit code:

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -t 3000; echo "Exit code: $?"
```

---

### Test 6: Verbose Mode (See Everything)

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -v
```

**What to expect:**

- Debug logs with timestamps for each event
- Per-task details: session creation, prompt loading, tool executions, agent events
- Tool execution counts per task in the output (progress handler tracks `toolCount` per task)
- Progress events tagged with task IDs (e.g., `[task-1] ⚙ toolName (#1)`)
- On idle: `[task-1] Idle (3 tool calls)`
- Significantly more output than non-verbose mode

---

### Test 7: Fleet RPC Mode

```bash
npx copilot-agents fleet /tmp/calc-fleet/ --use-fleet-rpc
```

**What to expect:**

- Uses server-side fleet optimization instead of client-side parallel execution
- Flow differs internally: calls `session.rpc.fleet.start()` then waits for idle
- Same end results (all 4 tasks produce output)
- Compare execution time and output quality with standard mode (Test 1)
- Summary table format should be identical

---

### Test 8: List Available Agents

```bash
npx copilot-agents fleet --list-agents
```

**What to expect:**

- Creates a temporary session and calls `session.rpc.agent.list()`
- Prints a table with columns: **Name**, **Display Name**, **Description**
- Description is truncated to 60 characters
- Exits immediately — **no prompt files are executed**
- Note: Commander defines `<files...>` as required, so you may need to pass a dummy path (e.g., `.`) depending on Commander's behavior with the `--list-agents` flag
- Exit code `0`
- Useful for discovering agents before using `--agent <name>`

---

### Test 9: Mixed Files and Directories

```bash
npx copilot-agents fleet /tmp/calc-fleet/01-layout.md /tmp/calc-fleet/
```

**What to expect:**

- The directory resolves to all 4 `.md` files
- `01-layout.md` is specified both explicitly and via directory scan
- **⚠️ No deduplication** — `loadPromptFiles` does **not** deduplicate; resolved files are sorted lexicographically, so the duplicate `01-layout.md` appears twice and **runs twice**, consuming extra time and resources
- Summary shows **5 tasks** (one duplicate of `01-layout.md`)
- No crashes or errors from the overlap

---

### Test 10: Recursive Directory Scanning

Create a nested directory structure:

```bash
mkdir -p /tmp/calc-fleet/sub
cat > /tmp/calc-fleet/sub/05-accessibility.md << 'EOF'
Add ARIA labels and keyboard navigation to the calculator HTML.
Output ONLY the accessibility-enhanced HTML.
EOF
```

**Without `-r` (default: non-recursive):**

```bash
npx copilot-agents fleet /tmp/calc-fleet/
```

**What to expect:** Only 4 tasks (files in root of `/tmp/calc-fleet/`). The `sub/` directory is **not** traversed. No trace of `05-accessibility.md`.

**With `-r` (recursive):**

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -r
```

**What to expect:**

- 5 tasks — includes `sub/05-accessibility.md`
- Subdirectories are traversed using `readdir({ recursive: true })` (Node 18.17+)
- Files from subdirectories sorted lexicographically alongside root files
- Summary table shows all 5 tasks

**Red flags:**
- `-r` finding 0 extra files when subdirectories contain prompt files
- `-r` crashing on deeply nested or circular symlink structures

**Cleanup:** `rm -rf /tmp/calc-fleet/sub`

---

### Test 11: Deduplication

```bash
npx copilot-agents fleet /tmp/calc-fleet/01-layout.md /tmp/calc-fleet/ --dedupe
```

**What to expect:**

- `01-layout.md` is specified both explicitly and via directory scan
- With `--dedupe`, duplicate paths are removed via `[...new Set()]`
- Summary shows **4 tasks** (not 5 as in Test 9 without `--dedupe`)
- Compare with Test 9: same input, 5 tasks without `--dedupe` → 4 tasks with `--dedupe`

---

### Test 12: Read-Only Mode

```bash
npx copilot-agents fleet /tmp/calc-fleet/ --read-only
```

**What to expect:**

- Tasks start normally but the agent's file-write, shell-execute, and delete requests are **denied** by `createReadOnlyPermissionHandler`
- Read operations (file reads, directory listing) are still allowed
- Tasks will likely fail since the prompts ask agents to create files
- Failed tasks show `denied` or `permission denied` in the error column
- Exit code `1` (tasks failed due to permission denials)

> **⚠️ This is a safety feature.** Use `--read-only` when you want agents to analyze files without modifying anything. Combine with `--json` for CI/CD pipelines that need safe, parseable output.

---

### Test 13: JSON Output

```bash
npx copilot-agents fleet /tmp/calc-fleet/ --json
```

**What to expect:**

- Output is valid JSON (pipe to `jq` to verify: `npx copilot-agents fleet /tmp/calc-fleet/ --json | jq .`)
- JSON structure matches `FleetResult`:

```json
{
  "tasks": [
    {
      "id": "task-1",
      "promptFile": "/tmp/calc-fleet/01-layout.md",
      "status": "completed",
      "result": "<!DOCTYPE html>...",
      "startedAt": "2026-03-12T...",
      "completedAt": "2026-03-12T..."
    }
  ],
  "totalDuration": 15234,
  "succeeded": 4,
  "failed": 0
}
```

- No table output, no separator lines, no ANSI colors — just raw JSON
- Can be piped to `jq`, stored in files, or parsed by CI/CD tools
- Failed tasks include `error` field (containing the error message) instead of `result`:
  ```json
  { "id": "task-2", "status": "failed", "error": "Task timed out after 3000ms", ... }
  ```

---

### Test 14: System Message for All Tasks

```bash
npx copilot-agents fleet /tmp/calc-fleet/ --system-message "Respond in exactly 3 lines. No code blocks."
```

**What to expect:**

- All 4 tasks receive the same system message appended to their session config
- Agent behavior changes according to the instruction (shorter, no code blocks)
- Results in summary table should reflect the constraint
- Default `--system-message-mode` is `append` (adds to existing system message)

**With replace mode:**

```bash
npx copilot-agents fleet /tmp/calc-fleet/ \
  --system-message "You are a code review bot. Only output issues found." \
  --system-message-mode replace
```

**What to expect:**

- System message **replaces** the default rather than appending
- Agent behavior is dramatically different (reviews code instead of generating it)
- Uses `SystemMessageReplaceConfig` internally

---

### Test 15: Reasoning Effort Control

```bash
npx copilot-agents fleet /tmp/calc-fleet/ --reasoning-effort low
```

**What to expect:**

- All tasks use low reasoning effort — faster but potentially lower quality
- Lower token usage / faster completion times vs default
- Validated via `isReasoningEffort()` type guard; invalid values are silently ignored (treated as undefined)
- Valid values: `low`, `medium`, `high`, `xhigh`

**Compare with high effort:**

```bash
npx copilot-agents fleet /tmp/calc-fleet/ --reasoning-effort high
```

- Slower but potentially higher quality output
- Higher token usage

> **Cost note:** `--reasoning-effort xhigh` on large fleets can consume significant tokens. Use `low` or `medium` for batch analysis tasks where speed matters more than depth.

---

## Edge-Case Warnings

### Large Fleet Risk

Fleet creates one SDK session per prompt file with **no upper limit**. If you point it at a directory with hundreds or thousands of files, it will attempt to create that many sessions (throttled by concurrency). Before running on a large directory, check the file count:

```bash
ls /tmp/calc-fleet/*.md | wc -l
```

With `--recursive`, also check subdirectories:

```bash
find /tmp/calc-fleet -name '*.md' -o -name '*.txt' -o -name '*.prompt' -o -name '*.markdown' | wc -l
```

### Exit Code Behavior

Fleet exits `1` (`ExitCode.GeneralError`) if **any** task fails — this is an aggregate signal. To see which specific tasks failed, check the summary table (or use `--json` for machine-parseable output):

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -t 3000 --json | jq '.tasks[] | select(.status == "failed")'
```

## Red Flags to Watch For

1. **Tasks not running in parallel** — with default concurrency of 5 and 4 tasks, all should start nearly simultaneously. If they run sequentially, the concurrency pool is broken.
2. **One task failure crashing others** — a timeout or error in one task must not abort or affect remaining tasks. Each task wraps `runTask()` in `.catch()` to capture errors on the task object, ensuring the pool promise never rejects.
3. **Session cross-contamination** — output from one task leaking into another task's results. Each task gets its own isolated session.
4. **Summary table missing tasks** — all tasks (`completed` and `failed`) must appear in the final summary. No silent drops.
5. **Task IDs not showing in progress logs** — progress events should be tagged with sequential task IDs (`[task-1]`, `[task-2]`, etc.) so you can tell which task generated which log line.
6. **Timeout not aborting stuck tasks** — with `-t 3000`, tasks should be forcibly stopped after 3 seconds (via `session.abort()`), not hang indefinitely.
7. **`--recursive` missing subdirectory files** — when using `-r`, all prompt files in nested subdirectories must be found.
8. **`--dedupe` not removing duplicates** — when the same file is specified both explicitly and via directory, `--dedupe` should reduce to unique paths.
9. **`--read-only` still allowing writes** — file writes, shell commands, and deletes must be denied. Only reads are allowed.
10. **`--json` producing invalid JSON** — output must parse cleanly with `jq .` or `JSON.parse()`. No ANSI codes, no table formatting mixed in.
11. **`--system-message` not applying** — check in verbose mode that the system message appears in session creation logs.
12. **`--reasoning-effort` with invalid value not failing gracefully** — invalid values (e.g., `--reasoning-effort ultra`) should be silently ignored, not crash.
13. **`--use-fleet-rpc` producing different results** — fleet RPC mode should produce functionally equivalent output to standard mode.
14. **Exit code 0 when tasks failed** — if any task fails, exit code **must** be `1`. Check with `echo $?` after every run.
15. **Memory spikes with high concurrency** — monitor with `top` during large fleet runs.

## Cleanup

After testing, remove the temporary prompt files:

```bash
rm -rf /tmp/calc-fleet
```

## What This Proves

- **Parallel execution works**: Multiple prompts run concurrently within the configured concurrency limit.
- **Task isolation holds**: Each task gets its own session with no cross-contamination of state or output.
- **Concurrency control works**: `-c 1` forces sequential; `-c 4` enables full parallelism.
- **Error isolation works**: One task's failure doesn't crash or affect other tasks.
- **Recursive scanning works**: `-r` traverses subdirectories for prompt files.
- **Deduplication works**: `--dedupe` prevents running the same file twice.
- **Read-only mode works**: `--read-only` blocks destructive operations.
- **JSON output works**: `--json` produces machine-parseable `FleetResult` objects.
- **System message applies**: `--system-message` sets global context for all tasks.
- **Reasoning effort propagates**: `--reasoning-effort` controls quality/speed tradeoff.
- **Fleet RPC vs standard mode**: Both execution paths produce valid results.
- **File resolution is correct**: Directories, files, mixed inputs, and recursive scanning all work.
- **Exit codes are accurate**: `0` for all-completed, `1` for any-failed.
