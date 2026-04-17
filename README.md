# Forge

Forge is an experimental CLI for running a coding agent inside a controlled execution harness. It is built for the gap between "chat with a model" and "let an autonomous agent loose on your machine": the agent can inspect a repo, reason about it, request guarded actions, pause for approval, and leave behind a local trace of what happened.

Forge is not a general-purpose assistant, and it is not trying to be fully autonomous. The focus is narrow on purpose: predictable execution, explicit permissions, and an auditable run history.

## Current Status

- Experimental project
- CLI-only
- Local SQLite-backed run trace
- Small built-in tool surface
- Human approval required for guarded actions

## Why Forge

Most agent demos optimize for capability first and control later. Forge takes the opposite approach.

- It keeps the execution surface small.
- It records runs, steps, approvals, and outputs locally.
- It makes risky actions explicit instead of hiding them inside a long model response.
- It treats approval and traceability as product features, not afterthoughts.

## Current Capabilities

Forge can currently:

- Run a task against a local project from the CLI
- Use either `openai-codex` login or `openai` API-key auth
- Inspect the project with safe tools: `list_files`, `read_file`, `search_repo`
- Request guarded actions for `write_file`, `apply_patch`, and `run_command`
- Pause a run when approval is needed
- Resume a run after approval or rejection
- Persist a full local history of runs, steps, and approvals

## How It Works

At a high level, a Forge run looks like this:

1. You start a run with a task prompt.
2. Forge loads config, selects a provider, and starts a run record.
3. The provider reasons over the task and calls Forge tools.
4. Safe tools execute immediately.
5. Guarded tools create approvals and pause the run.
6. You approve or reject the requested action.
7. Forge resumes the run and records the final output.

Internally, the system is split into a small set of layers:

- Orchestrator: manages run lifecycle, pause/resume flow, and persistence
- Provider layer: handles model execution and authentication
- Tool runtime: validates tool inputs and enforces guarded execution
- Persistence: stores runs, steps, and approvals in SQLite

## Installation

Requirements:

- Node.js 20+
- `pnpm`

Install dependencies:

```bash
pnpm install
```

Common scripts:

```bash
pnpm build
pnpm check
pnpm test
```

## Authentication

Forge currently supports two provider kinds:

### `openai-codex`

This is the default in `forge.config.ts`.

- Auth mode: `login`
- Intended for ChatGPT Plus/Pro Codex access
- Uses a browser-based OAuth flow and stores credentials under `.forge/auth/openai-codex/`

Use this when you want the subscription-backed Codex flow rather than API billing.

Login:

```bash
pnpm forge -- auth login --provider openai-codex
```

Logout:

```bash
pnpm forge -- auth logout --provider openai-codex
```

### `openai`

- Auth mode: `api_key`
- Uses `OPENAI_API_KEY`
- Intended for direct OpenAI Platform API usage

Set your key:

```bash
export OPENAI_API_KEY=your_key_here
```

This path uses API billing. The `openai-codex` path is the subscription-oriented option.

## Quickstart

### 1. Authenticate with Codex

```bash
pnpm forge -- auth login --provider openai-codex
```

### 2. Run a task

```bash
pnpm forge -- run "Inspect this codebase and propose a safe refactor for the config loader."
```

If the run reaches a guarded action, Forge will pause and print the run status. You can inspect pending approvals with:

```bash
pnpm forge -- approvals
```

### 3. Approve a guarded action

```bash
pnpm forge -- approve <approval-id>
```

### 4. Resume the run

```bash
pnpm forge -- resume <run-id>
```

### 5. Inspect the trace

```bash
pnpm forge -- logs <run-id>
```

### Optional: run with the OpenAI API instead

```bash
export OPENAI_API_KEY=your_key_here
pnpm forge -- run "Review this repo for dead code." --provider openai
```

## Command Reference

Forge currently exposes these commands:

- `forge` (starts the interactive shell)
- `forge run <task>`
- `forge run` (starts the interactive shell)
- `forge shell`
- `forge resume <runId>`
- `forge approve <approvalId>`
- `forge reject <approvalId>`
- `forge logs <runId>`
- `forge runs`
- `forge approvals [--run <runId>]`
- `forge auth login [--provider <provider>]`
- `forge auth logout [--provider <provider>]`

Common options:

- `--project-root <path>` for `run` and auth commands
- `--provider <provider>` to override the configured provider for a run
- `--auth-mode <mode>` to override auth mode when the selected provider supports it

Examples:

```bash
pnpm forge --
pnpm forge -- shell
pnpm forge -- run
pnpm forge -- run --interactive "Inspect the repo, then wait for my follow-up."
pnpm forge -- runs
pnpm forge -- approvals --run <run-id>
pnpm forge -- run "Check the repository status and summarize the diff." --project-root /path/to/project
```

## Configuration

Forge loads configuration from `forge.config.ts`.

Current default configuration:

```ts
import { defineConfig } from "./src/config/define-config.js";

export default defineConfig({
  agent: {
    provider: {
      kind: "openai-codex",
      authMode: "login",
      model: "gpt-5.4",
      originator: "forge"
    },
    thinkingLevel: "medium",
    systemPromptFiles: ["./prompts/personality.md", "./AGENT.md"]
  },
  runtime: {
    stateDir: ".forge",
    sqlitePath: ".forge/forge.db"
  },
  permissions: {
    projectRootMode: "cwd",
    commandAllowlist: [
      { command: "git", argsPrefix: ["status"] },
      { command: "git", argsPrefix: ["diff"] },
      { command: "pnpm", argsPrefix: ["test"] }
    ]
  }
});
```

Example API-key configuration:

```ts
import { defineConfig } from "./src/config/define-config.js";

export default defineConfig({
  agent: {
    provider: {
      kind: "openai",
      authMode: "api_key",
      model: "gpt-5.4",
      apiKeyEnvVar: "OPENAI_API_KEY"
    },
    thinkingLevel: "medium",
    systemPromptFiles: ["./prompts/personality.md", "./AGENT.md"]
  },
  runtime: {
    stateDir: ".forge",
    sqlitePath: ".forge/forge.db"
  },
  permissions: {
    projectRootMode: "cwd",
    commandAllowlist: []
  }
});
```

## Safety Model

Forge keeps the execution model intentionally constrained.

### Safe vs Guarded Tools

Safe tools execute immediately:

- `list_files`
- `read_file`
- `search_repo`

Guarded tools require approval before execution:

- `write_file`
- `apply_patch`
- `run_command`

### Project Root Restriction

Tool access is restricted to the configured project root. File reads, writes, and command working directories are validated against that root before execution.

### Command Allowlist

`run_command` only works for commands explicitly listed in config. By default, the repository allows:

- `git status`
- `git diff`
- `pnpm test`

### Trace Persistence

Forge stores run state in local SQLite under `.forge/forge.db`. Each run records:

- run metadata
- ordered execution steps
- approvals and resolutions
- final output or failure information

## Current Limitations

Forge is intentionally small right now.

- No web UI
- No multi-agent orchestration
- Minimal default command allowlist
- No browser automation or distributed workflow engine
- Local, operator-driven workflow only
- Still experimental and likely to change

The older [AGENT.md](./AGENT.md) file is best read as a vision/background document. The README and current code are the source of truth for how Forge behaves today.

## Development

Useful commands:

```bash
pnpm build
pnpm check
pnpm test
pnpm forge -- run "Inspect this repo and summarize the approval model."
```

If you want to inspect the database manually:

```bash
pnpm db:studio
```

## Notes

Forge is trying to make local agent execution easier to inspect, easier to pause, and easier to trust. The current implementation is deliberately narrow, but that narrowness is the point.

Forge is trying to make local agent execution more legible, more controllable, and easier to trust. The current implementation is deliberately narrow, but that narrowness is the point.
