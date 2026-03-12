# 03 — `run`: Single-Shot Prompt Execution

> **⚠️ Side Effects Warning:** Tests 1–7, 9, 11–12 run **without** `--read-only`, meaning the Copilot agent **can create/modify files, execute shell commands, invoke MCP tools, and fetch URLs** in your working directory. If you want to prevent this, add `--read-only` to any command. Test 8 demonstrates read-only mode — **consider trying it first** to understand the safety boundary before running unrestricted tests.

## What This Command Does

`run` is the workhorse of copilot-agents — it sends a single prompt to the model and streams (or blocks for) the response. It supports three prompt sources (inline text, file, or stdin pipe), two output modes (streaming and blocking), session management with resume capability, and the full SDK feature set including MCP servers, tool files, file attachments, custom system messages, and plan-then-execute workflows. If you only learn one command, learn this one.

---

## Test Cases

### Test 1: Inline Prompt (Streaming)

```bash
npx copilot-agents run -p "Create a basic HTML calculator with +, -, ×, ÷ buttons. Single file, no frameworks. Output only the HTML."
```

**What to expect:**

- Tokens stream to the terminal in real-time as the model generates them
- You'll see characters and words appearing progressively — not all at once
- The final output is a complete HTML file with a functional calculator UI
- Without `--read-only`, the agent may also create files or run shell commands in your working directory
- Exit code 0

**✅ Success looks like:**

Tokens appear character-by-character (or in small chunks) as the model writes. You'll watch the `<!DOCTYPE html>` tag form, then `<style>` blocks fill in, then `<script>` logic materialize — like watching someone type very fast. Once the model finishes, the stream ends and you're back at your shell prompt with exit code 0.

---

### Test 2: Inline Prompt (Blocking / No Stream)

```bash
npx copilot-agents run --no-stream -p "Create a basic HTML calculator with +, -, ×, ÷ operations. Single file."
```

**What to expect:**

- The terminal is **silent** while the model works — no progressive output
- After several seconds, the entire response prints at once as a single block
- Same calculator output content as Test 1, just different delivery timing
- Exit code 0

**Key difference from Test 1:**

Streaming mode (`-s`, the default) uses an event listener that prints tokens as `assistant.message_delta` events arrive — you see the response being built in real-time. Blocking mode (`--no-stream`) calls `sendAndWait()` internally, which collects the entire response before returning it. Use blocking when you want to capture clean output (e.g., piping to a file) without interleaved streaming artifacts.

---

### Test 3: Prompt from File

First create a prompt file:

```bash
cat > /tmp/calc-prompt.txt << 'EOF'
Build an HTML calculator with these requirements:
- Single HTML file with embedded CSS and JS
- Buttons: 0-9, +, -, ×, ÷, =, C, .
- Display showing current input and result
- Keyboard support for number entry
- Clean, modern styling
EOF
```

> **Note on `/tmp`:** The `/tmp` directory is cleared on system reboot (and may be periodically cleaned by the OS). This is fine for ephemeral test files, but don't store anything important there.

> **Note on heredoc quoting:** The `<< 'EOF'` syntax (with quotes around EOF) is intentional — it prevents the shell from expanding `$variables` inside the heredoc. Never use unquoted `<< EOF` for untrusted content, as shell variables like `$HOME` or command substitutions like `$(rm -rf /)` would be interpreted.

Then run:

```bash
npx copilot-agents run -f /tmp/calc-prompt.txt
```

**What to expect:**

- The CLI reads `/tmp/calc-prompt.txt`, validates the file exists and is readable
- The file content becomes the prompt — sent exactly as written
- Streaming output begins (default mode) with a more detailed calculator matching all five requirements
- The `--file` flag takes priority over `--prompt` if both are somehow provided
- Exit code 0

---

### Test 4: Prompt from Stdin (Pipe)

```bash
echo "Create a minimal HTML calculator" | npx copilot-agents run
```

**What to expect:**

- The CLI detects stdin is not a TTY (it's a pipe), so it reads the piped text as the prompt
- No `--prompt` or `--file` flag needed — stdin is the lowest-priority prompt source
- Output streams to the terminal as normal
- Exit code 0

> **Stdin timeout:** The CLI waits up to **30 seconds** for stdin input. If the pipe breaks or the upstream process stalls beyond 30s, the CLI will exit with a timeout error: `"Timed out reading from stdin after 30000ms"`. In scripts, ensure the piped command completes promptly.

**Also try multi-line stdin:**

```bash
cat /tmp/calc-prompt.txt | npx copilot-agents run
```

This is equivalent to Test 3 but uses stdin instead of `--file`.

---

### Test 5: Save Output to File

```bash
npx copilot-agents run --no-stream -p "Create a basic HTML calculator. Output ONLY the HTML code, no explanations." > calculator.html
```

> **⚠️ File overwrite warning:** The `>` redirect will **overwrite** `calculator.html` if it already exists in the current directory — without confirmation. Use `>>` to append instead, or check for the file first with `ls calculator.html 2>/dev/null`.

**What to expect:**

- Blocking mode ensures the full response is captured cleanly by shell redirection
- `calculator.html` should be a valid HTML file you can open directly in a browser
- No streaming artifacts or partial writes in the file

**Verify:**

```bash
head -5 calculator.html  # Should start with <!DOCTYPE html> or <html>
open calculator.html      # macOS: opens in default browser
```

> **Cross-platform `open` command:** `open` is macOS-only. On Linux, use `xdg-open calculator.html`. On Windows (Git Bash/WSL), use `start calculator.html` or `wslview calculator.html`.

> **Note:** If the model wraps the code in markdown fences (` ```html ... ``` `), you may need to strip them. Using `--no-stream` helps ensure the output is a single clean block for post-processing.

---

### Test 6: Specific Model Selection

```bash
npx copilot-agents run -m gpt-5.4 -p "Create a basic HTML calculator"
```

**What to expect:**

- The specified model (`gpt-5.4`) is used for generation instead of the default
- Output quality and speed may vary depending on the model
- Exit code 0

**Try with different models to compare:**

```bash
npx copilot-agents run -m claude-sonnet-4.6 -p "Create a basic HTML calculator"
```

---

### Test 7: Resume a Session

```bash
# First run — note the session ID from output
npx copilot-agents run -p "Create an HTML calculator with basic operations" -v
```

Look for a session ID in the verbose output, then:

```bash
# Second run — add features to the same session context
# ⚠️ Replace <SESSION_ID> below with the ACTUAL session ID from the first run's verbose output.
# Example session ID format: a1b2c3d4-e5f6-7890-abcd-ef1234567890
npx copilot-agents run --resume --session-id <SESSION_ID> -p "Now add a history panel that shows the last 10 calculations"
```

> **⚠️ Session ID is a required placeholder:** You MUST replace `<SESSION_ID>` with the real session ID printed during the first run (visible in `-v` verbose output). Copy-pasting the command literally will fail.
>
> **What happens with a wrong/expired session ID:** The CLI will exit with an error like `"Session creation failed: ..."`. Session IDs are not persistent across CLI restarts by default — you must use the ID from a session created in the same CLI process lifetime.

**What to expect:**

- The second run picks up where the first left off — it has full context of the calculator already created
- The model enhances the existing calculator rather than building from scratch
- The history panel references the existing calculator structure
- Without `--resume`, the model would have no knowledge of the first run

---

### Test 8: Read-Only Mode

> **💡 Recommended first test:** If you're unfamiliar with the `run` command, start here. Read-only mode is the safest way to explore — it prevents the agent from writing files, running shell commands, invoking MCP tools, or fetching URLs.

```bash
npx copilot-agents run --read-only -p "Create an HTML calculator"
```

**What to expect:**

- Only `read` permissions are approved — **all other permission kinds are denied**: `shell`, `write`, `mcp`, `url`, and `custom-tool`
- The model can still **generate** code as text output to the terminal
- No files are written to disk, no shell commands executed, no MCP tools invoked, no URLs fetched by the agent — it's output-only
- Useful for getting code suggestions without allowing the agent to modify your filesystem or call external services
- Exit code 0

---

### Test 9: Custom System Message

> **⚠️ System message safety:** System messages directly control agent behavior. A crafted system message can instruct the agent to perform specific actions (write files, run commands) if `--read-only` is not enabled. Only use system messages you trust, and consider pairing with `--read-only` when experimenting.

```bash
npx copilot-agents run --system-message "You are a senior frontend developer. Always use CSS Grid for layouts. Use only CSS custom properties for colors." -p "Create an HTML calculator"
```

**What to expect:**

- The output is influenced by the system message — the calculator should use CSS Grid for its button layout instead of flexbox or tables
- Color values should be defined as CSS custom properties (`--var-name`)
- The default system message is appended to (mode: `append`) unless `--system-message-mode replace` is specified

**Try with replace mode:**

```bash
npx copilot-agents run \
  --system-message "Output only raw HTML. No explanations, no markdown fences." \
  --system-message-mode replace \
  -p "Create an HTML calculator"
```

---

### Test 10: Timeout Test

```bash
npx copilot-agents run -t 5000 -p "Create a very complex scientific calculator with graphing capabilities, matrix operations, unit conversions, and a full equation parser with LaTeX rendering"
```

**What to expect:**

- The timeout is 5 seconds (5000ms) — aggressive for a complex generation task
- If the model doesn't finish in time, the session is aborted gracefully via `session.abort()`
- Exit code 1 (`GeneralError`) — the timeout handler creates a plain `Error` which maps to the general exit code
- Partial output may have been streamed before the timeout hit

> **⚠️ Partial output warning:** An aborted session may leave **partial files** in your working directory if the agent was in the middle of writing when the timeout fired. `session.abort()` stops the agent but does **not** roll back filesystem changes. After a timeout, check your working directory for incomplete artifacts (e.g., half-written `.html` or `.js` files) and delete them manually.

**Compare with a generous timeout:**

```bash
npx copilot-agents run -t 300000 -p "Create a basic HTML calculator"
```

This gives 5 minutes — more than enough. Default timeout is 120000ms (2 minutes).

---

### Test 11: Verbose Mode

```bash
npx copilot-agents run -v -p "Create a basic HTML calculator"
```

**What to expect:**

- Debug-level logs with timestamps appear alongside the normal output
- Tool execution events are logged (which tools the agent considered or invoked)
- Session lifecycle events are visible: creation, message send, idle detection, disconnect
- Useful for diagnosing why a run behaved unexpectedly

**Look for lines showing:**

- Session ID assignment
- Model selection
- Message dispatch events
- Tool call start/end events
- Session idle/disconnect events

---

### Test 12: File Attachment

```bash
cat > /tmp/calc-style.css << 'EOF'
.calculator { background: #1a1a2e; border-radius: 16px; padding: 20px; max-width: 320px; margin: 40px auto; }
.display { background: #16213e; color: #e94560; font-size: 2rem; padding: 20px; text-align: right; border-radius: 8px; margin-bottom: 16px; }
.btn { background: #0f3460; color: white; border: none; border-radius: 8px; padding: 16px; font-size: 1.2rem; cursor: pointer; }
.btn:hover { background: #1a4a8a; }
.btn-op { background: #e94560; }
.btn-eq { background: #00b4d8; grid-column: span 2; }
EOF
```

> **Note on `/tmp`:** Same as Test 3 — `/tmp` is cleared on reboot. This is fine for test artifacts.

```bash
npx copilot-agents run --attach /tmp/calc-style.css -p "Create an HTML calculator using the attached CSS style file. Use the exact class names from the CSS."
```

**What to expect:**

- The model receives the content of `/tmp/calc-style.css` as context alongside the prompt
- The generated HTML references the exact class names from the CSS (`.calculator`, `.display`, `.btn`, `.btn-op`, `.btn-eq`)
- The dark color scheme from the attachment is reflected in the output
- Exit code 0

---

## Copy-Paste Safety

> **Before running any command**, verify:
> - All quotes are **straight** (`"` `'`), not curly/smart quotes (`"` `"` `'` `'`). Some text editors and websites auto-convert these.
> - The Unicode multiplication sign `×` and division sign `÷` in prompts (Tests 1–3) are safe inside bash-quoted strings, but if your terminal has encoding issues, replace them with `*` and `/`.
> - Every heredoc `<< 'EOF'` has a matching `EOF` on its own line with **no leading whitespace**.
> - `<SESSION_ID>` in Test 7 is a **placeholder** — do not paste it literally.

---

## Red Flags to Watch For

| # | Red Flag | What It Means |
|---|----------|---------------|
| 1 | **Output truncated mid-HTML** | Streaming disconnected early or timeout hit silently — check exit code and try `--no-stream` |
| 2 | **Timeout on a simple prompt** | Network issue, model overloaded, or default timeout too low — try with `-t 300000` |
| 3 | **Model ignores instructions** | System message not applied, or model not following prompt — try `--system-message-mode replace` |
| 4 | **`--no-stream` still shows progressive output** | Blocking mode not engaged — verify flag is parsed correctly (not `--no-streaming`) |
| 5 | **Stdin hangs when not piped** | TTY detected but no prompt provided — CLI should error, not hang. Must use `-p` or `-f` in interactive terminals |
| 6 | **Exit code 1 on successful output** | Disconnect or cleanup error after response completed — check verbose output for lifecycle issues |
| 7 | **Session not created with `--resume`** | Session ID invalid or expired — session IDs are not persistent across CLI restarts by default |
| 8 | **Verbose output shows hook errors** | SDK hooks (onSessionStart, onPreToolUse) throwing — indicates configuration or permission issues |
| 9 | **`--read-only` still writes files or runs shell** | Permission enforcement not working — `createReadOnlyPermissionHandler` should only approve `read` kind. Serious bug, report immediately |
| 10 | **Attached file content not reflected in output** | `--attach` file not sent to model context — check file path exists and is readable |

---

## Cleanup

After running these tests, remove the temporary files created during testing:

```bash
# Remove temporary prompt and style files
rm -f /tmp/calc-prompt.txt /tmp/calc-style.css

# Remove generated calculator file (if created by Test 5 or by the agent)
rm -f calculator.html

# Check for any other files the agent may have created in your working directory
# (Tests without --read-only allow the agent to create files)
git status    # If in a git repo — shows untracked files
ls -lt | head # Most recently modified files
```

> **Tip:** Run tests in a dedicated empty directory (e.g., `mkdir /tmp/copilot-test && cd /tmp/copilot-test`) to isolate agent-created artifacts from your real projects.

---

## What This Proves

When all 12 tests pass, you've validated that the `run` command works correctly across:

- **All three prompt sources:** inline (`-p`), file (`-f`), and stdin (pipe) — with correct priority ordering
- **Both output modes:** streaming (real-time token delivery) and blocking (single response)
- **Session management:** creating new sessions, resuming existing ones with `--session-id` and `--resume`
- **Safety controls:** `--read-only` mode restricting all non-read access (write, shell, MCP, URL, custom-tool), custom system messages shaping output
- **Model flexibility:** selecting specific models with `-m`
- **Timeout handling:** graceful abort with correct exit codes on deadline exceeded
- **SDK integration:** file attachments reaching the model context, verbose diagnostics exposing lifecycle events
- **Output capture:** clean blocking output suitable for shell redirection to files

This is the core command — if `run` works, the foundation is solid.
