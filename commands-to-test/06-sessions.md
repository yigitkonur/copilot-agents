# 06 — `sessions`: Manage & Inspect Sessions

## What This Command Does

The `sessions` command provides full lifecycle management for saved Copilot CLI sessions. You can list all sessions with filtering, view conversation history, inspect workspace files created during a session, read session plans, list available agents, abort running sessions, and delete sessions you no longer need. It's your window into everything the agent did and produced.

> **ℹ️ Side effects:** Most commands in this guide are **read-only** (`list`, `last`, `history`, `plan`, `agents`, `workspace list`, `workspace read`). The only commands that modify state are **`delete`** (permanently removes a session) and **`abort`** (stops a running session). Exercise caution with both.

## Prerequisites

- Copilot CLI installed and authenticated
- **You should have run commands from test guides 01–05 first** so you have real sessions to inspect. At minimum, run a few `copilot-agents run` or `copilot-agents chat` commands so the session list isn't empty.

> **📋 Variable setup:** Many tests below use `$SESSION_ID`. Set it **once** at the start of your testing session, then reuse it. If your shell session resets, re-run the capture command. Always verify variables are non-empty before using them (see Test 5).

> **⚠️ ANSI colors in output:** Non-JSON formatted output (e.g., `sessions history`) includes ANSI color codes. If you pipe this output to other tools, the escape sequences may cause unexpected matches or display issues. Use `--json` when piping output for reliable machine-readable results.

---

## Test Cases

### Test 1: List All Sessions

```bash
copilot-agents sessions list
```

**What to expect:**

- A formatted table showing all saved sessions
- Columns: **Session ID**, **Summary**, **Modified** (date), and **CWD**

**✅ Success looks like:**

```
Session ID                             Summary                                  Modified                CWD
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
a1b2c3d4-e5f6-7890-abcd-ef1234567890   Built a calculator app                   1/15/2025, 2:32:00 PM   /Users/you/project
f9e8d7c6-b5a4-3210-fedc-ba9876543210   Fixed CSS layout issues                  1/15/2025, 2:28:00 PM   /Users/you/project
...
```

---

### Test 2: List Sessions (JSON)

```bash
copilot-agents sessions list --json
```

**What to expect:**

- Valid JSON array of session objects
- Each object should contain at minimum: session ID, timestamps, working directory

**✅ Success looks like:**

```json
[
  {
    "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "summary": "Built a calculator app",
    "modifiedTime": "2025-01-15T14:32:00.000Z",
    "context": {
      "cwd": "/Users/you/project"
    }
  }
]
```

**Pro tip:** Pipe through `jq` to inspect individual sessions:

```bash
copilot-agents sessions list --json | jq '.[0]'
```

---

### Test 3: Filter Sessions by CWD

```bash
copilot-agents sessions list --cwd $(pwd)
```

**What to expect:**

- Only sessions created from your current working directory appear
- Sessions from other directories are excluded
- Compare with unfiltered `sessions list` to verify filtering works

---

### Test 4: Filter Sessions by Repository

```bash
copilot-agents sessions list --repo owner/repo-name
```

**What to expect:**

- Only sessions associated with the specified repository
- Useful when you work across multiple repos

---

### Test 5: Get Last Session ID

```bash
copilot-agents sessions last
```

**What to expect:**

- Prints the most recent session ID as a single line of text
- No extra formatting — just the raw ID
- If no previous session exists, prints "No previous session found"

**✅ Success looks like:**

```
a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Pro tip:** Capture it for use in subsequent commands:

```bash
SESSION_ID=$(copilot-agents sessions last)

# ⚠️ Always verify the variable before using it in subsequent commands.
# If no session exists, SESSION_ID will contain "No previous session found"
# or be empty, which would cause subsequent commands to fail or behave unexpectedly.
echo "Last session: $SESSION_ID"

# Guard: abort if the variable doesn't look like a UUID
if [[ ! "$SESSION_ID" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "ERROR: Failed to capture a valid session ID. Got: '$SESSION_ID'"
  # Do not proceed with subsequent commands
fi
```

---

### Test 6: View Conversation History

```bash
SESSION_ID=$(copilot-agents sessions last)
echo "Using session: $SESSION_ID"  # Verify before proceeding
copilot-agents sessions history $SESSION_ID
```

**What to expect:**

- Formatted conversation showing message events with colored role prefixes
- User messages shown as `[user]` (cyan) followed by the prompt text
- Assistant messages shown as `[assistant]` (green) followed by the content
- Other event types (e.g., tool calls) shown as `[event.type]` in grey
- A summary count of total events at the end

**✅ Success looks like:**

```
[user] Create a simple calculator in HTML

[assistant] I'll create a calculator web application for you...

[tool.call]

12 event(s)
```

---

### Test 7: History as JSON

```bash
SESSION_ID=$(copilot-agents sessions last)
echo "Using session: $SESSION_ID"  # Verify before proceeding
copilot-agents sessions history $SESSION_ID --json
```

**What to expect:**

- Full message event objects in JSON format (from `session.getMessages()`)
- Each event has a `type` field (e.g., `user.message`, `assistant.message`) and a `data` object
- User messages have `data.prompt`, assistant messages have `data.content`

**✅ Success looks like:**

```json
[
  {
    "type": "user.message",
    "data": {
      "prompt": "Create a simple calculator in HTML"
    }
  },
  {
    "type": "assistant.message",
    "data": {
      "content": "I'll create a calculator web application..."
    }
  }
]
```

**Pro tip:** Combine with `jq` to extract just assistant responses:

```bash
copilot-agents sessions history $SESSION_ID --json | jq '[.[] | select(.type == "assistant.message") | .data.content]'
```

> **Note:** You can also use `--format json` as an alternative to `--json`.

---

### Test 8: View Session Plan

```bash
SESSION_ID=$(copilot-agents sessions last)
echo "Using session: $SESSION_ID"  # Verify before proceeding
copilot-agents sessions plan $SESSION_ID
```

**What to expect:**

- The plan content for the session, if one exists
- If no plan exists, prints "No plan exists for this session"

**✅ Success looks like:**

```
## Plan
1. Create the HTML structure
2. Add CSS styling
3. Implement JavaScript calculator logic
```

**With JSON output:**

```bash
copilot-agents sessions plan $SESSION_ID --json
```

---

### Test 9: List Available Agents

```bash
SESSION_ID=$(copilot-agents sessions last)
echo "Using session: $SESSION_ID"  # Verify before proceeding
copilot-agents sessions agents $SESSION_ID
```

**What to expect:**

- A formatted table showing agents available for the session
- Columns: **Name**, **Display Name**, **Description**
- If no agents are available, prints "No agents available"

**With JSON output:**

```bash
copilot-agents sessions agents $SESSION_ID --json
```

---

### Test 10: List Workspace Files

```bash
SESSION_ID=$(copilot-agents sessions last)
echo "Using session: $SESSION_ID"  # Verify before proceeding
copilot-agents sessions workspace list $SESSION_ID
```

**What to expect:**

- A list of files the agent created or modified during that session
- If the session involved building a calculator, you should see files like `calculator.html`, `index.html`, or similar
- Files that only existed in the agent's workspace (not written to disk) will also appear

**✅ Success looks like:**

```
calculator.html
styles.css
```

**With JSON output:**

```bash
copilot-agents sessions workspace list $SESSION_ID --json
```

---

### Test 11: Read a Workspace File

```bash
SESSION_ID=$(copilot-agents sessions last)
echo "Using session: $SESSION_ID"  # Verify before proceeding

# First, list files to find a valid path
copilot-agents sessions workspace list $SESSION_ID

# Then read one of the listed files
# ⚠️ Replace "calculator.html" below with an actual path from the list output above.
# This is a manual substitution — copy-paste the exact filename shown.
copilot-agents sessions workspace read $SESSION_ID calculator.html
```

**What to expect:**

- The full file content printed to stdout
- Content should match what the agent produced during that session
- This works even if the file was never written to your actual filesystem

> **🔒 Workspace path scoping:** Workspace paths are scoped to the session's working directory. The `path` argument refers to files within the agent's workspace sandbox, not arbitrary filesystem paths. Only files listed by `workspace list` are accessible.

---

### Test 12: Delete a Session

> ⚠️ **Warning**: `sessions delete` is **irreversible**. The session and all its history, plan, and workspace files are permanently removed and cannot be recovered. Never delete a session you may want to reference later.

```bash
# First, create a throwaway session to safely delete
copilot-agents run -p "Say hello"
THROWAWAY=$(copilot-agents sessions last)

# ⚠️ Always verify the variable captured a valid session ID
echo "Throwaway session: $THROWAWAY"
if [[ -z "$THROWAWAY" ]]; then
  echo "ERROR: Failed to capture throwaway session ID. Aborting test."
  # Do not proceed — grep on an empty variable matches everything!
fi

# Verify it exists in the list
copilot-agents sessions list | grep "$THROWAWAY"

# Delete it
copilot-agents sessions delete "$THROWAWAY"

# Verify it's gone (grep should return no matches / exit code 1)
copilot-agents sessions list | grep "$THROWAWAY"
```

**What to expect:**

- The `delete` command should confirm the session was removed
- The final `grep` should return empty (exit code 1) — the session no longer exists
- Other sessions should remain untouched

> **⚠️ grep safety:** Always quote `"$THROWAWAY"` and verify it's non-empty before using it with grep. Running `grep ""` (empty pattern) matches **every line**, which would make verification meaningless.

---

### Test 13: Abort a Session

```bash
copilot-agents sessions abort <SESSION_ID>
```

**What to expect:**

- If the session is **currently running**, it will be aborted and you'll see a confirmation: `Aborted session: <id>`
- If the session has **already completed or is not running**, the command will attempt to resume and abort the session. This may produce an error from the SDK (e.g., the abort call may be a no-op or throw an error), which is caught and displayed as a clean error message with a non-zero exit code.
- This is most useful when a `chat` or `run` command is stuck or taking too long

> **Note:** To test this properly, you'd need a long-running session in another terminal. Start `copilot-agents run -p "Write a very detailed 10000-word essay"` in one terminal, then abort it from another.

> **ℹ️ Aborting a finished session:** The source code does not special-case already-completed sessions. The `abort` call goes through `withResumedSession` which resumes the session then calls `session.abort()`. If the SDK rejects the abort on a finished session, you'll see a clean error message (not a stack trace) — the error is caught by the standard `toAppError` handler.

---

### Test 14: Error Handling — Non-Existent Session

```bash
copilot-agents sessions delete nonexistent-session-id-12345
```

**What to expect:**

- A **clean error message** indicating the session was not found (not a raw stack trace)
- Non-zero exit code
- The error is caught by the `toAppError` handler, which normalizes SDK errors into user-friendly messages

**✅ Verify exit code:**

```bash
copilot-agents sessions delete nonexistent-session-id-12345
echo "Exit code: $?"
# Should print a non-zero value (e.g., 1)
```

**Also test with `history`:**

```bash
copilot-agents sessions history nonexistent-session-id-12345
echo "Exit code: $?"
# Should also produce a clean error and non-zero exit code
```

> **ℹ️** Both `delete` and `history` (and other session subcommands) use the same error handling pattern: SDK errors are caught by `toAppError()` and displayed as a single-line error message. If you see a raw stack trace instead, that's a bug worth reporting.

---

### Test 15: Filter by Branch

```bash
copilot-agents sessions list --branch main
```

**What to expect:**

- Only sessions created while on the `main` branch
- If you've been working on a feature branch, those sessions should be excluded

---

## Cleanup

After running through these tests, you may have leftover test sessions (e.g., the "Say hello" throwaway from Test 12). To keep your session list clean:

```bash
# List all sessions and identify any test artifacts
copilot-agents sessions list

# Delete any sessions you created solely for testing
# ⚠️ Remember: delete is irreversible — double-check the session ID before running
copilot-agents sessions delete <test-session-id>
```

---

## Red Flags to Watch For

1. **Sessions not persisting** — Running `run` or `chat` commands but `sessions list` shows nothing afterward
2. **List returning empty** — When you know sessions should exist from previous test guides
3. **History missing messages** — Conversation shows fewer events than you actually exchanged
4. **Workspace files not accessible** — `workspace list` returns empty for sessions that clearly created files
5. **Delete not actually removing** — Session still appears in `list` after `sessions delete`
6. **`last` returning wrong session** — The ID doesn't match your most recent activity
7. **Filters not working** — `--cwd`, `--repo`, or `--branch` flags don't narrow results at all
8. **Malformed JSON output** — `--json` flag produces invalid JSON that can't be parsed by `jq`
9. **Plan not readable** — `sessions plan` crashes instead of showing plan content or "no plan" message
10. **Agents not listing** — `sessions agents` crashes instead of showing available agents

---

## What This Proves

When all tests pass, you've verified the full session lifecycle works end-to-end:

- **Create** — Sessions are automatically persisted when you use `run` or `chat`
- **List & Filter** — You can find sessions by directory, repo, or branch
- **Inspect** — Conversation history, plans, agents, and workspace files are retrievable after the session ends
- **Manage** — Sessions can be aborted while running or deleted when no longer needed
- **Edge cases** — Error handling works for missing/invalid session IDs

This gives you confidence that Copilot CLI maintains a reliable audit trail of all agent interactions and their artifacts.
