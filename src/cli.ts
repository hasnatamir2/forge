#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import {
  authModeSchema,
  providerKindSchema,
  type AuthMode,
  type ProviderKind
} from "./config/schema.js";
import { loadConfig } from "./config/load-config.js";
import { ForgeDatabase } from "./db/database.js";
import { ForgeOrchestrator } from "./core/orchestrator.js";
import {
  createProviderAuthManager,
  resolveProviderConfig
} from "./core/providers/factory.js";
import { resolveProjectRoot } from "./core/policy.js";
import { OpenAIAuthManager } from "./core/providers/openai-auth.js";
import { OpenAICodexAuthManager } from "./core/providers/openai-codex-auth.js";
import type { RunRecord, StepRecord } from "./core/types.js";

function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

async function createServices() {
  const config = await loadConfig();
  const database = new ForgeDatabase(config.runtime.sqlitePath);
  const orchestrator = new ForgeOrchestrator(config, database);
  return { config, database, orchestrator };
}

interface RunCliOptions {
  projectRoot?: string;
  provider?: string;
  authMode?: string;
  appendPrompt?: string;
  interactive?: boolean;
}

function parseProvider(value?: string): ProviderKind | undefined {
  if (!value) {
    return undefined;
  }

  return providerKindSchema.parse(value);
}

function parseAuthMode(value?: string): AuthMode | undefined {
  if (!value) {
    return undefined;
  }

  return authModeSchema.parse(value);
}

const program = new Command();
program
  .name("forge")
  .description("Controlled AI harness around pi-coding-agent");

program
  .command("run")
  .argument("[task]", "task prompt to run")
  .option("--project-root <path>", "project root for the run")
  .option("--provider <provider>", "override provider kind for this run")
  .option("--auth-mode <mode>", "override auth mode for this run")
  .option(
    "--append-prompt <text>",
    "append an extra system prompt fragment for this run"
  )
  .option(
    "--interactive",
    "keep Forge running in an interactive shell after the first prompt",
    false
  )
  .action(async (task: string | undefined, options: RunCliOptions) => {
    if (!task || options.interactive) {
      await startInteractiveShell(options, task);
      return;
    }

    await runSingleTask(task, options);
  });

program
  .command("shell")
  .description("Start an interactive Forge shell")
  .option("--project-root <path>", "project root for the shell")
  .option("--provider <provider>", "override provider kind for this shell")
  .option("--auth-mode <mode>", "override auth mode for this shell")
  .option(
    "--append-prompt <text>",
    "append an extra system prompt fragment for this shell"
  )
  .action(async (options: RunCliOptions) => {
    await startInteractiveShell(options);
  });

program
  .command("resume")
  .argument("<runId>", "run to resume")
  .action(async (runId: string) => {
    const { orchestrator } = await createServices();
    const run = await orchestrator.resumeRun(runId);
    console.log(`Run: ${run.id}`);
    console.log(`Status: ${run.status}`);
    console.log(`Provider: ${run.provider}`);
    console.log(`Auth mode: ${run.providerAuthMode}`);
    if (run.finalOutput) {
      console.log("\nFinal output:\n");
      console.log(run.finalOutput);
    }
  });

program
  .command("approve")
  .argument("<approvalId>", "approval id to approve")
  .option("--reason <text>", "resolution reason")
  .action(async (approvalId: string, options: { reason?: string }) => {
    const { orchestrator } = await createServices();
    const approval = orchestrator.approve(approvalId, options.reason);
    console.log(`Approved ${approval.id} for run ${approval.runId}`);
  });

program
  .command("reject")
  .argument("<approvalId>", "approval id to reject")
  .option("--reason <text>", "resolution reason")
  .action(async (approvalId: string, options: { reason?: string }) => {
    const { orchestrator } = await createServices();
    const approval = orchestrator.reject(approvalId, options.reason);
    console.log(`Rejected ${approval.id} for run ${approval.runId}`);
  });

program
  .command("logs")
  .argument("<runId>", "run to inspect")
  .option("--format <format>", "output format: text or json", "text")
  .option("--tail", "poll for new steps until the run stops", false)
  .action(
    async (runId: string, options: { format: string; tail?: boolean }) => {
      const { database } = await createServices();
      if (options.format !== "text" && options.format !== "json") {
        throw new Error(`Unsupported log format: ${options.format}`);
      }

      if (options.tail) {
        await tailLogs(database, runId, options.format);
        return;
      }

      const run = database.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      const steps = database.listSteps(runId);
      const approvals = database.listApprovals(runId);

      if (options.format === "json") {
        console.log(
          JSON.stringify(
            {
              run,
              steps: steps.map((step) => ({
                ...step,
                payload: parseJson(step.payloadJson)
              })),
              approvals: approvals.map((approval) => ({
                ...approval,
                args: parseJson(approval.argsJson)
              }))
            },
            null,
            2
          )
        );
        return;
      }

      renderRunHeader(run);
      renderSteps(steps);
    }
  );

program.command("runs").action(async () => {
  const { database } = await createServices();
  const runs = database.listRuns();
  runs.forEach((run) => {
    console.log(
      `${run.id}  ${run.status}  ${run.provider}/${run.providerAuthMode}  ${run.model}  ${run.createdAt}  ${run.prompt}`
    );
  });
});

program
  .command("approvals")
  .option("--run <runId>", "filter approvals by run")
  .action(async (options: { run?: string }) => {
    const { database } = await createServices();
    const approvals = database.listApprovals(options.run);
    approvals.forEach((approval) => {
      console.log(
        `${approval.id}  ${approval.status}  ${approval.toolName}  ${approval.createdAt}  run=${approval.runId}`
      );
      console.log(formatJson(approval.argsJson));
      console.log("");
    });
  });

const authProgram = program
  .command("auth")
  .description("Manage provider authentication state");

authProgram
  .command("login")
  .option("--provider <provider>", "provider to authenticate", "openai")
  .option("--project-root <path>", "project root for auth state")
  .option("--api-key <key>", "store this API key without prompting")
  .action(
    async (options: {
      provider: string;
      projectRoot?: string;
      apiKey?: string;
    }) => {
      const { config } = await createServices();
      const provider = parseProvider(options.provider) ?? "openai";
      const projectRoot = resolveProjectRoot(config, options.projectRoot);
      let statePath: string;

      if (provider === "openai-codex") {
        const providerConfig = resolveProviderConfig(config, {
          provider
        });
        if (providerConfig.kind !== "openai-codex") {
          throw new Error(
            `Expected openai-codex provider config, got ${providerConfig.kind}`
          );
        }

        statePath = await new OpenAICodexAuthManager(config).login(
          projectRoot,
          providerConfig
        );
      } else {
        statePath = await new OpenAIAuthManager(config).login(
          projectRoot,
          options.apiKey
        );
      }
      console.log(`Stored ${provider} login credential at ${statePath}`);
    }
  );

authProgram
  .command("logout")
  .option("--provider <provider>", "provider to clear auth state for", "openai")
  .option("--project-root <path>", "project root for auth state")
  .action(async (options: { provider: string; projectRoot?: string }) => {
    const { config } = await createServices();
    const provider = parseProvider(options.provider) ?? "openai";
    const authManager = createProviderAuthManager(config, provider);
    const projectRoot = resolveProjectRoot(config, options.projectRoot);
    const removed = await authManager.logout(projectRoot);
    console.log(
      removed
        ? `Cleared ${provider} login credential for ${projectRoot}`
        : `No ${provider} login credential found for ${projectRoot}`
    );
  });

program.action(async () => {
  await startInteractiveShell({});
});

program.parseAsync(process.argv);

async function runSingleTask(
  task: string,
  options: RunCliOptions
): Promise<RunRecord> {
  const { orchestrator } = await createServices();
  const run = await orchestrator.runTask(
    task,
    options.projectRoot,
    {
      provider: parseProvider(options.provider),
      authMode: parseAuthMode(options.authMode)
    },
    options.appendPrompt
  );
  printRunResult(run);
  return run;
}

async function startInteractiveShell(
  options: RunCliOptions,
  initialTask?: string
): Promise<void> {
  const services = await createServices();
  const projectRoot = resolveProjectRoot(services.config, options.projectRoot);
  const providerConfig = resolveProviderConfig(services.config, {
    provider: parseProvider(options.provider),
    authMode: parseAuthMode(options.authMode)
  });
  const rl = createInterface({ input, output });

  console.log("Forge interactive shell");
  console.log(`Project root: ${projectRoot}`);
  console.log(`Provider: ${providerConfig.kind}`);
  console.log(`Auth mode: ${providerConfig.authMode}`);
  console.log(
    "Commands: /help, /runs, /approvals, /approve <id>, /reject <id>, /resume <runId>, /logs <runId>, /exit"
  );
  console.log("");

  try {
    if (initialTask?.trim()) {
      await executeShellInput(services, options, initialTask);
    }

    while (true) {
      const command = (await rl.question("forge> ")).trim();
      if (!command) {
        continue;
      }

      const shouldExit = await executeShellInput(services, options, command);
      if (shouldExit) {
        return;
      }

      console.log("");
    }
  } finally {
    rl.close();
  }
}

async function executeShellInput(
  services: Awaited<ReturnType<typeof createServices>>,
  options: RunCliOptions,
  command: string
): Promise<boolean> {
  if (command === "/exit" || command === "/quit") {
    return true;
  }

  if (command === "/help") {
    console.log("Enter a normal prompt to start a run.");
    console.log("/runs");
    console.log("/approvals [runId]");
    console.log("/approve <approvalId> [reason]");
    console.log("/reject <approvalId> [reason]");
    console.log("/resume <runId>");
    console.log("/logs <runId>");
    console.log("/exit");
    return false;
  }

  if (command === "/runs") {
    services.database.listRuns().forEach((run) => {
      console.log(
        `${run.id}  ${run.status}  ${run.provider}/${run.providerAuthMode}  ${run.model}  ${run.createdAt}  ${run.prompt}`
      );
    });
    return false;
  }

  if (command.startsWith("/approvals")) {
    const [, runId] = command.split(/\s+/, 2);
    services.database.listApprovals(runId).forEach((approval) => {
      console.log(
        `${approval.id}  ${approval.status}  ${approval.toolName}  ${approval.createdAt}  run=${approval.runId}`
      );
      console.log(formatJson(approval.argsJson));
      console.log("");
    });
    return false;
  }

  if (command.startsWith("/approve ")) {
    const [, approvalId, ...reasonParts] = command.split(/\s+/);
    const approval = services.orchestrator.approve(
      approvalId,
      reasonParts.length > 0 ? reasonParts.join(" ") : undefined
    );
    console.log(`Approved ${approval.id} for run ${approval.runId}`);
    return false;
  }

  if (command.startsWith("/reject ")) {
    const [, approvalId, ...reasonParts] = command.split(/\s+/);
    const approval = services.orchestrator.reject(
      approvalId,
      reasonParts.length > 0 ? reasonParts.join(" ") : undefined
    );
    console.log(`Rejected ${approval.id} for run ${approval.runId}`);
    return false;
  }

  if (command.startsWith("/resume ")) {
    const [, runId] = command.split(/\s+/, 2);
    if (!runId) {
      console.log("Usage: /resume <runId>");
      return false;
    }

    const run = await services.orchestrator.resumeRun(runId);
    printRunResult(run);
    return false;
  }

  if (command.startsWith("/logs ")) {
    const [, runId] = command.split(/\s+/, 2);
    if (!runId) {
      console.log("Usage: /logs <runId>");
      return false;
    }

    const run = services.database.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    renderRunHeader(run);
    renderSteps(services.database.listSteps(runId));
    return false;
  }

  const run = await services.orchestrator.runTask(
    command,
    options.projectRoot,
    {
      provider: parseProvider(options.provider),
      authMode: parseAuthMode(options.authMode)
    },
    options.appendPrompt
  );
  printRunResult(run);
  return false;
}

function printRunResult(run: RunRecord): void {
  console.log(`Run: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Provider: ${run.provider}`);
  console.log(`Auth mode: ${run.providerAuthMode}`);
  if (run.finalOutput) {
    console.log("\nFinal output:\n");
    console.log(run.finalOutput);
  }

  if (run.status === "awaiting_approval") {
    console.log("\nRun paused for approval.");
    console.log(
      "Use /approvals <runId>, /approve <approvalId>, and /resume <runId>."
    );
  }
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function renderRunHeader(run: RunRecord): void {
  console.log(`Run ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Model: ${run.model}`);
  console.log(`Provider: ${run.provider}`);
  console.log(`Auth mode: ${run.providerAuthMode}`);
  console.log(`Project root: ${run.projectRoot}`);
  console.log("");
}

function renderSteps(steps: StepRecord[]): void {
  for (const step of steps) {
    const payload = parseJson(step.payloadJson);
    console.log(`[${step.sequence}] ${step.type} ${step.createdAt}`);
    console.log(formatStepPayload(step.type, payload));
    console.log("");
  }
}

function formatStepPayload(
  stepType: StepRecord["type"],
  payload: unknown
): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return formatJson(JSON.stringify(payload));
  }

  const value = payload as Record<string, unknown>;

  switch (stepType) {
    case "system_prompt":
      return [
        "Assembled system prompt",
        `contributors=${Array.isArray(value.contributors) ? value.contributors.length : 0}`,
        typeof value.resumed === "boolean" ? `resumed=${value.resumed}` : null
      ]
        .filter(Boolean)
        .join("  ");
    case "agent_message":
      return [
        value.content ? String(value.content) : "(no assistant text)",
        value.finishReason ? `finish=${String(value.finishReason)}` : null,
        typeof value.durationMs === "number"
          ? `duration=${value.durationMs}ms`
          : null,
        value.tokensIn !== null && value.tokensIn !== undefined
          ? `tokensIn=${value.tokensIn}`
          : null,
        value.tokensOut !== null && value.tokensOut !== undefined
          ? `tokensOut=${value.tokensOut}`
          : null
      ]
        .filter(Boolean)
        .join("\n");
    case "tool_call_requested":
    case "tool_call_blocked":
    case "tool_call_executed":
      return [
        value.summary ? String(value.summary) : null,
        value.toolName ? `tool=${String(value.toolName)}` : null,
        value.args ? formatJson(JSON.stringify(value.args)) : null
      ]
        .filter(Boolean)
        .join("\n");
    case "tool_result":
      return [
        value.toolName ? `tool=${String(value.toolName)}` : null,
        value.normalizedResultStatus
          ? `status=${String(value.normalizedResultStatus)}`
          : null,
        typeof value.durationMs === "number"
          ? `duration=${value.durationMs}ms`
          : null,
        value.content ? String(value.content) : null
      ]
        .filter(Boolean)
        .join("\n");
    case "approval_created":
    case "approval_resolved":
      return [
        value.reason ? String(value.reason) : null,
        value.toolName ? `tool=${String(value.toolName)}` : null,
        value.approvalId ? `approval=${String(value.approvalId)}` : null,
        value.status ? `status=${String(value.status)}` : null
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return formatJson(JSON.stringify(value));
  }
}

async function tailLogs(
  database: ForgeDatabase,
  runId: string,
  format: "text" | "json"
): Promise<void> {
  const run = database.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (format === "text") {
    renderRunHeader(run);
  }

  let renderedCount = 0;

  while (true) {
    const currentRun = database.getRun(runId);
    if (!currentRun) {
      throw new Error(`Run not found: ${runId}`);
    }

    const steps = database.listSteps(runId);
    const nextSteps = steps.slice(renderedCount);
    if (nextSteps.length > 0) {
      if (format === "json") {
        nextSteps.forEach((step) => {
          console.log(
            JSON.stringify({
              ...step,
              payload: parseJson(step.payloadJson)
            })
          );
        });
      } else {
        renderSteps(nextSteps);
      }
      renderedCount = steps.length;
    }

    if (currentRun.status !== "running") {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}
