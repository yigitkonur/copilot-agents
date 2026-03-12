# 01 — `whoami`: Verify Your Identity

## Prerequisites

- **Node.js ≥ 20** (`node -v` to check)
- Run `npm install` first — this triggers `scripts/postinstall.js` which patches the SDK to fix an `ERR_MODULE_NOT_FOUND` crash (`vscode-jsonrpc/node` → `vscode-jsonrpc/node.js`)
- A valid GitHub token in your environment (e.g. `GITHUB_TOKEN` or logged-in via `copilot auth login`)
- **Platform**: All commands below use POSIX shell syntax (bash, zsh). On Windows, use WSL or Git Bash — `VAR= command` syntax does **not** work in PowerShell or cmd.exe.

## What This Command Does

Confirms you're authenticated with GitHub Copilot and can reach the server. This is the first thing to run before any coding session — if `whoami` fails, nothing else will work. Think of it as the preflight check before we build our HTML calculator.

This command is **read-only** — it never writes to disk, modifies config, or changes any state. Safe to run repeatedly.

## Test Cases

### Test 1: Basic Auth Check

```bash
npx copilot-agents whoami
```

**What to expect:**

- A success message with your GitHub login (username)
- The host you're connected to (e.g. `github.com`)
- Authentication type (e.g. `oauth`, `token`, `unknown`)
- An optional status message (only if the server provides one)
- Server version and protocol version (always shown)

**✅ Success looks like:**

```
✓ Logged in as: yigitkonur
  Host: github.com
  Auth type: oauth
  Status: Active

Server status:
  Version:  1.2.3
  Protocol: v2024-11-15
```

**❌ Failure looks like:**

```
✗ Not authenticated. Run `copilot auth login` to sign in.
```

Exit code will be `2` (AuthError).

---

### Test 2: Verbose Auth + Quota

```bash
npx copilot-agents whoami --verbose
```

Or using the short flag:

```bash
npx copilot-agents whoami -v
```

**What to expect:**

- Everything from Test 1 (login, host, auth type, status, server info)
- Full auth details block (authenticated flag, login, host, auth type, status)
- Connection state with emoji indicator (e.g. `🟢 connected`, `🔴 error`)
- Ping result: server message and timestamp (not latency)
- Quota info per category: remaining percentage, used/total requests, reset date

**✅ Success looks like:**

```
✓ Logged in as: yigitkonur
  Host: github.com
  Auth type: oauth
  Status: Active

Auth details:
  Authenticated: true
  Login:         yigitkonur
  Host:          github.com
  Auth type:     oauth
  Status:        Active

Connection: 🟢 connected
  Ping:      pong (2025-07-10T12:34:56.789Z)

Quota:
  chat: 92% remaining (82/1000 used)
    Resets: 2025-07-15T00:00:00Z

Server status:
  Version:  1.2.3
  Protocol: v2024-11-15
```

**Notes:**
- Ping and quota info are best-effort — if unavailable, they are silently skipped (debug log only).
- Connection state is re-checked after the client connects, so it should read `🟢 connected` on success.

---

### Test 3: No GitHub Token (Negative Test)

> ⚠️ **Warning**: This test temporarily unsets `GITHUB_TOKEN` for a single command. The `VAR= command` syntax is a POSIX shell feature that sets an environment variable **only for that one command** — your shell session's `GITHUB_TOKEN` is unaffected afterward. If you authenticate via `gh auth login` (OAuth) rather than `GITHUB_TOKEN`, this test may still succeed.

```bash
GITHUB_TOKEN= npx copilot-agents whoami
```

**What to expect:**

- Command should fail with an authentication error
- Exit code should be `2` (AuthError) if the server connects but reports unauthenticated
- Exit code could also be `3` (ConnectionError) or `1` (GeneralError) if the SDK cannot start without a token
- No login/host/quota info displayed

```bash
# Verify exit code:
GITHUB_TOKEN= npx copilot-agents whoami; echo "Exit code: $?"
# Expected: Exit code: 2 (or 3 if connection fails before auth check)
```

> **Note**: The semicolon (`;`) is intentional — it ensures `echo` runs regardless of the prior command's exit code. Using `&&` instead would skip the echo on failure.

---

### Test 4: Network Failure / Server Unreachable

If the Copilot server is down or unreachable (e.g. no internet, DNS failure, firewall), the command will fail during client startup:

```
✗ <connection error message>
```

- Expected exit code: `3` (ConnectionError) — or `1` (GeneralError) for unexpected errors
- The command will **not** hang indefinitely; the SDK has internal timeouts

This is not a test you need to run manually, but be aware this is the expected behavior if your network is disrupted.

## Exit Code Reference

| Code | Constant         | Meaning                                      |
|------|------------------|----------------------------------------------|
| `0`  | `Success`        | Authenticated and server reachable            |
| `1`  | `GeneralError`   | Unexpected / unclassified error               |
| `2`  | `AuthError`      | Not authenticated or token expired/revoked    |
| `3`  | `ConnectionError`| Cannot reach the Copilot server               |
| `4`  | `TimeoutError`   | Operation timed out                           |
| `5`  | `PromptError`    | Invalid or unreadable prompt                  |
| `6`  | `SessionError`   | Session creation / lookup / resumption failed |

## Red Flags to Watch For

- **Quota nearly exhausted** (remaining < 5%) — you may hit rate limits mid-session
- **Unexpected auth type** — if you see `token` when you expected `oauth`, your env may be overriding credentials
- **Connection state not `🟢 connected`** — partial auth; server may reject subsequent requests
- **Quota reset date in the past** — quota data may be stale; try again after a short wait
- **Exit code 2 when you expect success** — token expired or revoked; re-authenticate with `copilot auth login` before proceeding
- **Ping unavailable** — server may not support the ping endpoint; not necessarily fatal

## Technical Notes

### Process Cleanup

The `whoami` command calls `clientManager.stop()` in a `finally` block, ensuring the SDK child process is cleaned up on both success and failure. However, if authentication fails, `process.exit(2)` is called inside the `try` block — the `finally` block still runs, but the `await clientManager.stop()` may not fully complete before the process terminates. In practice, the SDK's registered `SIGINT`/`SIGTERM` shutdown handlers and OS-level process reaping prevent zombie processes, but if you notice stale `copilot-language-server` processes, kill them manually with `pkill -f copilot-language-server`.

### Output & Special Characters

The logger does **not** escape or sanitize output. GitHub usernames are restricted to alphanumeric characters and hyphens, so this is safe in practice. If a server-provided field (e.g. `statusMessage`) contained ANSI escape sequences, they would be rendered in the terminal. This is cosmetic only — no security risk.

## What This Proves Before Moving On

A passing `whoami` confirms three things: your credentials are valid, the Copilot server is reachable, and you have enough quota remaining to build the calculator. Proceed to the next command.
