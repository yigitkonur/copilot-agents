# 05 — `fleet`: Parallel Batch Execution

> **⚠️ SAFETY WARNING — Full Auto-Approval Mode**
>
> Fleet mode uses `approveAll`, which **auto-approves every agent permission request**: file writes, file deletes, shell command execution, network access, and MCP tool calls. Each task runs with full, unrestricted access to your system.
>
> **Always run fleet in a safe, isolated directory.** Recommended:
> ```bash
> mkdir /tmp/fleet-test && cd /tmp/fleet-test && npx copilot-agents fleet ...
> ```

## What This Command Does

The `fleet` command runs multiple prompt files in parallel across fully isolated sessions. Each prompt gets its own session — no shared state, no cross-contamination — with configurable concurrency limits. It aggregates results into a summary table showing per-task status and duration, exiting with code 1 if any task fails.

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

Note: The table uses padded columns (not box-drawing characters). Results are truncated to 40 characters with a single `…` (Unicode ellipsis) appended when truncated.

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

## Edge-Case Warnings

### Large Fleet Risk

Fleet creates one SDK session per prompt file with **no upper limit**. If you point it at a directory with hundreds or thousands of files, it will attempt to create that many sessions (throttled by concurrency). Before running on a large directory, check the file count:

```bash
ls /tmp/calc-fleet/*.md | wc -l
```

### Exit Code Behavior

Fleet exits `1` (`ExitCode.GeneralError`) if **any** task fails — this is an aggregate signal. To see which specific tasks failed, check the summary table printed at the end. Each row shows per-task status (`completed` or `failed`) and duration.

```bash
npx copilot-agents fleet /tmp/calc-fleet/ -t 3000; echo "Exit code: $?"
# Exit code: 1 (even if only 1 of 4 tasks timed out)
```

## Red Flags to Watch For

1. **Tasks not running in parallel** — with default concurrency of 5 and 4 tasks, all should start nearly simultaneously. If they run sequentially, the concurrency pool is broken.
2. **One task failure crashing others** — a timeout or error in one task must not abort or affect remaining tasks. Each task wraps `runTask()` in `.catch()` to capture errors on the task object, ensuring the pool promise never rejects.
3. **Session cross-contamination** — output from one task leaking into another task's results. Each task gets its own isolated session.
4. **Summary table missing tasks** — all tasks (`completed` and `failed`) must appear in the final summary. No silent drops.
5. **Task IDs not showing in progress logs** — progress events should be tagged with sequential task IDs (`[task-1]`, `[task-2]`, etc.) so you can tell which task generated which log line.
6. **Timeout not aborting stuck tasks** — with `-t 3000`, tasks should be forcibly stopped after 3 seconds (via `session.abort()`), not hang indefinitely. Standard mode also uses `sendAndWait(messageOptions, taskTimeout)` with a parallel `setTimeout` that calls abort.
7. **Memory spikes with high concurrency** — running many parallel sessions shouldn't cause excessive memory usage or OOM. Monitor with `top` during execution.
8. **`--use-fleet-rpc` producing different results** — fleet RPC mode should produce functionally equivalent output to standard mode. Major quality differences indicate a problem.
9. **Exit code 0 when tasks failed** — if any task fails, exit code **must** be `1` (`ExitCode.GeneralError`). Check with `echo $?` after every run.
10. **Prompt file resolution errors** — passing a directory should find all `.md`, `.txt`, `.markdown`, and `.prompt` files (non-recursive scan). Missing files or wrong extensions being included is a bug.

## Cleanup

After testing, remove the temporary prompt files:

```bash
rm -rf /tmp/calc-fleet
```

## What This Proves

- **Parallel execution works**: Multiple prompts run concurrently within the configured concurrency limit.
- **Task isolation holds**: Each task gets its own session with no cross-contamination of state or output.
- **Concurrency control works**: `-c 1` forces sequential execution; `-c 4` enables full parallelism.
- **Error isolation works**: One task's failure (timeout, error) doesn't crash or affect other tasks.
- **Fleet RPC vs standard mode**: Both execution paths produce valid results and summary output.
- **File resolution is correct**: Directories are scanned, individual files are accepted, mixed inputs work.
- **Exit codes are accurate**: `0` for all-completed, `1` (`ExitCode.GeneralError`) for any-failed.
