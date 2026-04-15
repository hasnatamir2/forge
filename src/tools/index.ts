import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type {
    ForgeTool,
    ForgeToolContext,
    ToolExecutionResult,
    ToolRuntime,
} from "../core/types.js";
import {
    assertWithinProjectRoot,
    ensureFileParentAllowed,
    isCommandAllowed,
} from "../core/policy.js";
import { stableStringify } from "../utils/json.js";
import { z as zod } from "zod";

const listFilesSchema = zod.object({
    path: zod.string().default("."),
    recursive: zod.boolean().default(false),
    includeHidden: zod.boolean().default(false),
    limit: zod.number().int().positive().max(500).default(200),
});

const readFileSchema = zod.object({
    path: zod.string(),
    startLine: zod.number().int().positive().optional(),
    endLine: zod.number().int().positive().optional(),
    maxBytes: zod.number().int().positive().max(100_000).default(50_000),
});

const searchRepoSchema = zod.object({
    query: zod.string().min(1),
    path: zod.string().default("."),
    regex: zod.boolean().default(false),
    limit: zod.number().int().positive().max(200).default(50),
});

const writeFileSchema = zod.object({
    path: zod.string(),
    content: zod.string(),
    mode: zod.enum(["overwrite", "append", "create"]).default("overwrite"),
});

const applyPatchSchema = zod.object({
    path: zod.string(),
    search: zod.string(),
    replace: zod.string(),
    all: zod.boolean().default(false),
});

const runCommandSchema = zod.object({
    command: zod.string().min(1),
    args: zod.array(zod.string()).default([]),
    cwd: zod.string().optional(),
});

const tools: Array<ForgeTool<any>> = [
    {
        name: "list_files",
        description: "List files under a path within the project root.",
        riskLevel: "safe",
        zodSchema: listFilesSchema,
        inputSchema: Type.Object({
            path: Type.Optional(Type.String({ default: "." })),
            recursive: Type.Optional(Type.Boolean({ default: false })),
            includeHidden: Type.Optional(Type.Boolean({ default: false })),
            limit: Type.Optional(Type.Number({ default: 200 })),
        }),
        summarize(args) {
            return `List files in ${args.path}`;
        },
        async execute(args, context) {
            const basePath = assertWithinProjectRoot(
                context.projectRoot,
                args.path,
            );
            const entries = await collectFiles(basePath, {
                recursive: args.recursive,
                includeHidden: args.includeHidden,
                limit: args.limit,
            });

            const relativeEntries = entries.map(
                (entry) => relative(context.projectRoot, entry) || ".",
            );
            return {
                content: relativeEntries.join("\n") || "(no files found)",
            };
        },
    },
    {
        name: "read_file",
        description:
            "Read a file inside the project root with optional line bounds.",
        riskLevel: "safe",
        zodSchema: readFileSchema,
        inputSchema: Type.Object({
            path: Type.String(),
            startLine: Type.Optional(Type.Number()),
            endLine: Type.Optional(Type.Number()),
            maxBytes: Type.Optional(Type.Number({ default: 50000 })),
        }),
        summarize(args) {
            return `Read file ${args.path}`;
        },
        async execute(args, context) {
            const filePath = assertWithinProjectRoot(
                context.projectRoot,
                args.path,
            );
            const content = await readFile(filePath, "utf8");
            const lines = content.split("\n");
            const startIndex = args.startLine
                ? Math.max(0, args.startLine - 1)
                : 0;
            const endIndex = args.endLine
                ? Math.min(lines.length, args.endLine)
                : lines.length;
            let selected = lines.slice(startIndex, endIndex).join("\n");

            if (Buffer.byteLength(selected, "utf8") > args.maxBytes) {
                selected = Buffer.from(selected, "utf8")
                    .subarray(0, args.maxBytes)
                    .toString("utf8");
                selected = `${selected}\n\n[truncated to ${args.maxBytes} bytes]`;
            }

            return { content: selected };
        },
    },
    {
        name: "search_repo",
        description:
            "Search for text in repository files inside the project root.",
        riskLevel: "safe",
        zodSchema: searchRepoSchema,
        inputSchema: Type.Object({
            query: Type.String(),
            path: Type.Optional(Type.String({ default: "." })),
            regex: Type.Optional(Type.Boolean({ default: false })),
            limit: Type.Optional(Type.Number({ default: 50 })),
        }),
        summarize(args) {
            return `Search repo for ${JSON.stringify(args.query)}`;
        },
        async execute(args, context) {
            const basePath = assertWithinProjectRoot(
                context.projectRoot,
                args.path,
            );
            const matches = await searchFiles(basePath, args.query, {
                regex: args.regex,
                limit: args.limit,
                projectRoot: context.projectRoot,
            });

            return {
                content:
                    matches.length > 0
                        ? matches.join("\n")
                        : "(no matches found)",
            };
        },
    },
    {
        name: "write_file",
        description: "Write content to a file inside the project root.",
        riskLevel: "guarded",
        zodSchema: writeFileSchema,
        inputSchema: Type.Object({
            path: Type.String(),
            content: Type.String(),
            mode: Type.Optional(
                Type.Union([
                    Type.Literal("overwrite"),
                    Type.Literal("append"),
                    Type.Literal("create"),
                ]),
            ),
        }),
        summarize(args) {
            return `Write file ${args.path} (${args.mode})`;
        },
        async execute(args, context) {
            const filePath = ensureFileParentAllowed(
                context.projectRoot,
                args.path,
            );
            await mkdir(dirname(filePath), { recursive: true });

            if (args.mode === "create" && existsSync(filePath)) {
                throw new Error(`File already exists: ${args.path}`);
            }

            if (args.mode === "append") {
                const existing = existsSync(filePath)
                    ? await readFile(filePath, "utf8")
                    : "";
                await writeFile(filePath, `${existing}${args.content}`, "utf8");
            } else {
                await writeFile(filePath, args.content, "utf8");
            }

            return { content: `Wrote ${args.path}` };
        },
    },
    {
        name: "apply_patch",
        description:
            "Apply a deterministic search/replace patch to a file inside the project root.",
        riskLevel: "guarded",
        zodSchema: applyPatchSchema,
        inputSchema: Type.Object({
            path: Type.String(),
            search: Type.String(),
            replace: Type.String(),
            all: Type.Optional(Type.Boolean({ default: false })),
        }),
        summarize(args) {
            return `Apply patch to ${args.path}`;
        },
        async execute(args, context) {
            const filePath = ensureFileParentAllowed(
                context.projectRoot,
                args.path,
            );
            const original = await readFile(filePath, "utf8");

            if (!original.includes(args.search)) {
                throw new Error(`Search text not found in ${args.path}`);
            }

            const next = args.all
                ? original.split(args.search).join(args.replace)
                : original.replace(args.search, args.replace);

            await writeFile(filePath, next, "utf8");
            return { content: `Patched ${args.path}` };
        },
    },
    {
        name: "run_command",
        description: "Run an allowlisted command inside the project root.",
        riskLevel: "guarded",
        zodSchema: runCommandSchema,
        inputSchema: Type.Object({
            command: Type.String(),
            args: Type.Optional(Type.Array(Type.String())),
            cwd: Type.Optional(Type.String()),
        }),
        summarize(args) {
            return `Run command ${[args.command, ...args.args].join(" ")}`;
        },
        async execute(args, context) {
            const allow = isCommandAllowed(
                context.config,
                args.command,
                args.args,
            );
            if (!allow.allowed) {
                throw new Error(allow.reason);
            }

            const commandCwd = args.cwd
                ? assertWithinProjectRoot(context.projectRoot, args.cwd)
                : context.projectRoot;

            const result = await runChildProcess(
                args.command,
                args.args,
                commandCwd,
                context.signal,
            );
            return {
                content: result.stdout || "(command produced no stdout)",
                details: {
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                },
                isError: result.exitCode !== 0,
            };
        },
    },
];

export function getForgeTools(): Array<ForgeTool<any>> {
    return tools;
}

export function createToolRuntime(context: ForgeToolContext): ToolRuntime {
    const state = { pauseRequested: false };

    return {
        toolDefinitions: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        })),
        state,
        async executeToolCall(
            toolCallId,
            toolName,
            rawArgs,
            signal,
        ): Promise<ToolExecutionResult> {
            const tool = tools.find((candidate) => candidate.name === toolName);
            if (!tool) {
                throw new Error(`Unknown tool: ${toolName}`);
            }

            const args = tool.zodSchema.parse(rawArgs);
            const argsJson = stableStringify(args);
            context.database.appendStep(context.runId, "tool_call_requested", {
                toolCallId,
                toolName: tool.name,
                args,
                riskLevel: tool.riskLevel,
                summary: tool.summarize(args),
            });

            if (tool.riskLevel === "guarded") {
                const approved = context.database.findApprovedApproval(
                    context.runId,
                    tool.name,
                    argsJson,
                );
                if (!approved) {
                    state.pauseRequested = true;
                    const blockedStep = context.database.appendStep(
                        context.runId,
                        "tool_call_blocked",
                        {
                            toolCallId,
                            toolName: tool.name,
                            args,
                            summary: tool.summarize(args),
                        },
                    );
                    const approval = context.database.createApproval({
                        runId: context.runId,
                        stepId: blockedStep.id,
                        toolName: tool.name,
                        argsJson,
                        reason: `Approval required for guarded tool: ${tool.summarize(args)}`,
                    });
                    context.database.appendStep(
                        context.runId,
                        "approval_created",
                        {
                            approvalId: approval.id,
                            toolCallId,
                            toolName: tool.name,
                            args,
                            reason: approval.reason,
                        },
                    );

                    return {
                        content: [
                            `Approval required for ${tool.name}.`,
                            `Approval ID: ${approval.id}`,
                            `Run ID: ${context.runId}`,
                            `Command: forge approve ${approval.id}`,
                            `Then: forge resume ${context.runId}`,
                        ].join("\n"),
                        details: { approvalId: approval.id, blocked: true },
                        blocked: true,
                    };
                }

                context.database.markApprovalConsumed(approved.id);
                context.database.appendStep(
                    context.runId,
                    "approval_resolved",
                    {
                        approvalId: approved.id,
                        toolName: approved.toolName,
                        status: "consumed",
                    },
                );
            }

            context.database.appendStep(context.runId, "tool_call_executed", {
                toolCallId,
                toolName: tool.name,
                args,
            });

            try {
                const result = await tool.execute(args, { ...context, signal });
                context.database.appendStep(context.runId, "tool_result", {
                    toolCallId,
                    toolName: tool.name,
                    args,
                    content: result.content,
                    details: result.details,
                    isError: result.isError ?? false,
                });

                return {
                    content: result.content,
                    details: result.details,
                };
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                context.database.appendStep(context.runId, "tool_result", {
                    toolCallId,
                    toolName: tool.name,
                    args,
                    content: message,
                    isError: true,
                });
                return {
                    content: message,
                    details: { error: true },
                };
            }
        },
    };
}

async function collectFiles(
    directory: string,
    options: { recursive: boolean; includeHidden: boolean; limit: number },
): Promise<string[]> {
    const results: string[] = [];
    await walkDirectory(directory, results, options);
    return results;
}

async function walkDirectory(
    directory: string,
    results: string[],
    options: { recursive: boolean; includeHidden: boolean; limit: number },
): Promise<void> {
    if (results.length >= options.limit) {
        return;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (!options.includeHidden && entry.name.startsWith(".")) {
            continue;
        }

        const fullPath = resolve(directory, entry.name);
        results.push(fullPath);
        if (results.length >= options.limit) {
            return;
        }

        if (options.recursive && entry.isDirectory()) {
            await walkDirectory(fullPath, results, options);
            if (results.length >= options.limit) {
                return;
            }
        }
    }
}

async function searchFiles(
    directory: string,
    query: string,
    options: { regex: boolean; limit: number; projectRoot: string },
): Promise<string[]> {
    const matches: string[] = [];
    const pattern = options.regex ? new RegExp(query, "g") : undefined;
    const files = await collectFiles(directory, {
        recursive: true,
        includeHidden: true,
        limit: 5_000,
    });

    for (const filePath of files) {
        if (matches.length >= options.limit) {
            break;
        }

        try {
            const content = await readFile(filePath, "utf8");
            const lines = content.split("\n");
            lines.forEach((line, index) => {
                const lineMatches = pattern
                    ? pattern.test(line)
                    : line.includes(query);
                if (lineMatches && matches.length < options.limit) {
                    matches.push(
                        `${relative(options.projectRoot, filePath)}:${index + 1}:${line}`,
                    );
                }
            });
        } catch {
            // Ignore unreadable or binary files in the thin v1 scaffold.
        }
    }

    return matches;
}

async function runChildProcess(
    command: string,
    args: string[],
    cwd: string,
    signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd,
            signal,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (exitCode) => {
            resolvePromise({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
            });
        });
    });
}
