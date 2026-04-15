#!/usr/bin/env node

import { Command } from "commander";
import {
    authModeSchema,
    providerKindSchema,
    type AuthMode,
    type ProviderKind,
} from "./config/schema.js";
import { loadConfig } from "./config/load-config.js";
import { ForgeDatabase } from "./db/database.js";
import { ForgeOrchestrator } from "./core/orchestrator.js";
import {
    createProviderAuthManager,
    resolveProviderConfig,
} from "./core/providers/factory.js";
import { resolveProjectRoot } from "./core/policy.js";
import { OpenAIAuthManager } from "./core/providers/openai-auth.js";
import { OpenAICodexAuthManager } from "./core/providers/openai-codex-auth.js";

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
    .argument("<task>", "task prompt to run")
    .option("--project-root <path>", "project root for the run")
    .option("--provider <provider>", "override provider kind for this run")
    .option("--auth-mode <mode>", "override auth mode for this run")
    .action(
        async (
            task: string,
            options: {
                projectRoot?: string;
                provider?: string;
                authMode?: string;
            },
        ) => {
            const { orchestrator } = await createServices();
            const run = await orchestrator.runTask(task, options.projectRoot, {
                provider: parseProvider(options.provider),
                authMode: parseAuthMode(options.authMode),
            });
            console.log(`Run: ${run.id}`);
            console.log(`Status: ${run.status}`);
            console.log(`Provider: ${run.provider}`);
            console.log(`Auth mode: ${run.providerAuthMode}`);
            if (run.finalOutput) {
                console.log("\nFinal output:\n");
                console.log(run.finalOutput);
            }
        },
    );

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
    .action(async (runId: string) => {
        const { database } = await createServices();
        const run = database.getRun(runId);
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }

        console.log(`Run ${run.id}`);
        console.log(`Status: ${run.status}`);
        console.log(`Model: ${run.model}`);
        console.log(`Provider: ${run.provider}`);
        console.log(`Auth mode: ${run.providerAuthMode}`);
        console.log(`Project root: ${run.projectRoot}`);
        console.log("");

        const steps = database.listSteps(runId);
        for (const step of steps) {
            console.log(`[${step.sequence}] ${step.type} ${step.createdAt}`);
            console.log(formatJson(step.payloadJson));
            console.log("");
        }
    });

program.command("runs").action(async () => {
    const { database } = await createServices();
    const runs = database.listRuns();
    runs.forEach((run) => {
        console.log(
            `${run.id}  ${run.status}  ${run.provider}/${run.providerAuthMode}  ${run.model}  ${run.createdAt}  ${run.prompt}`,
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
                `${approval.id}  ${approval.status}  ${approval.toolName}  ${approval.createdAt}  run=${approval.runId}`,
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
                    provider,
                });
                if (providerConfig.kind !== "openai-codex") {
                    throw new Error(
                        `Expected openai-codex provider config, got ${providerConfig.kind}`,
                    );
                }

                statePath = await new OpenAICodexAuthManager(config).login(
                    projectRoot,
                    providerConfig,
                );
            } else {
                statePath = await new OpenAIAuthManager(config).login(
                    projectRoot,
                    options.apiKey,
                );
            }
            console.log(`Stored ${provider} login credential at ${statePath}`);
        },
    );

authProgram
    .command("logout")
    .option(
        "--provider <provider>",
        "provider to clear auth state for",
        "openai",
    )
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
                : `No ${provider} login credential found for ${projectRoot}`,
        );
    });

program.parseAsync(process.argv);
