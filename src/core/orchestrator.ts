import type { ForgeConfig } from "../config/schema.js";
import { buildSystemPrompt } from "./personality.js";
import { ForgeDatabase } from "../db/database.js";
import { resolveProjectRoot } from "./policy.js";
import { createAgentProvider, resolveProviderConfig, resolveProviderConfigForRun, type ProviderOverrides } from "./providers/factory.js";

export class ForgeOrchestrator {
  constructor(private readonly config: ForgeConfig, private readonly database: ForgeDatabase) {}

  async runTask(prompt: string, projectRootOverride?: string, overrides?: ProviderOverrides) {
    const projectRoot = resolveProjectRoot(this.config, projectRootOverride);
    const providerConfig = resolveProviderConfig(this.config, overrides);
    const provider = createAgentProvider(this.config, providerConfig);
    const run = this.database.createRun({
      prompt,
      status: "running",
      model: providerConfig.model,
      provider: provider.name,
      providerAuthMode: providerConfig.authMode,
      projectRoot
    });

    this.database.appendStep(run.id, "run_started", {
      prompt,
      provider: provider.name,
      providerAuthMode: providerConfig.authMode,
      projectRoot,
      model: providerConfig.model
    });

    try {
      const systemPrompt = await buildSystemPrompt(projectRoot, this.config.agent.systemPromptFiles);
      const result = await provider.runPrompt({
        run,
        prompt,
        projectRoot,
        systemPrompt,
        config: this.config,
        providerConfig,
        database: this.database
      });

      this.database.updateRun(run.id, {
        providerSessionFile: result.providerSessionFile,
        status: result.pauseRequested ? "awaiting_approval" : "completed",
        completedAt: result.pauseRequested ? null : new Date().toISOString(),
        finalOutput: result.finalText || null
      });

      this.database.appendStep(run.id, result.pauseRequested ? "tool_result" : "run_completed", {
        finalText: result.finalText,
        paused: result.pauseRequested
      });

      return this.database.getRun(run.id)!;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.database.updateRun(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message
      });
      this.database.appendStep(run.id, "run_failed", { error: message });
      throw error;
    }
  }

  async resumeRun(runId: string) {
    const run = this.database.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const approvals = this.database.listApprovals(runId);
    const approved = approvals.filter((approval) => approval.status === "approved");
    const rejected = approvals.filter((approval) => approval.status === "rejected");

    if (approved.length === 0 && rejected.length === 0) {
      throw new Error(`Run ${runId} has no resolved approvals to resume from`);
    }

    const resumePrompt = [
      "Resume the paused Forge run.",
      approved.length > 0
        ? `Approved actions:\n${approved.map((item) => `- ${item.toolName} ${item.argsJson}`).join("\n")}`
        : "Approved actions:\n- none",
      rejected.length > 0
        ? `Rejected actions:\n${rejected.map((item) => `- ${item.toolName} ${item.argsJson}`).join("\n")}`
        : "Rejected actions:\n- none",
      "Continue the task. If an approved action is still needed, call the same tool again with the same arguments."
    ].join("\n\n");

    this.database.updateRun(runId, { status: "running", errorMessage: null });
    const systemPrompt = await buildSystemPrompt(run.projectRoot, this.config.agent.systemPromptFiles);
    const providerConfig = resolveProviderConfigForRun(this.config, run);
    const provider = createAgentProvider(this.config, providerConfig);
    const result = await provider.runPrompt({
      run,
      prompt: resumePrompt,
      projectRoot: run.projectRoot,
      systemPrompt,
      config: this.config,
      providerConfig,
      database: this.database,
      providerSessionFile: run.providerSessionFile
    });

    this.database.updateRun(run.id, {
      providerSessionFile: result.providerSessionFile,
      status: result.pauseRequested ? "awaiting_approval" : "completed",
      completedAt: result.pauseRequested ? null : new Date().toISOString(),
      finalOutput: result.finalText || run.finalOutput
    });

    if (!result.pauseRequested) {
      this.database.appendStep(run.id, "run_completed", {
        resumed: true,
        finalText: result.finalText
      });
    }

    return this.database.getRun(run.id)!;
  }

  approve(approvalId: string, reason?: string) {
    const approval = this.database.resolveApproval(approvalId, "approved", reason);
    this.database.appendStep(approval.runId, "approval_resolved", {
      approvalId: approval.id,
      toolName: approval.toolName,
      status: approval.status,
      reason: approval.reason
    });
    return approval;
  }

  reject(approvalId: string, reason?: string) {
    const approval = this.database.resolveApproval(approvalId, "rejected", reason);
    this.database.appendStep(approval.runId, "approval_resolved", {
      approvalId: approval.id,
      toolName: approval.toolName,
      status: approval.status,
      reason: approval.reason
    });
    return approval;
  }
}
