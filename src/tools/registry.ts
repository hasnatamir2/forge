import type {
  ForgeTool,
  ForgeToolContext,
  ToolExecutionResult,
  ToolRuntime
} from "../core/types.js";
import { stableStringify } from "../utils/json.js";
import { applyPatchTool } from "./apply_patch.js";
import { listFilesTool } from "./list_files.js";
import { readFileTool } from "./read_file.js";
import { runCommandTool } from "./run_command.js";
import { searchRepoTool } from "./search_repo.js";
import { writeFileTool } from "./write_file.js";

const tools: Array<ForgeTool<any>> = [
  listFilesTool,
  readFileTool,
  searchRepoTool,
  writeFileTool,
  applyPatchTool,
  runCommandTool
];

export function getForgeTools(): Array<ForgeTool<any>> {
  return tools;
}

export function buildToolRuntime(context: ForgeToolContext): ToolRuntime {
  const state = { pauseRequested: false };

  return {
    toolDefinitions: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    })),
    state,
    async executeToolCall(
      toolCallId,
      toolName,
      rawArgs,
      signal
    ): Promise<ToolExecutionResult> {
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const startedAt = Date.now();
      let parsedArgs: unknown = rawArgs;

      try {
        const args = tool.zodSchema.parse(rawArgs);
        parsedArgs = args;
        const argsJson = stableStringify(args);
        const summary = tool.summarize(args);

        context.database.appendStep(context.runId, "tool_call_requested", {
          toolCallId,
          toolName: tool.name,
          args,
          riskLevel: tool.riskLevel,
          summary
        });

        if (tool.riskLevel === "guarded") {
          const approved = context.database.findApprovedApproval(
            context.runId,
            tool.name,
            argsJson
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
                summary
              }
            );
            const approval = context.database.createApproval({
              runId: context.runId,
              stepId: blockedStep.id,
              toolName: tool.name,
              argsJson,
              reason: `Approval required for guarded tool: ${summary}`
            });
            context.database.appendStep(context.runId, "approval_created", {
              approvalId: approval.id,
              toolCallId,
              toolName: tool.name,
              args,
              reason: approval.reason
            });

            const blockedResult = {
              status: "blocked" as const,
              content: [
                `Approval required for ${tool.name}.`,
                `Approval ID: ${approval.id}`,
                `Run ID: ${context.runId}`,
                `Command: forge approve ${approval.id}`,
                `Then: forge resume ${context.runId}`
              ].join("\n"),
              meta: { approvalId: approval.id, blocked: true }
            };

            context.database.appendStep(context.runId, "tool_result", {
              toolCallId,
              toolName: tool.name,
              args,
              content: blockedResult.content,
              meta: blockedResult.meta,
              normalizedResultStatus: blockedResult.status,
              durationMs: Date.now() - startedAt
            });

            return blockedResult;
          }

          context.database.markApprovalConsumed(approved.id);
          context.database.appendStep(context.runId, "approval_resolved", {
            approvalId: approved.id,
            toolName: approved.toolName,
            status: "consumed"
          });
        }

        context.database.appendStep(context.runId, "tool_call_executed", {
          toolCallId,
          toolName: tool.name,
          args,
          summary
        });

        const result = await tool.execute(args, { ...context, signal });
        context.database.appendStep(context.runId, "tool_result", {
          toolCallId,
          toolName: tool.name,
          args,
          content: result.content,
          meta: result.meta,
          normalizedResultStatus: result.status,
          durationMs: Date.now() - startedAt
        });

        return {
          status: result.status,
          content: result.content,
          meta: result.meta
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.database.appendStep(context.runId, "tool_result", {
          toolCallId,
          toolName: tool.name,
          args: parsedArgs,
          content: message,
          meta: { error: true },
          normalizedResultStatus: "error",
          durationMs: Date.now() - startedAt
        });

        return {
          status: "error",
          content: message,
          meta: { error: true }
        };
      }
    }
  };
}
