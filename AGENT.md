# Forge — AGENT.md

## 1. Overview

Forge is a **personal AI agent harness** designed to explore and validate how far controlled, tool-driven agents can go in real-world workflows.

Forge is not a chatbot.
Forge is a **system that turns intent into controlled execution**.

It provides:

- an agent runtime (Pi + OpenAI)
- a tool execution layer
- a permission and approval system
- a full trace and logging system
- a safe environment to experiment with agent behavior

---

## 2. Vision

Build a system where:

> AI agents can safely reason, act, and modify real systems — with full control, traceability, and reliability.

Long-term vision:

- AI as an **operating layer**, not a feature
- Agents executing workflows, not just answering prompts
- Full auditability of every action taken by AI

---

## 3. Goals

### Primary Goal (v1)

Validate that an agent can:

- inspect a codebase
- reason about it
- propose changes
- wait for approval
- execute changes safely
- log everything

### Success Criteria

Forge is successful when:

- agent actions are **predictable**
- tool execution is **safe**
- runs are **fully traceable**
- user trusts the system

---

## 4. Non-Goals (v1)

Forge v1 will NOT include:

- multi-agent systems
- memory/vector DB
- browser automation
- MCP integration
- distributed workflows
- web UI
- autonomous loops

These are intentionally postponed.

---

## 5. Core Principles

### 5.1 Control > Autonomy

Agents must not act freely.
All actions go through controlled interfaces.

---

### 5.2 Traceability > Magic

Every step must be visible:

- what happened
- why it happened
- what was executed

---

### 5.3 Tools > Prompts

Capabilities come from tools, not prompts.

---

### 5.4 Determinism > Intelligence

Predictable systems are more valuable than “smart” but unstable ones.

---

### 5.5 Minimal Surface Area

Keep:

- one agent
- small toolset
- simple architecture

---

## 6. Core Concepts

### Run

A single execution of a task.

### Step

A unit of execution within a run.

Types:

- agent_message
- tool_call
- tool_result
- approval_wait
- approval_result
- final_output
- error

---

### ToolCall

A structured request to execute a tool.

---

### Approval

A gated decision required for risky actions.

---

### Trace

The complete ordered history of a run.

> Trace is a first-class product feature.

---

## 7. Architecture

Forge is composed of 5 layers:

### 7.1 Interface Layer

- CLI (v1)
- Commands:
    - forge run
    - forge logs
    - forge approve
    - forge reject

---

### 7.2 Orchestrator Layer

The core of Forge.

Responsibilities:

- manage run lifecycle
- call agent runtime
- intercept tool calls
- enforce permissions
- persist steps
- maintain trace

---

### 7.3 Agent Runtime Layer

- Pi (agent shell)
- OpenAI (model provider)

Responsibilities:

- reasoning
- tool selection
- iterative execution

---

### 7.4 Tool Layer

Defines capabilities.

Each tool must include:

- name
- description
- schema (Zod)
- risk level
- execute()

Risk levels:

- safe
- guarded

---

### 7.5 Persistence Layer

SQLite (v1)

Stores:

- runs
- steps
- approvals
- tool calls

---

## 8. Data Model

### runs

- id
- prompt
- status
- model
- projectRoot
- createdAt
- completedAt
- finalOutput
- errorMessage

---

### steps

- id
- runId
- sequence
- type
- payloadJson
- createdAt

---

### approvals

- id
- runId
- stepId
- toolName
- argsJson
- status
- reason
- createdAt
- resolvedAt

---

## 9. Tooling

### Safe Tools

- list_files
- read_file
- search_repo

---

### Guarded Tools

- write_file
- run_command

---

### Rules

- All actions go through tools
- No direct system access from agent
- All inputs validated with Zod

---

## 10. Approval System

### Required for:

- file writes
- shell commands

---

### Flow

1. Agent requests action
2. Forge pauses execution
3. Approval is created
4. User approves/rejects
5. Execution resumes or stops

---

### Requirements

- full visibility of action
- human-readable summary
- no hidden execution

---

## 11. Execution Flow

1. User runs:
   forge run "<task>"

2. Forge:
    - creates run
    - initializes agent

3. Agent:
    - reasons
    - calls tools

4. Forge:
    - validates tools
    - executes safe tools
    - pauses for guarded tools

5. User:
    - approves/rejects

6. Forge:
    - executes action
    - continues run

7. Run completes with full trace

---

## 12. Coding Best Practices

### 12.1 Strict Typing

- TypeScript everywhere
- Zod for runtime validation

---

### 12.2 Tool Isolation

- tools must be independent
- no side effects outside defined scope

---

### 12.3 No Hidden Logic

- no implicit behavior
- all execution paths visible

---

### 12.4 Logging First

- log before and after execution
- include inputs and outputs

---

### 12.5 Fail Fast

- invalid input → immediate error
- unknown tool → reject
- unsafe execution → block

---

### 12.6 Deterministic Tools

Tools must:

- return predictable outputs
- avoid randomness
- be idempotent where possible

---

## 13. Security Constraints

- restrict file access to project root
- restrict command execution (allowlist)
- no network access initially
- no secret exposure

---

## 14. Project Structure

/src
/cli
/core
/tools
/schemas
/db
/utils

---

## 15. Future Expansion

Planned modules (post-v1):

- forge-memory
- forge-policy
- forge-ui
- forge-mcp
- forge-evals

---

## 16. First Milestone

Forge can:

- inspect a repo
- identify relevant files
- propose a refactor
- wait for approval
- apply change
- log everything

---

## 17. Final Principle

> Forge is not about making agents smarter.
> Forge is about making agents reliable.
