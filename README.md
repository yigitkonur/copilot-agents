# copilot-agents

Production-grade CLI for GitHub Copilot SDK agents — type-safe, parallelizable, race-condition free.

## Installation

```bash
npm install -g copilot-agents
```

## Quick Start

```bash
# Verify your GitHub Copilot identity
copilot-agents whoami

# List available models
copilot-agents models

# Run a single prompt against a model
copilot-agents run "Explain closures in JavaScript"

# Start an interactive chat session
copilot-agents chat

# Run prompts across multiple models in parallel
copilot-agents fleet "Compare REST vs GraphQL"

# List and manage past sessions
copilot-agents sessions
```

## Test Guides

Detailed usage and testing instructions for each command are in [`commands-to-test/`](./commands-to-test/):

- [01-whoami.md](./commands-to-test/01-whoami.md) — Identity & authentication
- [02-models.md](./commands-to-test/02-models.md) — Model listing & selection
- [03-run.md](./commands-to-test/03-run.md) — Single prompt execution
- [04-chat.md](./commands-to-test/04-chat.md) — Interactive chat
- [05-fleet.md](./commands-to-test/05-fleet.md) — Parallel multi-model runs
- [06-sessions.md](./commands-to-test/06-sessions.md) — Session management

## Requirements

- **Node.js** >= 20
- **GitHub Copilot** subscription (Individual, Business, or Enterprise)

## License

MIT
