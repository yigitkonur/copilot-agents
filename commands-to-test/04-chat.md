# 04 — `chat`: Interactive REPL Session

> **⚠️ Safety note:** By default, chat mode allows the agent to modify files and run shell commands in your working directory. Use `copilot-agents chat --read-only` for safe, non-destructive exploration.

## What This Command Does

The `chat` command starts an interactive multi-turn conversation session with real-time streaming output. You type messages at a readline prompt, receive streamed responses token-by-token, and the full conversation context is maintained across turns. Built-in slash commands let you switch models, change modes, view plans, manage agents, compact history, and abort long-running generations — all without leaving the REPL.

## Conventions Used in This Guide

> In the examples below, **`You:`** represents your typed input at the REPL prompt — type only the text **after** `You:`. Do not copy the `You:` prefix itself.
>
> **Multi-line paste warning:** The REPL processes each pasted line independently. If you paste a block of text where any line starts with `/`, it will be interpreted as a slash command. Paste one message at a time to avoid unintended commands.

## Test Cases

### Test 1: Start a New Chat Session

```bash
npx copilot-agents chat
```

**What to expect:**

- A readline prompt appears showing a colored `❯` character
- You can type messages and get streaming responses
- Session persists between messages (context maintained)

**Try this conversation:**

```
You: Create a basic HTML calculator with +, -, ×, ÷ buttons and a display
(wait for response)
You: Now add keyboard support so pressing 0-9, +, -, *, / and Enter works
(wait for response — should reference the existing calculator)
You: Add a history panel on the right side showing the last 5 calculations
(wait for response — should add to the same calculator)
```

**✅ Success looks like:**

- Tokens stream in real-time (you see text appearing character by character)
- Each turn builds on previous context — the AI remembers the calculator it created
- The third response modifies the existing code rather than starting from scratch

### Test 2: Slash Command — /help

```
You: /help
```

**What to expect:**

- A list of all available slash commands with brief descriptions
- Should include at minimum: `/help`, `/model`, `/mode`, `/plan`, `/compact`, `/abort`, `/agents`, `/agent`, `/quit`
- Output is immediate (no AI generation, just local command)

### Test 3: Slash Command — /model

```
You: /model
You: /model gpt-5.4
You: /model
```

**What to expect:**

- First `/model` — shows the current model name (e.g., `gpt-5.4` or `claude-sonnet-4.6`)
- `/model gpt-5.4` — switches to gpt-5.4, confirms the switch
- Second `/model` — shows `gpt-5.4` confirming the change took effect

### Test 4: Slash Command — /mode

```
You: /mode
You: /mode plan
You: Create an HTML calculator with scientific functions (sin, cos, tan, log, sqrt)
You: /plan
You: /mode autopilot
```

> **⚠️ CAUTION — Autopilot mode:** `/mode autopilot` allows the agent to take actions — file writes, shell commands, tool calls — **without asking for confirmation**. Only use autopilot in a safe, disposable directory. Recommended setup:
>
> ```bash
> mkdir /tmp/calc-test && cd /tmp/calc-test && npx copilot-agents chat
> ```
>
> Then switch to autopilot inside the REPL. Use `/mode interactive` to return to confirmation-required mode.

**What to expect:**

- `/mode` — shows the current mode (e.g., `interactive`)
- `/mode plan` — switches to plan mode, confirms the switch
- The next message — AI creates a plan instead of immediately writing code
- `/plan` — displays the plan the AI just created
- `/mode autopilot` — switches to autopilot mode to execute the plan

### Test 5: Slash Command — /compact

After several conversation turns:

```
You: /compact
```

**What to expect:**

- Session history is compacted (summarized to reduce token usage)
- Confirmation message that compaction completed
- Conversation continues normally — you can still reference earlier context
- Subsequent messages should still have awareness of what was discussed

### Test 6: Slash Command — /abort

During a long response:

```
You: Create an extremely detailed scientific calculator with graphing capabilities, 3D plotting, matrix operations, symbolic algebra, and unit conversion for every SI unit
(while streaming) Ctrl+C or type /abort
```

**What to expect:**

- Current generation stops mid-stream
- The prompt returns — you can type again
- Session is still alive (not crashed)
- You can send another message and get a normal response

> **Ctrl+C details:** During streaming, Ctrl+C calls `session.abort()`. If abort fails, the REPL closes automatically as a safety fallback. There is no second-Ctrl+C handler — a single Ctrl+C during streaming aborts; a single Ctrl+C at idle exits the REPL.
>
> **If the REPL becomes completely unresponsive**, use `Ctrl+\` (SIGQUIT) to force-kill the process. This is a last resort — it will not disconnect the session gracefully.

### Test 7: Slash Command — /agents

```
You: /agents
You: /agent
You: /agent <pick-one-from-list>
```

> **Note:** Different agents may have different capabilities and permission levels. Switching agents with `/agent <name>` changes what tools and actions are available. Review the agent list (`/agents`) to understand each agent's scope before selecting one.

**What to expect:**

- `/agents` — lists all available agents with their names and descriptions
- `/agent` (no argument) — shows the currently selected agent
- `/agent <name>` — selects that agent, confirms the switch
- Subsequent messages are routed to the selected agent

### Test 8: Resume Previous Session

```bash
# First, note the session ID from a previous chat (visible in session list or verbose output)
npx copilot-agents chat --resume --session-id <SESSION_ID>
```

**What to expect:**

- Session resumes with full context from the previous conversation
- No error about missing or expired session

**Try:**

```
You: What have we built so far?
```

- Should recall the calculator from previous turns
- Should be able to continue building on it

### Test 9: Read-Only Mode

```bash
npx copilot-agents chat --read-only
```

```
You: Create an HTML calculator and save it to calc.html
```

**What to expect:**

- Model generates code as text in the response
- The following permission types are **denied** in read-only mode:
  - `write` — file creation and modification
  - `shell` — shell command execution
  - `mcp` — MCP (Model Context Protocol) tool access
  - `url` — URL/network access
  - `custom-tool` — custom tool execution
- Only `read` permissions are approved
- No files are created on disk
- The AI may acknowledge it cannot write files in this mode

### Test 10: Custom System Message

```bash
npx copilot-agents chat --system-message "You are a senior frontend engineer. Always respond in bullet points. Use emojis for emphasis. Keep code examples minimal."
```

```
You: Explain how to build an HTML calculator
```

**What to expect:**

- Response follows the custom system message constraints
- Should use bullet points and emojis as instructed
- Demonstrates that the system message is injected into the conversation

### Test 11: Verbose and Timeout Flags

```bash
npx copilot-agents chat -v -t 30000
```

**What to expect:**

- `-v` (or `--verbose`) enables debug-level logging — you should see extra diagnostic messages (e.g., session hook events, debug-level log lines)
- `-t 30000` (or `--timeout 30000`) sets the per-message timeout to 30 seconds
- If a response takes longer than 30 seconds, it should time out with a "Timeout after 30000ms" error and return the prompt
- The default timeout (when not specified) is 120000ms (2 minutes)

### Test 12: Ctrl+C Behavior

**During a response:**

```
You: Write a 10,000 word essay about the history of computing
(while streaming) press Ctrl+C
```

**What to expect:**

- If a response is actively streaming (`isProcessing` is true), Ctrl+C calls `session.abort()` to stop the current generation
- If `abort()` fails, the REPL closes as a fallback (you will not get stuck)
- The prompt returns — you can type another message
- The REPL does NOT exit

**When idle (no response streaming):**

```
(at the prompt, not waiting for a response) press Ctrl+C
```

**What to expect:**

- The REPL exits cleanly (same as typing `/quit`)
- Prints "Goodbye!"

> **Stuck process:** If the REPL is completely unresponsive to Ctrl+C, press `Ctrl+\` (SIGQUIT) to force-terminate. This skips graceful session disconnect.

### Test 13: Exit the REPL

```
You: /quit
```

or `/exit` or `/q` — all three should work identically. Bare `exit` and `quit` (without the slash) also work as exit commands.

**What to expect:**

- Clean exit with a "Goodbye!" message
- Session is disconnected gracefully
- Terminal returns to normal shell prompt

## Session Cleanup

Chat sessions persist on the server. Over time, old sessions may accumulate. To manage them:

```bash
# List all saved sessions
npx copilot-agents sessions list

# Delete a specific session by ID
npx copilot-agents sessions delete <SESSION_ID>

# View conversation history before deleting
npx copilot-agents sessions history <SESSION_ID>
```

If you used `--session-id` to name a session, use that same ID to clean it up. Sessions from unnamed chats can be found via `sessions list`.

## Red Flags to Watch For

- **REPL prompt never appears** — session creation hangs or crashes before readline starts
- **Slash commands not recognized** — typing `/help` or `/model` is sent to the AI as a regular message instead of being handled locally
- **Context lost between turns** — the AI treats each message as a fresh conversation, doesn't remember the calculator it just built
- **`/model` switch silently fails** — command says it switched but `/model` still shows the old model, or the next response clearly uses the old model
- **`/abort` doesn't stop generation** — tokens keep streaming after abort, or the REPL hangs waiting for a response that was supposedly aborted
- **Ctrl+C kills the process** — instead of gracefully aborting the current generation, the entire process exits (Ctrl+C during streaming should abort; Ctrl+C when idle should exit cleanly)
- **Streaming freezes mid-response** — tokens stop appearing but the prompt doesn't return; the session is stuck
- **`--resume` fails to restore context** — session ID is accepted but the AI has no memory of previous messages
- **Timeout has no effect** — setting `-t 5000` doesn't cause a timeout error after 5 seconds on a slow response

## What This Proves

- Interactive multi-turn conversation works with maintained context across messages
- All slash commands (`/help`, `/model`, `/mode`, `/plan`, `/compact`, `/abort`, `/agents`, `/agent`, `/quit`) function correctly and control session behavior
- Real-time streaming delivers tokens as they're generated
- Sessions can be resumed with `--resume` and `--session-id`
- `--read-only` mode prevents file system modifications
- Graceful abort handling via Ctrl+C (during streaming) and `/abort` keeps the session alive
- Ctrl+C when idle exits the REPL cleanly
- Bare `exit` and `quit` (without slash) also work as exit commands
- `/agent` without argument shows current agent; `/agent <name>` selects one
- `--timeout` controls per-message timeout (default 120000ms)
- `--verbose` enables debug-level logging
